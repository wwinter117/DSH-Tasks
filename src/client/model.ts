/**
 * Pure timeline model: the scrollable content extent, the workspace lanes, and
 * the phase merge.
 *
 * Two ranges are distinct here. The **content extent** is the whole stretch of
 * time the track spans; the **viewport** is the slice of it the reader sees,
 * whose duration the zoom presets choose. The reader pans the viewport freely,
 * so nothing in this module knows or cares where it currently sits.
 *
 * Nothing here touches React or `ctx`, so the layout decisions the panel makes
 * are unit-testable without a renderer.
 * @module dsh-tasks/client/model
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState, SessionProjectionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { TaskPhase, TaskSpan, WorkPhase } from '../contract.ts'
import { PROJECTION_KEY } from '../contract.ts'

/** Shortest viewport the automatic zoom will choose. */
export const AUTO_MIN_MS = 30 * 60 * 1000
/**
 * Longest viewport the automatic zoom will choose. Half the viewport sits to the
 * right of now, and time that has not happened yet is worth little, so the
 * automatic zoom stays well below {@link LOOKBACK_MS}.
 */
export const AUTO_MAX_MS = 6 * 60 * 60 * 1000
/** Viewport used when nothing happened inside the lookback. */
export const IDLE_VIEWPORT_MS = 2 * 60 * 60 * 1000
/** How far back activity still contributes rows, the zoom, and the backfill set. */
export const LOOKBACK_MS = 24 * 60 * 60 * 1000
/** Least breathing room added beside the content. */
const MIN_PAD_MS = 60 * 1000
/** Fraction of the viewport added as breathing room beside the content. */
const PAD_FRACTION = 0.04

/** Zoom choices the header offers; `undefined` means the automatic zoom. */
export const VIEWPORT_PRESETS = [
  { id: 'auto', ms: undefined },
  { id: '1h', ms: 60 * 60 * 1000 },
  { id: '6h', ms: 6 * 60 * 60 * 1000 },
  { id: '24h', ms: 24 * 60 * 60 * 1000 },
] as const

/** One zoom preset identity. */
export type ViewportPresetId = (typeof VIEWPORT_PRESETS)[number]['id']

/** The typed translate seat this namespace's registrations receive. */
export type TasksTranslate = PropsLocale<'dsh-tasks'>['t']

