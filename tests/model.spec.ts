import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionProjectionSnapshot, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  AUTO_MAX_MS,
  AUTO_MIN_MS,
  IDLE_VIEWPORT_MS,
  LOOKBACK_MS,
  autoViewportMs,
  buildTimeline,
  centerOffset,
  contentExtent,
  spanOffset,
  stableOrder,
  taskPhase,
} from '../src/client/model.ts'
import { PROJECTION_KEY, type TaskSpan, type WorkPhase } from '../src/contract.ts'

const NOW = 1_700_000_000_000
const HOUR = 3_600_000

const sid = (name: string): SessionId => name as SessionId
const wid = (name: string): WorkspaceId => name as WorkspaceId

function workspace(id: string, path: string, title = id): WorkspaceView {
  return {
    workspaceId: wid(id),
    path,
    title,
    sessionIds: [],
    createdAt: new Date(NOW - 1000).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
  }
}

function summary(
  id: string,
  cwd: string,
  overrides: Partial<Pick<SessionSummary, 'running' | 'updatedAt' | 'origin' | 'displayTitle'>> = {},
): SessionSummary {
  return {
    id: sid(id),
    displayTitle: overrides.displayTitle ?? id,
    updatedAt: overrides.updatedAt ?? NOW,
    running: overrides.running ?? false,
    blank: false,
    cwd,
    retainedBy: {},
    ...(overrides.origin === undefined ? {} : { origin: overrides.origin }),
  }
}

function list(
  rows: readonly SessionSummary[],
  projections: Readonly<Record<string, SessionProjectionSnapshot>> = {},
): SessionListState {
  const byId: Record<string, SessionSummary> = {}
  for (const row of rows) byId[row.id] = row
  return {
    ids: rows.map(row => row.id),
    byId: byId as SessionListState['byId'],
    phase: 'ready',
    projectionsBySession: projections as SessionListState['projectionsBySession'],
  }
}

function loaded(spans: readonly TaskSpan[], phase: WorkPhase = 'tool'): SessionProjectionSnapshot {
  return {
    values: { [PROJECTION_KEY]: { spans, lastEventAt: spans[spans.length - 1]?.[1] ?? 0, phase } },
    state: 'ready',
    error: null,
  }
}

function status(id: string, value: SessionStatus): SessionStatusSnapshot {
  return new Map([[sid(id), value]])
}

const RECENT: TaskSpan = [NOW - HOUR, NOW - 60_000]

describe('autoViewportMs', () => {
  it('falls back to the idle viewport when nothing happened', () => {
    expect(autoViewportMs([], NOW)).toBe(IDLE_VIEWPORT_MS)
  })

  it('ignores activity older than the lookback', () => {
    const stale: TaskSpan = [NOW - LOOKBACK_MS - 60_000, NOW - LOOKBACK_MS - 30_000]
    expect(autoViewportMs([stale], NOW)).toBe(IDLE_VIEWPORT_MS)
  })

  it('covers a recent reach with padding', () => {
    const reach = HOUR
    const viewport = autoViewportMs([[NOW - reach, NOW - 60_000]], NOW)
    expect(viewport).toBeGreaterThan(reach)
    expect(viewport).toBeLessThan(AUTO_MAX_MS)
  })

  it('never zooms in past the minimum', () => {
    expect(autoViewportMs([[NOW - 1000, NOW]], NOW)).toBe(AUTO_MIN_MS)
  })

  it('never zooms out past the maximum, however far activity reaches', () => {
    expect(autoViewportMs([[NOW - LOOKBACK_MS + 1000, NOW]], NOW)).toBe(AUTO_MAX_MS)
  })
})

