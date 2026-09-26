import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionProjectionSnapshot, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  IDLE_WINDOW_MS,
  LOOKBACK_MS,
  MAX_WINDOW_MS,
  MIN_WINDOW_MS,
  buildTimeline,
  fitWindow,
  spanGeometry,
  taskPhase,
} from '../src/client/model.ts'
import { PROJECTION_KEY, type TaskSpan, type WorkPhase } from '../src/contract.ts'

const NOW = 1_700_000_000_000

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

describe('fitWindow', () => {
  it('falls back to the idle window when nothing happened', () => {
    expect(fitWindow([], NOW)).toEqual({ from: NOW - IDLE_WINDOW_MS, to: NOW })
  })

  it('ignores activity older than the lookback', () => {
    const stale: TaskSpan = [NOW - LOOKBACK_MS - 60_000, NOW - LOOKBACK_MS - 30_000]
    expect(fitWindow([stale], NOW)).toEqual({ from: NOW - IDLE_WINDOW_MS, to: NOW })
  })

  it('covers recent activity with padding', () => {
    const from = fitWindow([[NOW - 3_600_000, NOW - 60_000]], NOW)
    expect(from.to).toBe(NOW)
    expect(from.from).toBeLessThan(NOW - 3_600_000)
    expect(from.from).toBeGreaterThan(NOW - 6 * 3_600_000)
  })

  it('never exceeds the maximum window', () => {
    const from = fitWindow([[NOW - 10 * 24 * 3_600_000, NOW]], NOW)
    expect(from.to - from.from).toBe(MAX_WINDOW_MS)
  })

  it('never shrinks below the minimum window', () => {
    const from = fitWindow([[NOW - 1000, NOW]], NOW)
    expect(from.to - from.from).toBe(MIN_WINDOW_MS)
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

describe('spanGeometry', () => {
  it('places a full-window span across the track', () => {
    expect(spanGeometry([NOW - 1000, NOW], NOW - 1000, NOW)).toEqual({ left: 0, width: 1 })
  })

  it('keeps a hairline width for a zero-length span', () => {
    const geometry = spanGeometry([NOW, NOW], NOW - 1000, NOW)
    expect(geometry.width).toBeGreaterThan(0)
    expect(geometry.width).toBeLessThan(0.01)
  })
})

describe('buildTimeline', () => {
  const workspaces = [workspace('w1', '/repo/one', 'One'), workspace('w2', '/repo/two', 'Two')]
  const recent: TaskSpan = [NOW - 3_600_000, NOW - 60_000]

  it('groups Sessions into their workspace lane by canonical cwd', () => {
    const model = buildTimeline({
      workspaces,
      list: list(
        [summary('a', '/repo/one', { displayTitle: 'Alpha' }), summary('b', '/repo/two', { displayTitle: 'Beta' })],
        { a: loaded([recent], 'tool'), b: loaded([recent], 'idle') },
      ),
      statuses: new Map(),
      now: NOW,
      windowMs: undefined,
      includeSubagents: false,
    })
    expect(model.lanes.map(lane => lane.title)).toEqual(['One', 'Two'])
    expect(model.lanes[0]?.tasks[0]?.title).toBe('Alpha')
  })

  it('hides subagent Sessions by default and counts them', () => {
    const model = buildTimeline({
      workspaces,
      list: list(
        [summary('a', '/repo/one'), summary('child', '/repo/one', { origin: 'subagent' })],
        { a: loaded([recent]), child: loaded([recent]) },
      ),
      statuses: new Map(),
      now: NOW,
      windowMs: undefined,
      includeSubagents: false,
    })
    expect(model.hiddenTasks).toBe(1)
    expect(model.lanes[0]?.tasks).toHaveLength(1)
  })

  it('shows subagent Sessions when asked', () => {
    const model = buildTimeline({
      workspaces,
      list: list(
        [summary('a', '/repo/one'), summary('child', '/repo/one', { origin: 'subagent' })],
        { a: loaded([recent]), child: loaded([recent]) },
      ),
      statuses: new Map(),
      now: NOW,
      windowMs: undefined,
      includeSubagents: true,
    })
    expect(model.hiddenTasks).toBe(0)
    expect(model.lanes[0]?.tasks).toHaveLength(2)
  })

  it('clips a span to the window and flags the clipped edges', () => {
    const model = buildTimeline({
      workspaces,
      list: list([summary('a', '/repo/one')], {
        a: loaded([[NOW - 10 * 3_600_000, NOW - 9 * 3_600_000], [NOW - 120_000, NOW]]),
      }),
      statuses: new Map(),
      now: NOW,
      windowMs: 3_600_000,
      includeSubagents: false,
    })
    const task = model.lanes[0]?.tasks[0]
    expect(task?.spans).toHaveLength(1)
    expect(task?.clippedStart).toBe(true)
  })

  it('drops Sessions whose activity falls outside the window', () => {
    const model = buildTimeline({
      workspaces,
      list: list([summary('old', '/repo/one', { updatedAt: NOW - LOOKBACK_MS - 1 })], {
        old: loaded([[NOW - 3 * 3_600_000, NOW - 2 * 3_600_000]]),
      }),
      statuses: new Map(),
      now: NOW,
      windowMs: 60 * 60 * 1000,
      includeSubagents: false,
    })
    expect(model.lanes).toHaveLength(0)
    expect(model.hiddenWorkspaces).toBe(2)
  })

  it('requests a projection read for a recent Session that has no row yet', () => {
    const model = buildTimeline({
      workspaces,
      list: list([summary('a', '/repo/one')], {}),
      statuses: new Map(),
      now: NOW,
      windowMs: undefined,
      includeSubagents: false,
    })
    expect(model.unloaded).toEqual([sid('a')])
  })

  it('does not request a read for a Session that already has a row', () => {
    const model = buildTimeline({
      workspaces,
      list: list([summary('a', '/repo/one')], { a: loaded([recent]) }),
      statuses: new Map(),
      now: NOW,
      windowMs: undefined,
      includeSubagents: false,
    })
    expect(model.unloaded).toEqual([])
  })

  it('does not request a read for a Session older than the lookback', () => {
    const model = buildTimeline({
      workspaces,
      list: list([summary('a', '/repo/one', { updatedAt: NOW - LOOKBACK_MS - 1 })], {}),
      statuses: new Map(),
      now: NOW,
      windowMs: undefined,
      includeSubagents: false,
    })
    expect(model.unloaded).toEqual([])
  })

  it('requests a running Session even when its prompt is old', () => {
    const model = buildTimeline({
      workspaces,
      list: list([summary('a', '/repo/one', { updatedAt: NOW - LOOKBACK_MS - 1 })]),
      statuses: status('a', { running: true, pendingInteraction: undefined, completionUnread: false }),
      now: NOW,
      windowMs: undefined,
      includeSubagents: false,
    })
    expect(model.unloaded).toEqual([sid('a')])
  })

  it('orders tasks newest activity first and lanes by their newest task', () => {
    const older: TaskSpan = [NOW - 7_200_000, NOW - 7_000_000]
    const model = buildTimeline({
      workspaces,
      list: list(
        [
          summary('older', '/repo/one', { displayTitle: 'Older' }),
          summary('newer', '/repo/one', { displayTitle: 'Newer' }),
          summary('other', '/repo/two', { displayTitle: 'Other' }),
        ],
        {
          older: loaded([older]),
          newer: loaded([recent]),
          other: loaded([[NOW - 10 * 3_600_000, NOW - 9 * 3_600_000]]),
        },
      ),
      statuses: new Map(),
      now: NOW,
      windowMs: 12 * 3_600_000,
      includeSubagents: false,
    })
    expect(model.lanes[0]?.title).toBe('One')
    expect(model.lanes[0]?.tasks.map(task => task.title)).toEqual(['Newer', 'Older'])
  })

  it('carries the unread mark from the UI status', () => {
    const model = buildTimeline({
      workspaces,
      list: list([summary('a', '/repo/one')], { a: loaded([recent]) }),
      statuses: status('a', { running: false, pendingInteraction: undefined, completionUnread: true }),
      now: NOW,
      windowMs: undefined,
      includeSubagents: false,
    })
    expect(model.lanes[0]?.tasks[0]?.unread).toBe(true)
    expect(model.lanes[0]?.tasks[0]?.phase).toBe('idle')
  })

  it('skips a Session whose cwd matches no workspace', () => {
    const model = buildTimeline({
      workspaces,
      list: list([summary('a', '/repo/nowhere')], { a: loaded([recent]) }),
      statuses: new Map(),
      now: NOW,
      windowMs: undefined,
      includeSubagents: false,
    })
    expect(model.lanes).toHaveLength(0)
  })

  it('labels a row with the client row display title', () => {
    const model = buildTimeline({
      workspaces,
      list: list([summary('a', '/repo/one', { displayTitle: 'Named task' })], { a: loaded([recent]) }),
      statuses: new Map(),
      now: NOW,
      windowMs: undefined,
      includeSubagents: false,
    })
    expect(model.lanes[0]?.tasks[0]?.title).toBe('Named task')
  })
})
