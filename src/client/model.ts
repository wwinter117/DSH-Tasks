/**
 * Pure timeline model: the drawn window, the workspace lanes, and the phase merge.
 *
 * Nothing here touches React or `ctx`, so the layout decisions the panel makes are
 * unit-testable without a renderer.
 * @module dsh-tasks/client/model
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState, SessionProjectionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
// The `title` projection key is declared lexically in the `./types` module of the
// title package and only re-exported from its root, so the merge loads only when
// that subpath is in the program.
import type {} from '@deepseek-ai/dsh-session-title/types'
import type { TaskPhase, TaskSpan, WorkPhase } from '../contract.ts'
import { PROJECTION_KEY } from '../contract.ts'

/** Shortest window the automatic fit will produce. */
export const MIN_WINDOW_MS = 15 * 60 * 1000
/** Longest window the automatic fit will produce. */
export const MAX_WINDOW_MS = 24 * 60 * 60 * 1000
/** Window used when nothing happened inside the lookback. */
export const IDLE_WINDOW_MS = 2 * 60 * 60 * 1000
/** How far back activity still influences the automatic fit and the backfill set. */
export const LOOKBACK_MS = 24 * 60 * 60 * 1000
/** Fraction of the active range added as breathing room on the left. */
const PAD_FRACTION = 0.08

/** Fixed window choices the header offers, in milliseconds. */
export const WINDOW_PRESETS = [
  { id: 'auto', ms: undefined },
  { id: '1h', ms: 60 * 60 * 1000 },
  { id: '6h', ms: 6 * 60 * 60 * 1000 },
  { id: '24h', ms: 24 * 60 * 60 * 1000 },
] as const

/** One fixed-window preset identity. */
export type WindowPresetId = (typeof WINDOW_PRESETS)[number]['id']

/** The typed translate seat this namespace's registrations receive. */
export type TasksTranslate = PropsLocale<'dsh-tasks'>['t']

/** One Session drawn as a task row. */
export interface TimelineTask {
  readonly sessionId: SessionId
  /** Current title, or the identity's short form before a title event exists. */
  readonly title: string
  readonly spans: readonly TaskSpan[]
  /** Span times are clipped to the window; these say the row continues past an edge. */
  readonly clippedStart: boolean
  readonly clippedEnd: boolean
  readonly phase: TaskPhase
  readonly running: boolean
  /** A finished run the user has not looked at yet. */
  readonly unread: boolean
  /** Exact time of the last committed event, `0` when the log has none. */
  readonly lastEventAt: number
  /** Session creation time, from the header. */
  readonly updatedAt: number
}

/** One workspace's rows. */
export interface TimelineLane {
  readonly workspaceId: WorkspaceId
  readonly title: string
  readonly tasks: readonly TimelineTask[]
  /** Most recent visible activity in this lane, used for ordering. */
  readonly latest: number
}

/** Everything the panel needs to draw one frame. */
export interface TimelineModel {
  readonly from: number
  readonly to: number
  readonly lanes: readonly TimelineLane[]
  /** Sessions inside the lookback whose projection row is still missing. */
  readonly unloaded: readonly SessionId[]
  /** Sessions that had activity in the window but are hidden by a filter. */
  readonly hiddenTasks: number
  /** Workspaces whose every visible Session was filtered out. */
  readonly hiddenWorkspaces: number
}

/** Inputs to one model build, all already read from framework hooks. */
export interface TimelineInput {
  readonly workspaces: readonly WorkspaceView[]
  readonly list: SessionListState
  readonly statuses: SessionStatusSnapshot
  readonly now: number
  /** Fixed window length, or `undefined` for the automatic fit. */
  readonly windowMs: number | undefined
  /** Whether subagent child Sessions get their own row. */
  readonly includeSubagents: boolean
}

/**
 * Merge the log-derived work phase with the Session's UI status.
 *
 * The log alone cannot tell "the agent stopped" from "the agent is about to emit
 * its first event"; the UI status can, and it is also the only source for a
 * blocking approval or question.
 * @param work - phase the last committed event established.
 * @param status - current UI status for the Session, when one is known.
 * @returns the phase the timeline draws.
 */
export function taskPhase(work: WorkPhase, status: SessionStatus | undefined): TaskPhase {
  const kind = status?.pendingInteraction?.kind
  if (kind === 'approval') return 'approval'
  if (kind === 'question') return 'question'
  if (status?.running === false) return 'idle'
  if (status?.running === undefined) return work
  return work === 'idle' ? 'generating' : work
}

/**
 * Whether a Session is delegated subagent work rather than a task the user
 * started. Only `origin` is consulted, matching the workspace tree's own filter:
 * a forked Session carries a parent too, and a fork is a task in its own right.
 * @param summary - client Session row.
 * @returns whether the row is delegated work.
 */
function isChildSession(summary: { origin?: 'subagent' }): boolean {
  return summary.origin === 'subagent'
}

/** Read one Session's projection row, distinguishing "absent" from "empty". */
function spansOf(
  snapshot: SessionProjectionSnapshot | undefined,
): { readonly loaded: boolean; readonly spans: readonly TaskSpan[] } {
  const value = snapshot?.values[PROJECTION_KEY]
  if (value === undefined) return { loaded: false, spans: [] }
  return { loaded: true, spans: value.spans }
}

/**
 * Compute the drawn window.
 *
 * The right edge is always `now`, so the live cursor sits on the frame edge. The
 * length tracks whatever activity falls inside {@link LOOKBACK_MS}, clamped to
 * [MIN_WINDOW_MS, MAX_WINDOW_MS]; with no activity it falls back to
 * {@link IDLE_WINDOW_MS} of empty time.
 * @param spans - every span considered for the fit.
 * @param now - right edge of the window.
 * @returns window bounds in Unix epoch milliseconds.
 */
