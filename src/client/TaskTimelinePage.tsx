/**
 * The task timeline panel: one row per Session grouped by workspace, drawn on a
 * wall-clock axis that pans horizontally under a centred live cursor.
 * @module dsh-tasks/client/TaskTimelinePage
 */
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import {
  buildTimeline, centerOffset, spanOffset, VIEWPORT_PRESETS,
  type TasksTranslate, type ViewportPresetId,
} from './model.ts'
import { TaskDetail } from './TaskDetail.tsx'
import { formatClock, formatTick, tickStep, ticks } from './format.ts'
import { PHASE_CLASS } from './phase-style.ts'
import type { TasksKey } from './locales.ts'
import css from './Timeline.module.css'

/** Actions the plugin supplies through the registration's inject face. */
export interface TimelineInjected {
  /** Start a new task (a Session) in one workspace. */
  readonly createTask: (workspaceId: WorkspaceId) => void
  /** Show an existing Session's conversation. */
  readonly openSession: (sessionId: SessionId) => void
  /** Ask the Host to fold these Sessions so their intervals become readable. */
  readonly ensureProjections: (sessionIds: readonly SessionId[]) => void
}

/** Props the `main` slot assembles for this panel. */
export type TaskTimelinePageProps =
  & PropsRuntime<'main'>
  & PropsLocale<'dsh-tasks'>
  & TimelineInjected

/** Locale key naming each zoom preset. */
const VIEWPORT_KEY: Readonly<Record<ViewportPresetId, TasksKey>> = {
  auto: 'zoom.auto',
  '1h': 'zoom.1h',
  '6h': 'zoom.6h',
  '24h': 'zoom.24h',
}

/** Width of the sticky label column; the grid template and measurement share it. */
const LABEL_COLUMN_PX = 260

/** Track width assumed before the first measurement. */
const FALLBACK_TRACK_PX = 900

/** How long after a gesture a scroll event still counts as the reader's own. */
const GESTURE_WINDOW_MS = 600

/** Turn component-local custom properties into a style object. */
function vars(values: Readonly<Record<string, string>>): CSSProperties {
  return values as CSSProperties
}

/**
 * Render the timeline.
 * @param props - assembled slot props plus the injected actions.
 * @returns the panel element.
 */