describe('contentExtent', () => {
  const viewport = HOUR

  it('anchors the left edge on real activity', () => {
    const extent = contentExtent([[NOW - 5 * HOUR, NOW - 4 * HOUR]], NOW, viewport)
    expect(extent.from).toBeLessThan(NOW - 5 * HOUR)
  })

  it('keeps half a viewport to the left when there is nothing older', () => {
    const extent = contentExtent([[NOW - 60_000, NOW]], NOW, viewport)
    expect(extent.from).toBeLessThanOrEqual(NOW - viewport / 2)
  })

  it('always leaves room to centre now', () => {
    for (const spans of [[], [[NOW - 60_000, NOW]], [[NOW - 9 * HOUR, NOW - 8 * HOUR]]] as TaskSpan[][]) {
      const extent = contentExtent(spans, NOW, viewport)
      expect(extent.to).toBeGreaterThanOrEqual(NOW + viewport / 2)
      expect(extent.from).toBeLessThanOrEqual(NOW - viewport / 2)
    }
  })

  it('quantises the right edge so the track stops growing every second', () => {
    const extent = contentExtent([[NOW - 60_000, NOW]], NOW, viewport)
    const quantum = Math.max(60_000, viewport / 64)
    expect(extent.to % quantum).toBe(0)
  })

  it('widens with the viewport, since half of it sits past now', () => {
    const narrow = contentExtent([], NOW, HOUR)
    const wide = contentExtent([], NOW, 6 * HOUR)
    expect(wide.to - wide.from).toBeGreaterThan(narrow.to - narrow.from)
  })
})

describe('centerOffset', () => {
  const contentFrom = NOW - 4 * HOUR
  const pxPerMs = 900 / HOUR

  it('puts the instant at the middle of the viewport', () => {
    const offset = centerOffset(NOW, contentFrom, pxPerMs, 900)
    expect(offset).toBe((NOW - contentFrom) * pxPerMs - 450)
  })

  it('never scrolls before the content starts', () => {
    expect(centerOffset(contentFrom, contentFrom, pxPerMs, 900)).toBe(0)
  })
})

describe('spanOffset', () => {
  const pxPerMs = 900 / HOUR

  it('places a span in pixels from the content origin', () => {
    const from = NOW - 4 * HOUR
    expect(spanOffset([from, from + HOUR], from, pxPerMs)).toEqual({ leftPx: 0, widthPx: 900 })
  })

  it('keeps a hairline width for a zero-length span', () => {
    const from = NOW - HOUR
    expect(spanOffset([NOW, NOW], from, pxPerMs).widthPx).toBe(3)
  })
})

describe('taskPhase', () => {
  it('reports a blocking approval ahead of every work phase', () => {
    const state: SessionStatus = {
      running: true,
      pendingInteraction: { key: 'k', kind: 'approval', sessionId: sid('s') },
      completionUnread: false,
    }
    expect(taskPhase('tool', state)).toBe('approval')
  })

  it('reports a blocking question ahead of every work phase', () => {
    const state: SessionStatus = {
      running: true,
      pendingInteraction: { key: 'k', kind: 'question', sessionId: sid('s') },
      completionUnread: false,
    }
    expect(taskPhase('generating', state)).toBe('question')
  })

  it('reports idle once the agent stopped, whatever the log said last', () => {
    expect(taskPhase('tool', { running: false, pendingInteraction: undefined, completionUnread: false })).toBe('idle')
  })

  it('trusts the log while the running baseline is unknown', () => {
    expect(taskPhase('delegated', undefined)).toBe('delegated')
    expect(taskPhase('idle', { running: undefined, pendingInteraction: undefined, completionUnread: false })).toBe('idle')
  })

  it('reports generating when the agent runs but no event has landed yet', () => {
    expect(taskPhase('idle', { running: true, pendingInteraction: undefined, completionUnread: false })).toBe('generating')
  })
})

