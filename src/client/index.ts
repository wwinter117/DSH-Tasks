/**
 * Browser half of dsh-tasks.
 *
 * Two contributions: the `main` panel that holds the timeline, and the
 * `sidebar.panellist` entry that selects it. The panel id is the `main` key and
 * the list id at once — that pairing is what makes the sidebar row open this
 * panel.
 *
 * The `import type` lines carry no runtime edge. They pull the owning packages'
 * declaration merges into the program so the slot keys and the framework-provided
 * standard props (`useWorkspaces`, `useSessions`, `useSessionStatus`) are typed.
 * @module dsh-tasks/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { TasksKey } from './locales.ts'
import { NS, en, zh } from './locales.ts'
import { TaskTimelinePage, type TimelineInjected } from './TaskTimelinePage.tsx'
import { TasksPanelIcon } from './TasksPanelIcon.tsx'

/** Shared id: the `main` slot key and the `sidebar.panellist` list id. */
const PANEL_ID = 'task-timeline'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-tasks': TasksKey
  }
}

/** Services this plugin's registrations read. */
export const inject = ['slots', 'locale', 'sessions', 'uiWorkspace', 'layout']

/**
 * Register the panel and its sidebar entry.
 * @param ctx - client plugin context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-tasks: dictionaries')

  // One fold request per Session per page load. The Host caches the folded row,
  // so a repeat request for the same Session only re-reads the same log.
  const requested = new Set<SessionId>()
  ctx.effect(() => () => { requested.clear() }, 'dsh-tasks: projection request ledger')

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: (): TimelineInjected => ({
      createTask: (workspaceId) => { ctx.uiWorkspace.startSession(workspaceId) },
      openSession: (sessionId) => {
        ctx.uiWorkspace.openSession(sessionId)
        // `null` clears the explicit panel choice, so the frame returns to the
        // reserved `conversation` panel the Session was just selected for.
        ctx.layout.selectPanel(null)
      },
      ensureProjections: (sessionIds) => {
        for (const sessionId of sessionIds) {
          if (requested.has(sessionId)) continue
          requested.add(sessionId)
          ctx.sessions.refreshProjections(sessionId).catch((reason: unknown) => {
            // A refused fold leaves the row without intervals; allow a retry on
            // the next model build rather than losing the Session for the page.
            requested.delete(sessionId)
            ctx.logger.warn('dsh-tasks: projection refresh rejected for %s: %o', sessionId, reason)
          })
        }
      },
    }),
  }, TaskTimelinePage))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 12,
    label: () => t('panel.title'),
    locale: NS,
  }, TasksPanelIcon))
}