export function fitWindow(spans: readonly TaskSpan[], now: number): { from: number; to: number } {
  if (spans.length === 0) return { from: now - IDLE_WINDOW_MS, to: now }
  let earliest = Number.POSITIVE_INFINITY
  let latest = Number.NEGATIVE_INFINITY
  for (const [start, end] of spans) {
    if (end < now - LOOKBACK_MS) continue
    if (start < earliest) earliest = start
    if (end > latest) latest = end
  }
  if (earliest === Number.POSITIVE_INFINITY) return { from: now - IDLE_WINDOW_MS, to: now }
  const reach = Math.max(latest, now) - earliest
  const padded = reach * (1 + PAD_FRACTION * 2)
  const length = Math.min(MAX_WINDOW_MS, Math.max(MIN_WINDOW_MS, padded))
  return { from: now - length, to: now }
}

/**
 * Build one frame of the timeline.
 * @param input - workspaces, Session list, statuses, clock, and filters.
 * @returns the window, lanes, and the Sessions still needing a projection read.
 */
export function buildTimeline(input: TimelineInput): TimelineModel {
  const { workspaces, list, statuses, now, windowMs, includeSubagents } = input

  interface Candidate {
    readonly sessionId: SessionId
    readonly title: string
    readonly workspaceId: WorkspaceId
    readonly spans: readonly TaskSpan[]
    readonly loaded: boolean
    readonly status: SessionStatus | undefined
    readonly updatedAt: number
    readonly running: boolean
  }

  const byPath = new Map<string, WorkspaceView>()
  for (const workspace of workspaces) byPath.set(workspace.path, workspace)

  const all: Candidate[] = []
  const unloaded: SessionId[] = []
  let hiddenTasks = 0
  const usedWorkspaces = new Set<WorkspaceId>()

  for (const sessionId of list.ids) {
    const summary = list.byId[sessionId]
    if (summary === undefined) continue
    const status = statuses.get(sessionId)
    const snapshot = list.projectionsBySession[sessionId]
    const { loaded, spans } = spansOf(snapshot)
    const running = summary.running || status?.running === true
    const recent = running || summary.updatedAt >= now - LOOKBACK_MS
    if (!loaded && recent) unloaded.push(sessionId)
    const workspace = summary.cwd === undefined ? undefined : byPath.get(summary.cwd)
    if (workspace === undefined) continue
    if (!includeSubagents && isChildSession(summary)) {
      hiddenTasks += 1
      continue
    }
    all.push({
      sessionId,
      // The client row already resolves durable title, then project basename,
      // then identity — the same label the sidebar shows for this Session.
      title: summary.displayTitle,
      workspaceId: workspace.workspaceId,
      spans,
      loaded,
      status,
      updatedAt: summary.updatedAt,
      running,
    })
  }

  const fit = windowMs === undefined
    ? fitWindow(all.flatMap(candidate => candidate.spans), now)
    : { from: now - windowMs, to: now }

  const lanes = new Map<WorkspaceId, TimelineTask[]>()
  for (const candidate of all) {
    const visible: TaskSpan[] = []
    for (const [start, end] of candidate.spans) {
      if (end < fit.from || start > fit.to) continue
      visible.push([Math.max(start, fit.from), Math.min(end, fit.to)])
    }
    if (visible.length === 0) continue
    const first = candidate.spans[0]
    const last = candidate.spans[candidate.spans.length - 1]
    const row: TimelineTask = {
      sessionId: candidate.sessionId,
      title: candidate.title,
      spans: visible,
      clippedStart: first !== undefined && first[0] < fit.from,
      clippedEnd: last !== undefined && last[1] > fit.to,
      phase: taskPhase(candidate.loaded ? snapshotPhase(list, candidate.sessionId) : 'idle', candidate.status),
      running: candidate.running,
      unread: candidate.status?.completionUnread === true,
      lastEventAt: last === undefined ? 0 : last[1],
      updatedAt: candidate.updatedAt,
    }
    const bucket = lanes.get(candidate.workspaceId)
    if (bucket === undefined) lanes.set(candidate.workspaceId, [row])
    else bucket.push(row)
    usedWorkspaces.add(candidate.workspaceId)
  }

  const built: TimelineLane[] = []
  for (const workspace of workspaces) {
    const tasks = lanes.get(workspace.workspaceId)
    if (tasks === undefined) continue
    const ordered = [...tasks].sort((left, right) => right.lastEventAt - left.lastEventAt)
    built.push({
      workspaceId: workspace.workspaceId,
      title: workspace.title,
      tasks: ordered,
      latest: ordered[0]?.lastEventAt ?? 0,
    })
  }
  built.sort((left, right) => right.latest - left.latest)

  return {
    from: fit.from,
    to: fit.to,
    lanes: built,
    unloaded,
    hiddenTasks,
    hiddenWorkspaces: workspaces.length - usedWorkspaces.size,
  }
}

/** Read the work phase the projection published for one Session. */
function snapshotPhase(list: SessionListState, sessionId: SessionId): WorkPhase {
  const value = list.projectionsBySession[sessionId]?.values[PROJECTION_KEY]
  return value === undefined ? 'idle' : value.phase
}

/**
 * Position a span inside the window as a percentage of its width.
 * @param span - clipped span to place.
 * @param from - window left edge.
 * @param to - window right edge.
 * @returns left offset and width as fractions in [0, 1].
 */
export function spanGeometry(
  span: TaskSpan,
  from: number,
  to: number,
): { readonly left: number; readonly width: number } {
  const width = Math.max(1, to - from)
  const left = (span[0] - from) / width
  const right = (span[1] - from) / width
  return { left, width: Math.max(right - left, 0.0015) }
}
