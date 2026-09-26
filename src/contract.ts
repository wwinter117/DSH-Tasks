/**
 * The contract both halves of dsh-tasks share: the wire value the host publishes
 * and the fold that produces it.
 *
 * The only import is a type-only pull of the projection tables, so the browser
 * half reads these types and constants without inlining the host half's schema
 * library. The `declare module` block lives here rather than in the host half
 * because both faces must see the key for their reads and writes to type.
 * @module dsh-tasks/contract
 */
// The projection tables are declared lexically in the `./types` module and only
// re-exported from the package root, so the augmentation targets that subpath: a
// `declare module` merges with declarations in the named module, not through its
// re-exports.
import type {} from '@deepseek-ai/dsh-session-projection/types'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Fold state: interval geometry plus the published client value. */
    dshTasksSpans: TaskSpansState
  }

  interface SessionProjectionMap {
    /** Activity intervals and work phase the timeline draws. */
    dshTasksSpans: TaskSpansWire
  }
}

/** Projection key registered on the host and read from the browser. */
export const PROJECTION_KEY = 'dshTasksSpans'

/**
 * Gap that still counts as the same work interval. Two events further apart than
 * this open a new span, which is what turns a raw event stream into segments.
 */
export const SPAN_GAP_MS = 5 * 60 * 1000

/**
 * Most spans kept per Session, oldest dropped first. The timeline draws a recent
 * window, so a long-lived Session keeps the segments that can still appear.
 */
export const MAX_SPANS = 96

/**
 * Resolution of the published open-span end. The fold advances on every
 * committed event, but a client only needs the boundary to move at about this
 * rate; quantising is what keeps a streaming Session from republishing the
 * Session list many times per second.
 */
export const SPAN_QUANTUM_MS = 1000

/** Work phase the Session log alone can establish. */
export type WorkPhase =
  /** No work is in progress: the last event closed a turn, or nothing happened yet. */
  | 'idle'
  /** The agent is producing assistant output. */
  | 'generating'
  /** The agent is inside a tool call. */
  | 'tool'
  /** The agent is waiting on a subagent or a background job. */
  | 'delegated'

/** Phase the timeline draws, after Session UI status has been merged in. */
export type TaskPhase =
  | WorkPhase
  /** An approval request is blocking the Session. */
  | 'approval'
  /** A question is blocking the Session. */
  | 'question'

/** One activity interval, `[startMs, endMs]` in Unix epoch milliseconds. */
export type TaskSpan = readonly [number, number]

/**
 * Value the browser receives. Plain JSON, because the projection contract
 * requires it and the host persists these rows as a cold-read cache.
 */
export interface TaskSpansWire {
  /** Coalesced activity intervals, oldest first. */
  readonly spans: readonly TaskSpan[]
  /** Time of the last committed event, or `0` before the first one. */
  readonly lastEventAt: number
  /** Work phase after the last committed event. */
  readonly phase: WorkPhase
}

/**
 * Host-side fold state.
 *
 * `lastEventAt` is exact and drives the next gap decision, while `wire` carries
 * the client-visible value whose open end is quantised. Keeping the wire object
 * inside the state is what lets the fold hand back the same reference while only
 * invisible detail moved, which suppresses client publication.
 */
export interface TaskSpansState {
  /** Exact time of the last committed event, `0` before the first one. */
  readonly lastEventAt: number
  /** Whether any event has been folded. */
  readonly started: boolean
  /** Client-visible value; the same reference while nothing visible moved. */
  readonly wire: TaskSpansWire
}

/** A Session with no committed events. */
export const EMPTY_TASK_SPANS: TaskSpansState = {
  lastEventAt: 0,
  started: false,
  wire: { spans: [], lastEventAt: 0, phase: 'idle' },
}

/**
 * Published end of an open span: the instant floored to the published
 * resolution, never before the span's own start. A span that just opened
 * therefore publishes its start exactly, and later extensions advance the
 * boundary in whole quanta.
 * @param start - span start in Unix epoch milliseconds.
 * @param time - exact time of the newest event in the span.
 * @returns the end the client sees.
 */