describe('buildTimeline', () => {
  const workspaces = [workspace('w1', '/repo/one', 'One'), workspace('w2', '/repo/two', 'Two')]

  const build = (
    rows: readonly SessionSummary[],
    projections: Readonly<Record<string, SessionProjectionSnapshot>> = {},
    overrides: Partial<Parameters<typeof buildTimeline>[0]> = {},
  ) => buildTimeline({
    workspaces,
    list: list(rows, projections),
    statuses: new Map(),
    now: NOW,
    viewportMs: HOUR,
    includeSubagents: false,
    ...overrides,
  })

  it('groups Sessions into their workspace lane by canonical cwd', () => {
    const model = build(
      [summary('a', '/repo/one', { displayTitle: 'Alpha' }), summary('b', '/repo/two', { displayTitle: 'Beta' })],
      { a: loaded([RECENT], 'tool'), b: loaded([RECENT], 'idle') },
    )
    expect(model.lanes.map(lane => lane.title)).toEqual(['One', 'Two'])
    expect(model.lanes[0]?.tasks[0]?.title).toBe('Alpha')
  })

  it('resolves the automatic zoom when no fixed one is given', () => {
    const auto = build([summary('a', '/repo/one')], { a: loaded([RECENT]) }, { viewportMs: undefined })
    expect(auto.viewportMs).toBeGreaterThanOrEqual(AUTO_MIN_MS)
    expect(auto.viewportMs).toBeLessThanOrEqual(AUTO_MAX_MS)
  })

  it('reports the content extent it clipped the rows to', () => {
    const model = build([summary('a', '/repo/one')], { a: loaded([RECENT]) })
    expect(model.contentTo).toBeGreaterThan(model.contentFrom)
    expect(model.contentFrom).toBeLessThan(RECENT[0])
  })

  it('hides subagent Sessions by default and counts them', () => {
    const model = build(
      [summary('a', '/repo/one'), summary('child', '/repo/one', { origin: 'subagent' })],
      { a: loaded([RECENT]), child: loaded([RECENT]) },
    )
    expect(model.hiddenTasks).toBe(1)
    expect(model.lanes[0]?.tasks).toHaveLength(1)
  })

  it('shows subagent Sessions when asked', () => {
    const model = build(
      [summary('a', '/repo/one'), summary('child', '/repo/one', { origin: 'subagent' })],
      { a: loaded([RECENT]), child: loaded([RECENT]) },
      { includeSubagents: true },
    )
    expect(model.hiddenTasks).toBe(0)
    expect(model.lanes[0]?.tasks).toHaveLength(2)
  })

  it('keeps every interval of a Session that has an older stretch too', () => {
    const model = build([summary('a', '/repo/one')], {
      a: loaded([[NOW - 9 * HOUR, NOW - 8 * HOUR], RECENT]),
    })
    expect(model.lanes[0]?.tasks[0]?.spans).toHaveLength(2)
  })

  it('drops Sessions whose activity is older than the lookback', () => {
    const stale = summary('old', '/repo/one', { updatedAt: NOW - LOOKBACK_MS - 1 })
    const model = build([stale], { old: loaded([[NOW - 30 * HOUR, NOW - 29 * HOUR]]) })
    expect(model.lanes).toHaveLength(0)
    expect(model.hiddenWorkspaces).toBe(2)
  })

  it('requests a projection read for a recent Session that has no row yet', () => {
    expect(build([summary('a', '/repo/one')]).unloaded).toEqual([sid('a')])
  })

  it('does not request a read for a Session that already has a row', () => {
    expect(build([summary('a', '/repo/one')], { a: loaded([RECENT]) }).unloaded).toEqual([])
  })

  it('does not request a read for a Session older than the lookback', () => {
    expect(build([summary('a', '/repo/one', { updatedAt: NOW - LOOKBACK_MS - 1 })]).unloaded).toEqual([])
  })

  it('requests a running Session even when its prompt is old', () => {
    const model = build(
      [summary('a', '/repo/one', { updatedAt: NOW - LOOKBACK_MS - 1 })],
      {},
      { statuses: status('a', { running: true, pendingInteraction: undefined, completionUnread: false }) },
    )
    expect(model.unloaded).toEqual([sid('a')])
  })

  it('orders tasks newest activity first and lanes by their newest task', () => {
    const model = build(
      [
        summary('older', '/repo/one', { displayTitle: 'Older' }),
        summary('newer', '/repo/one', { displayTitle: 'Newer' }),
        summary('other', '/repo/two', { displayTitle: 'Other' }),
      ],
      {
        older: loaded([[NOW - 3 * HOUR, NOW - 2 * HOUR]]),
        newer: loaded([RECENT]),
        other: loaded([[NOW - 4 * HOUR, NOW - 3 * HOUR]]),
      },
      { viewportMs: 6 * HOUR },
    )
    expect(model.lanes[0]?.title).toBe('One')
    expect(model.lanes[0]?.tasks.map(task => task.title)).toEqual(['Newer', 'Older'])
  })

  it('carries the unread mark from the UI status', () => {
    const model = build(
      [summary('a', '/repo/one')],
      { a: loaded([RECENT]) },
      { statuses: status('a', { running: false, pendingInteraction: undefined, completionUnread: true }) },
    )
    expect(model.lanes[0]?.tasks[0]?.unread).toBe(true)
    expect(model.lanes[0]?.tasks[0]?.phase).toBe('idle')
  })

  it('skips a Session whose cwd matches no workspace', () => {
    expect(build([summary('a', '/repo/nowhere')], { a: loaded([RECENT]) }).lanes).toHaveLength(0)
  })

  it('labels a row with the client row display title', () => {
    const model = build([summary('a', '/repo/one', { displayTitle: 'Named task' })], { a: loaded([RECENT]) })
    expect(model.lanes[0]?.tasks[0]?.title).toBe('Named task')
  })
})

