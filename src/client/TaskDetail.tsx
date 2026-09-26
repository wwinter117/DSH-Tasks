/**
 * Detail surface for one task row: the facts a Gantt bar cannot carry.
 * @module dsh-tasks/client/TaskDetail
 */
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TasksTranslate, TimelineTask } from './model.ts'
import { formatClockSeconds, formatDuration, formatStamp } from './format.ts'
import { PHASE_CLASS, PHASE_DOT, PHASE_KEY } from './phase-style.ts'
import css from './Timeline.module.css'

/** Inputs the panel assembles for the detail surface. */
export interface TaskDetailProps {
  readonly task: TimelineTask
  readonly workspaceTitle: string
  readonly t: TasksTranslate
  readonly onClose: () => void
  readonly onOpen: (sessionId: SessionId) => void
}

/**
 * Render the detail surface for one selected task.
 * @param props - selected task, its workspace title, copy, and callbacks.
 * @returns the detail element.
 */
export function TaskDetail({ task, workspaceTitle, t, onClose, onOpen }: TaskDetailProps) {
  const units = { hour: t('unit.hour'), minute: t('unit.minute'), second: t('unit.second') }
  const newestFirst = [...task.spans].reverse()

  return (
    <aside
      className={`${css.detail} ${PHASE_CLASS[task.phase]}`}
      role="dialog"
      aria-label={t('detail.title')}
    >
      <div className={css.detailHead}>
        <span className={css.detailTitle}>{task.title}</span>
        <button type="button" className={css.detailClose} onClick={onClose} aria-label={t('detail.close')}>
          ×
        </button>
      </div>

      <div className={css.detailRow}>
        <span className={css.detailKey}>{t('detail.workspace')}</span>
        <span className={css.detailValue}>{workspaceTitle}</span>
      </div>

      <div className={css.detailRow}>
        <span className={css.detailKey}>{t('detail.phase')}</span>
        <span className={`${css.detailValue} ${css.detailPhase}`}>
          <span className={css.phaseSwatch} aria-hidden="true" />
          <StateDot state={PHASE_DOT[task.phase]} size={8} />
          {t(PHASE_KEY[task.phase])}
        </span>
      </div>

      <div className={css.detailRow}>
        <span className={css.detailKey}>{t('task.lastEvent')}</span>
        <span className={css.detailValue}>{formatStamp(task.lastEventAt)}</span>
      </div>

      <div className={css.detailRow}>
        <span className={css.detailKey}>{t('task.lastPrompt')}</span>
        <span className={css.detailValue}>{formatStamp(task.updatedAt)}</span>
      </div>

      <div className={css.detailRow}>
        <span className={css.detailKey}>{t('detail.spans')}</span>
        <span className={css.detailValue}>{t('task.spanCount', { count: task.spans.length })}</span>
      </div>

      {newestFirst.length === 0
        ? <div className={css.detailKey}>{t('detail.noSpans')}</div>
        : (
          <div className={css.detailSpans}>
            {newestFirst.slice(0, 40).map(span => (
              <div className={css.detailSpan} key={span[0]}>
                <span>{formatClockSeconds(span[0])} → {formatClockSeconds(span[1])}</span>
                <span>{formatDuration(span[1] - span[0], units)}</span>
              </div>
            ))}
          </div>
        )}

      <button type="button" className={css.detailAction} onClick={() => { onOpen(task.sessionId) }}>
        {t('task.open')}
      </button>
    </aside>
  )
}