function publishedEnd(start: number, time: number): number {
  return Math.max(start, Math.floor(time / SPAN_QUANTUM_MS) * SPAN_QUANTUM_MS)
}

/**
 * Classify one committed Session event.
 *
 * Core types are matched exactly. Events contributed by other packages
 * (`subagent/*`, `job/*`) are matched by namespace prefix, so an absent or
 * renamed contributor simply never matches. An unrecognised event keeps the
 * previous phase: bookkeeping written during work must not downgrade a `tool`
 * phase to something vaguer.
 * @param type - the Session event type string.
 * @param previous - phase established by the preceding event.
 * @returns the phase this event establishes.
 */
export function phaseOf(type: string, previous: WorkPhase): WorkPhase {
  switch (type) {
    case 'assistant/message':
    case 'assistant/attempt':
    case 'turn/start':
    case 'step/start':
    case 'user/message':
    case 'developer/message':
    case 'system/message':
    case 'request/header':
    case 'request/context':
      return 'generating'
    case 'tool/call':
    case 'tool/result':
      return 'tool'
    case 'turn/end':
    case 'session/end-seed':
      return 'idle'
    default:
      if (type.startsWith('subagent/') || type.startsWith('job/')) return 'delegated'
      return previous
  }
}

/**
 * Whether two wire values are indistinguishable to a client.
 *
 * Only the newest span ever moves, and spans are replaced rather than mutated,
 * so comparing the count, the newest span's start, and the quantised newest end
 * covers every visible change: a new span alters the count or the start, and
 * dropping the oldest span changes both.
 * @param before - previously published value.
 * @param after - candidate value.
 * @returns whether the candidate can reuse the published reference.
 */
function visibleEqual(before: TaskSpansWire, after: TaskSpansWire): boolean {
  if (before.phase !== after.phase) return false
  if (before.lastEventAt !== after.lastEventAt) return false
  if (before.spans.length !== after.spans.length) return false
  const last = after.spans[after.spans.length - 1]
  const previous = before.spans[before.spans.length - 1]
  if (last === undefined || previous === undefined) return last === previous
  return last[0] === previous[0] && last[1] === previous[1]
}

/**
 * Fold one committed event into the interval state.
 *
 * An event within {@link SPAN_GAP_MS} of the previous one extends the open span;
 * a later event opens a new one and drops the oldest once {@link MAX_SPANS} is
 * reached.
 * @param state - state covering every prior event.
 * @param type - Session event type.
 * @param time - event time in Unix epoch milliseconds.
 * @returns the next state, whose `wire` reference is reused when only invisible detail moved.
 */
export function foldTaskSpans(state: TaskSpansState, type: string, time: number): TaskSpansState {
  const phase = phaseOf(type, state.wire.phase)
  const contiguous = state.started && time >= state.lastEventAt && time - state.lastEventAt <= SPAN_GAP_MS
  const spans = state.wire.spans.slice()
  if (contiguous) {
    const last = spans[spans.length - 1]
    // `started` guarantees at least one span; the guard keeps the index typed.
    if (last !== undefined) spans[spans.length - 1] = [last[0], time]
  } else {
    spans.push([time, time])
    if (spans.length > MAX_SPANS) spans.splice(0, spans.length - MAX_SPANS)
  }
  const opened = spans[spans.length - 1]
  /* v8 ignore next -- both branches above leave at least one span; the guard keeps the index typed. */
  if (opened === undefined) return state
  const end = publishedEnd(opened[0], opened[1])
  spans[spans.length - 1] = [opened[0], end]
  const candidate: TaskSpansWire = { spans, lastEventAt: end, phase }
  return {
    lastEventAt: time,
    started: true,
    wire: visibleEqual(state.wire, candidate) ? state.wire : candidate,
  }
}

/**
 * Read the client-visible value.
 * @param state - current fold state.
 * @returns the published value, whose reference is stable while nothing visible moved.
 */
export function toTaskSpansWire(state: TaskSpansState): TaskSpansWire {
  return state.wire
}