describe('stableOrder', () => {
  it('keeps the order the reader last saw', () => {
    expect(stableOrder(['b', 'a'], ['a', 'b'])).toEqual(['b', 'a'])
  })

  it('appends ids it has not seen, in their ranked order', () => {
    expect(stableOrder(['b'], ['c', 'a', 'b'])).toEqual(['b', 'c', 'a'])
  })

  it('drops ids that are gone', () => {
    expect(stableOrder(['x', 'b', 'y'], ['b'])).toEqual(['b'])
  })

  it('equals the ranking when nothing is known yet', () => {
    expect(stableOrder([], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b'])
  })
})

describe('the board holds still while events arrive', () => {
  const workspaces = [workspace('w1', '/repo/one', 'One'), workspace('w2', '/repo/two', 'Two')]

  const build = (
    now: number,
    projections: Readonly<Record<string, SessionProjectionSnapshot>>,
    overrides: Partial<Parameters<typeof buildTimeline>[0]> = {},
  ) => buildTimeline({
    workspaces,
    list: list([summary('a', '/repo/one'), summary('b', '/repo/two')], projections),
    statuses: new Map(),
    now,
    viewportMs: HOUR,
    includeSubagents: false,
    ...overrides,
  })

  const quiet: SessionProjectionSnapshot = loaded([[NOW - 3 * HOUR, NOW - 2 * HOUR - 30 * 60_000]])
  const busy: SessionProjectionSnapshot = loaded([[NOW - 30 * 60_000, NOW - 60_000]])

  it('lets a lane steal the top spot when no order is kept', () => {
    const before = build(NOW, { a: busy, b: quiet })
    expect(before.lanes.map(lane => lane.title)).toEqual(['One', 'Two'])
    // 'Two' takes over as the busiest lane, so an unranked build reorders.
    const after = build(NOW, { a: quiet, b: busy })
    expect(after.lanes.map(lane => lane.title)).toEqual(['Two', 'One'])
  })

  it('holds the lane order and the content origin once they are handed back', () => {
    const first = build(NOW, { a: busy, b: quiet })
    const order = first.lanes.map(lane => lane.workspaceId)
    const tasks = Object.fromEntries(first.lanes.map(lane => [lane.workspaceId, lane.tasks.map(task => task.sessionId)]))

    for (const step of [60_000, 5 * 60_000, 30 * 60_000]) {
      const next = build(NOW + step, { a: busy, b: loaded([[NOW - 30 * 60_000, NOW + step]]) }, {
        contentAnchor: first.contentAnchor,
        laneOrder: order,
        taskOrder: tasks,
      })
      expect(next.lanes.map(lane => lane.workspaceId)).toEqual(order)
      expect(next.contentFrom).toBe(first.contentFrom)
    }
  })

  it('moves the content origin when the clock walks a fallback edge', () => {
    // No activity at all: the left edge is "half a viewport before now", which
    // is exactly what the anchor exists to stop from sliding.
    const first = build(NOW, {})
    const later = build(NOW + 10 * 60_000, {})
    expect(later.contentFrom).toBeGreaterThan(first.contentFrom)
    const anchored = build(NOW + 10 * 60_000, {}, { contentAnchor: first.contentAnchor })
    expect(anchored.contentFrom).toBe(first.contentFrom)
  })

  it('still extends left when genuinely older activity appears', () => {
    const first = build(NOW, { a: busy, b: quiet })
    const older: SessionProjectionSnapshot = loaded([[NOW - 20 * HOUR, NOW - 19 * HOUR]])
    const next = build(NOW, { a: busy, b: quiet }, {}) // baseline for comparison
    const extended = build(NOW, { a: older, b: quiet }, { contentAnchor: first.contentAnchor })
    expect(extended.contentFrom).toBeLessThan(next.contentFrom)
    expect(extended.contentFrom).toBeLessThanOrEqual(first.contentAnchor)
  })
})