export function TaskTimelinePage(props: TaskTimelinePageProps) {
  const {
    useSessions, useWorkspaces, useSessionStatus, t,
    createTask, openSession, ensureProjections,
  } = props

  const workspaces = useWorkspaces(snapshot => snapshot.items)
  const sessions = useSessions(snapshot => snapshot)
  const statuses = useSessionStatus(snapshot => snapshot)

  const [presetId, setPresetId] = useState<ViewportPresetId>('auto')
  const [includeSubagents, setIncludeSubagents] = useState(false)
  const [selected, setSelected] = useState<SessionId | undefined>(undefined)
  const [collapsed, setCollapsed] = useState<readonly WorkspaceId[]>([])
  const [trackPx, setTrackPx] = useState(FALLBACK_TRACK_PX)
  const [now, setNow] = useState(() => Date.now())
  const [following, setFollowing] = useState(true)

  const canvas = useRef<HTMLDivElement | null>(null)
  const gestureAt = useRef(0)

  const viewportMs = VIEWPORT_PRESETS.find(preset => preset.id === presetId)?.ms
  const model = useMemo(
    () => buildTimeline({ workspaces, list: sessions, statuses, now, viewportMs, includeSubagents }),
    [workspaces, sessions, statuses, now, viewportMs, includeSubagents],
  )

  const anyRunning = model.lanes.some(lane => lane.tasks.some(task => task.running))

  useEffect(() => {
    // A running task needs the live cursor; an idle board only needs the clock
    // kept current, so it ticks far less often.
    const period = anyRunning ? 1000 : 30_000
    const timer = setInterval(() => { setNow(Date.now()) }, period)
    return () => { clearInterval(timer) }
  }, [anyRunning])

  useEffect(() => {
    const element = canvas.current
    if (element === null) return
    const measure = (): void => { setTrackPx(Math.max(240, element.clientWidth - LABEL_COLUMN_PX)) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [])

  const unloadedKey = model.unloaded.join('|')
  useEffect(() => {
    if (unloadedKey.length === 0) return
    ensureProjections(unloadedKey.split('|') as SessionId[])
  }, [unloadedKey, ensureProjections])

  const pxPerMs = trackPx / model.viewportMs
  const trackWidthPx = Math.max(model.viewportMs, model.contentTo - model.contentFrom) * pxPerMs
  const step = tickStep(pxPerMs)
  const marks = ticks(model.contentFrom, model.contentTo, step)
  const firstMark = marks[0]
  const nowPx = (now - model.contentFrom) * pxPerMs

  useEffect(() => {
    const element = canvas.current
    if (element === null || !following) return
    element.scrollLeft = centerOffset(now, model.contentFrom, pxPerMs, trackPx)
  }, [following, now, model.contentFrom, pxPerMs, trackPx])

  /** Record a reader gesture; a scroll event shortly after one is the reader's. */
  const noteGesture = (): void => { gestureAt.current = Date.now() }

  const onScroll = (): void => {
    if (Date.now() - gestureAt.current < GESTURE_WINDOW_MS) setFollowing(false)
  }

  const selectedTask = model.lanes
    .flatMap(lane => lane.tasks.map(task => ({ task, workspace: lane })))
    .find(entry => entry.task.sessionId === selected)

  const taskCount = model.lanes.reduce((sum, lane) => sum + lane.tasks.length, 0)

  return (
    <div className={css.page}>
      <div className={css.toolbar}>
        <span className={css.title}>{t('panel.title')}</span>
        <span className={css.summary}>
          {t('panel.summary', { workspaces: model.lanes.length, sessions: taskCount })}
        </span>
        <span className={css.spacer} />

        {!following && (
          <button type="button" className={css.liveButton} onClick={() => { setFollowing(true) }}>
            {t('axis.recenter')}
          </button>
        )}

        <div className={css.group}>
          <span className={css.groupLabel}>{t('zoom.label')}</span>
          <div className={css.segment}>
            {VIEWPORT_PRESETS.map(preset => (
              <button
                key={preset.id}
                type="button"
                className={css.segmentButton}
                data-active={presetId === preset.id}
                onClick={() => { setPresetId(preset.id); setFollowing(true) }}
              >
                {t(VIEWPORT_KEY[preset.id])}
              </button>
            ))}
          </div>
        </div>

        <div className={css.group}>
          <span className={css.groupLabel}>{t('filter.label')}</span>
          <div className={css.segment}>
            <button
              type="button"
              className={css.segmentButton}
              data-active={includeSubagents}
              onClick={() => { setIncludeSubagents(value => !value) }}
            >
              {t('filter.subagents')}
            </button>
          </div>
        </div>
      </div>

      {taskCount === 0
        ? (
          <div className={css.empty}>
            <span className={css.emptyTitle}>{t('panel.empty')}</span>
            <span className={css.emptyHint}>
              {model.unloaded.length > 0
                ? t('panel.loading', { count: model.unloaded.length })
                : t('panel.empty.hint')}
            </span>
          </div>
        )
        : (
          <div
            className={css.canvas}
            ref={canvas}
            onScroll={onScroll}
            onWheel={noteGesture}
            onPointerDown={noteGesture}
          >
            <div
              className={css.grid}
              style={vars({
                '--task-label-width': `${LABEL_COLUMN_PX}px`,
                '--task-track-width': `${trackWidthPx}px`,
                '--task-tick-step': `${step * pxPerMs}px`,
                '--task-tick-origin': `${firstMark === undefined ? 0 : (firstMark - model.contentFrom) * pxPerMs}px`,
              })}
            >
              <div className={`${css.axisLabel} ${css.axisRow}`}>
                {model.hiddenTasks > 0 || model.hiddenWorkspaces > 0
                  ? t('panel.hidden', { tasks: model.hiddenTasks, workspaces: model.hiddenWorkspaces })
                  : ''}
              </div>
              <div className={`${css.axisTrack} ${css.axisRow}`}>
                {marks.map(mark => (
                  <div
                    key={mark}
                    className={css.tick}
                    style={vars({ '--task-left': `${(mark - model.contentFrom) * pxPerMs}px` })}
                  >
                    <span className={css.tickLabel}>{formatTick(mark, step)}</span>
                  </div>
                ))}
                <div
                  className={css.nowNeedle}
                  style={vars({ '--task-left': `${nowPx}px` })}
                  title={t('axis.now')}
                />
              </div>

              {model.lanes.map(lane => {
                const isCollapsed = collapsed.includes(lane.workspaceId)
                return (
                  <Fragment key={lane.workspaceId}>
                    <div className={css.laneTitle}>
                      <button
                        type="button"
                        className={css.laneButton}
                        onClick={() => {
                          setCollapsed(current => current.includes(lane.workspaceId)
                            ? current.filter(id => id !== lane.workspaceId)
                            : [...current, lane.workspaceId])
                        }}
                        title={t(isCollapsed ? 'lane.expand' : 'lane.collapse', { workspace: lane.title })}
                      >
                        <span className={css.caret} aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
                        <span className={css.laneName}>{lane.title}</span>
                        <span className={css.laneCount}>{t('lane.count', { count: lane.tasks.length })}</span>
                      </button>
                      <button
                        type="button"
                        className={css.addButton}
                        title={t('lane.add', { workspace: lane.title })}
                        aria-label={t('lane.add', { workspace: lane.title })}
                        onClick={() => { createTask(lane.workspaceId) }}
                      >
                        +
                      </button>
                    </div>
                    <div className={`${css.laneTrack} ${css.ticked}`} />
                    {!isCollapsed && lane.tasks.map(task => (
                      <Fragment key={task.sessionId}>
                        <div className={css.rowLabel}>
                          <button
                            type="button"
                            className={css.rowButton}
                            data-selected={selected === task.sessionId}
                            onClick={() => { setSelected(task.sessionId) }}
                          >
                            {task.unread && <span className={css.unread} aria-hidden="true" title={t('task.unread')} />}
                            <span className={css.rowTitle}>{task.title}</span>
                          </button>
                        </div>
                        <div className={`${css.rowTrack} ${css.ticked}`}>
                          {task.spans.length > 1 && (
                            <div
                              className={`${css.range} ${PHASE_CLASS[task.phase]}`}
                              style={vars({
                                '--task-left': `${((task.spans[0]?.[0] ?? model.contentFrom) - model.contentFrom) * pxPerMs}px`,
                                '--task-width': `${((task.spans[task.spans.length - 1]?.[1] ?? model.contentTo) - (task.spans[0]?.[0] ?? model.contentFrom)) * pxPerMs}px`,
                              })}
                              aria-hidden="true"
                            />
                          )}
                          {task.spans.map((span, index) => {
                            const geometry = spanOffset(span, model.contentFrom, pxPerMs)
                            return (
                              <div
                                key={`${String(span[0])}-${String(index)}`}
                                className={`${css.bar} ${PHASE_CLASS[task.phase]}`}
                                style={vars({
                                  '--task-left': `${geometry.leftPx}px`,
                                  '--task-width': `${geometry.widthPx}px`,
                                })}
                                data-running={task.running && index === task.spans.length - 1}
                                onClick={() => { setSelected(task.sessionId) }}
                                title={`${task.title} · ${formatClock(span[0])} → ${formatClock(span[1])}`}
                              />
                            )
                          })}
                        </div>
                      </Fragment>
                    ))}
                  </Fragment>
                )
              })}

              <div
                className={css.nowLine}
                style={vars({ '--task-left': `calc(var(--task-label-width) + ${nowPx}px)` })}
                aria-hidden="true"
              />
            </div>

            {selectedTask !== undefined && (
              <TaskDetail
                task={selectedTask.task}
                workspaceTitle={selectedTask.workspace.title}
                t={t}
                onClose={() => { setSelected(undefined) }}
                onOpen={openSession}
              />
            )}
          </div>
        )}
    </div>
  )
}

/** Keep the translate type reachable for consumers of this module's props. */
export type { TasksTranslate }
