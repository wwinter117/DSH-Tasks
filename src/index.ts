/**
 * Host half of dsh-tasks.
 *
 * One contribution: the `dshTasksSpans` Session projection, which folds every
 * committed Session event into the work intervals and current phase the timeline
 * draws. See `docs/design.md` for why the intervals are computed here instead of
 * in the browser.
 * @module dsh-tasks
 */
import type { Context } from '@deepseek-ai/cordis'
import { registerTaskSpans } from './projection.ts'

/** Display name recorded in Loader diagnostics. */
export const name = 'task-timeline'

/**
 * Services this plugin cannot work without. An unsatisfied entry leaves the
 * plugin pending rather than mounting a timeline with no data behind it.
 */
export const inject = ['sessionProjections']

/**
 * Register the plugin's contributions on the profile's root context.
 * @param ctx - registrant context.
 */
export function apply(ctx: Context): void {
  registerTaskSpans(ctx)
  ctx.logger.info('dsh-tasks: task spans projection registered')
}