/** One Session drawn as a task row. */
export interface TimelineTask {
  readonly sessionId: SessionId
  /** Human-facing label the client row already resolved. */
  readonly title: string
  /** Intervals clipped to the content extent, oldest first. */
  readonly spans: readonly TaskSpan[]
  readonly phase: TaskPhase
  readonly running: boolean
  /** A finished run the user has not looked at yet. */
  readonly unread: boolean
  /** Exact time of the last committed event, `0` when the log has none. */
  readonly lastEventAt: number
  /** Time of the last human prompt, from the client row. */
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
  /** Left edge of the scrollable content. */
  readonly contentFrom: number
  /** Right edge of the scrollable content. */
  readonly contentTo: number
  /** Duration of the visible slice, after an automatic zoom is resolved. */
  readonly viewportMs: number
  /** Left edge to pass back as the next build's `contentAnchor`. */
  readonly contentAnchor: number
  readonly lanes: readonly TimelineLane[]
  /** Sessions inside the lookback whose projection row is still missing. */
  readonly unloaded: readonly SessionId[]
  /** Sessions that had activity in the content but are hidden by a filter. */
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
  /** Fixed viewport duration, or `undefined` for the automatic zoom. */
  readonly viewportMs: number | undefined
  /** Whether subagent child Sessions get their own row. */
  readonly includeSubagents: boolean
  /** Left edge to keep from an earlier build, so the track stops sliding. */
  readonly contentAnchor?: number | undefined
  /** Lane order to keep; workspaces absent from it are appended in activity order. */
  readonly laneOrder?: readonly string[] | undefined
  /** Per-workspace task order to keep, keyed by workspace id. */
  readonly taskOrder?: Readonly<Record<string, readonly string[]>> | undefined
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

/** Span bounds across everything that still counts as recent. */
function recentBounds(
  spans: readonly TaskSpan[],
  now: number,
): { readonly earliest: number; readonly latest: number } {
  let earliest = Number.POSITIVE_INFINITY
  let latest = Number.NEGATIVE_INFINITY
  for (const [start, end] of spans) {
    if (end < now - LOOKBACK_MS) continue
    if (start < earliest) earliest = start
    if (end > latest) latest = end
  }
  return { earliest, latest }
}

/**
 * Choose the automatic viewport duration from how far recent activity reaches.
 *
 * The reach is padded for breathing room and clamped to
 * [AUTO_MIN_MS, AUTO_MAX_MS]. Activity that outgrows the clamp is reached by
 * panning rather than by zooming out.
 * @param spans - every span considered.
 * @param now - the instant the viewport is centred on.
 * @returns the viewport duration in milliseconds.
 */
export function autoViewportMs(spans: readonly TaskSpan[], now: number): number {
  const { earliest, latest } = recentBounds(spans, now)
  if (earliest === Number.POSITIVE_INFINITY) return IDLE_VIEWPORT_MS
  const reach = Math.max(latest, now) - earliest
  const padded = reach * (1 + PAD_FRACTION * 2)
  return Math.min(AUTO_MAX_MS, Math.max(AUTO_MIN_MS, padded))
}

/**
 * Compute the scrollable extent around a centred `now`.
 *
 * The left edge follows real activity, falling back to half a viewport before
 * now when there is nothing older to show. The right edge is quantised, so the
 * track does not grow on every clock tick.
 *
 * `anchor` pins the left edge for as long as the reader keeps it: the clock term
 * in the fallback would otherwise walk the whole track sideways every second,
 * which is invisible while the viewport follows now and very visible once it
 * does not. A later anchor extends left when genuinely older activity appears,
 * and never moves right.
 * @param spans - every span considered.
 * @param now - the instant the viewport is centred on.
 * @param viewportMs - the resolved viewport duration.
 * @param anchor - left edge to keep from an earlier build, when one exists.
 * @returns content bounds plus the unpadded left edge to hand back as the next anchor.
 */
export function contentExtent(
  spans: readonly TaskSpan[],
  now: number,
  viewportMs: number,
  anchor?: number,
): { readonly from: number; readonly to: number; readonly anchor: number } {
  const pad = Math.max(MIN_PAD_MS, viewportMs * PAD_FRACTION)
  const half = viewportMs / 2
  const { earliest, latest } = recentBounds(spans, now)
  const activity = Number.isFinite(earliest) ? Math.min(earliest, now - half) : now - half
  const left = Math.min(activity, anchor ?? Number.POSITIVE_INFINITY)
  const quantum = Math.max(MIN_PAD_MS, viewportMs / 64)
  const right = Math.ceil((Math.max(now, latest) + half + pad) / quantum) * quantum
  return { from: left - pad, to: right, anchor: left }
}

/**
 * Keep a list in the order the reader last saw it.
 *
 * Rows and lanes are ranked by activity, and activity changes constantly, so
 * ranking alone would shuffle the board while the reader is looking at it. Ids
 * already known keep their position; ids that appear for the first time are
 * appended in their ranked order.
 * @param known - the order to preserve, from the previous build.
 * @param ranked - ids in their automatic order, used only for newcomers.
 * @returns the ids to draw, in order.
 */
export function stableOrder(known: readonly string[], ranked: readonly string[]): string[] {
  const present = new Set(ranked)
  const kept = known.filter(id => present.has(id))
  const seen = new Set(kept)
  return [...kept, ...ranked.filter(id => !seen.has(id))]
}

/**
 * Build one frame of the timeline.
 * @param input - workspaces, Session list, statuses, clock, and filters.
 * @returns the content extent, lanes, and the Sessions still needing a projection read.
 */
export function buildTimeline(input: TimelineInput): TimelineModel {
  const { workspaces, list, statuses, now, viewportMs, includeSubagents, contentAnchor, laneOrder, taskOrder } = input

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

  const everySpan = all.flatMap(candidate => candidate.spans)
  const resolvedViewport = viewportMs ?? autoViewportMs(everySpan, now)
  const content = contentExtent(everySpan, now, resolvedViewport, contentAnchor)

  const lanes = new Map<WorkspaceId, TimelineTask[]>()
  for (const candidate of all) {
    const visible: TaskSpan[] = []
    for (const [start, end] of candidate.spans) {
      if (end < content.from || start > content.to) continue
      visible.push([Math.max(start, content.from), Math.min(end, content.to)])
    }
    if (visible.length === 0) continue
    const last = candidate.spans[candidate.spans.length - 1]
    const row: TimelineTask = {
      sessionId: candidate.sessionId,
      title: candidate.title,
      spans: visible,
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

  const byId = new Map<WorkspaceId, TimelineLane>()
  const rankedLanes: WorkspaceId[] = []
  for (const workspace of workspaces) {
    const tasks = lanes.get(workspace.workspaceId)
    if (tasks === undefined) continue
    const rank = [...tasks].sort((left, right) => right.lastEventAt - left.lastEventAt)
    const keep = taskOrder?.[workspace.workspaceId]
    const position = new Map(stableOrder(
      keep ?? rank.map(task => task.sessionId),
      rank.map(task => task.sessionId),
    ).map((id, index) => [id, index]))
    const ordered = [...rank].sort((left, right) =>
      (position.get(left.sessionId) ?? 0) - (position.get(right.sessionId) ?? 0))
    byId.set(workspace.workspaceId, {
      workspaceId: workspace.workspaceId,
      title: workspace.title,
      tasks: ordered,
      latest: rank[0]?.lastEventAt ?? 0,
    })
    rankedLanes.push(workspace.workspaceId)
  }
  rankedLanes.sort((left, right) => (byId.get(right)?.latest ?? 0) - (byId.get(left)?.latest ?? 0))
  const laneIds = laneOrder === undefined ? rankedLanes : stableOrder(laneOrder, rankedLanes)
  const built = laneIds.flatMap(id => {
    const lane = byId.get(id as WorkspaceId)
    return lane === undefined ? [] : [lane]
  })

  return {
    contentFrom: content.from,
    contentTo: content.to,
    contentAnchor: content.anchor,
    viewportMs: resolvedViewport,
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
 * Place one span on the track, in pixels from the content's left edge.
 * @param span - span clipped to the content extent.
 * @param contentFrom - content left edge.
 * @param pxPerMs - current time scale.
 * @returns the span's offset and width in CSS pixels.
 */
export function spanOffset(
  span: TaskSpan,
  contentFrom: number,
  pxPerMs: number,
): { readonly leftPx: number; readonly widthPx: number } {
  const leftPx = (span[0] - contentFrom) * pxPerMs
  const widthPx = Math.max((span[1] - span[0]) * pxPerMs, 3)
  return { leftPx, widthPx }
}

/**
 * Horizontal scroll offset that puts an instant at the middle of the viewport.
 * @param at - the instant to centre.
 * @param contentFrom - content left edge.
 * @param pxPerMs - current time scale.
 * @param viewportPx - width of the visible track.
 * @returns the scroll offset, never negative.
 */
export function centerOffset(at: number, contentFrom: number, pxPerMs: number, viewportPx: number): number {
  return Math.max(0, (at - contentFrom) * pxPerMs - viewportPx / 2)
}
