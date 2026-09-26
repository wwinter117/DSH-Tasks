/**
 * The host half's single contribution: the `dshTasksSpans` Session projection.
 *
 * Registering it here rather than behind a Remote of our own is what makes the
 * work intervals arrive with the Session list — cold Sessions included, through
 * the persisted projection cache — and update live over the existing projection
 * change feed. A third-party bundle cannot extend the Remote event allowlist, so
 * this is also the only push channel available to it.
 *
 * The key's declaration merge lives in `./contract.ts`, because the browser half
 * must see the same key to read the value back.
 * @module dsh-tasks/projection
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type { TaskSpansState } from './contract.ts'
import { EMPTY_TASK_SPANS, foldTaskSpans, toTaskSpansWire } from './contract.ts'

/** One `[startMs, endMs]` interval as it crosses the wire. */
const spanSchema = z.tuple([z.number(), z.number()])

/** Wire payload schema; the host validates every value before it leaves. */
const wireSchema = z.object({
  spans: z.array(spanSchema),
  lastEventAt: z.number(),
  phase: z.enum(['idle', 'generating', 'tool', 'delegated']),
})

/**
 * Persisted-state schema. The host validates a cached row before seeding a fold
 * from it, so a row written by an older `stateVersion` cannot be forward-applied
 * into garbage.
 */
const stateSchema = z.object({
  lastEventAt: z.number(),
  started: z.boolean(),
  wire: wireSchema,
})

/**
 * Register the interval projection on the Session projection registry.
 * @param ctx - registrant context carrying `sessionProjections`.
 */
export function registerTaskSpans(ctx: Context): void {
  ctx.sessionProjections.register<'dshTasksSpans', TaskSpansState>({
    key: 'dshTasksSpans',
    stateSchema,
    // Bump when the serialized fields or the fold semantics change: cached rows
    // from an older version are then discarded instead of being reused.
    stateVersion: 1,
    init: () => EMPTY_TASK_SPANS,
    apply: (state, event) => foldTaskSpans(state, event.type, event.time),
    wire: { viewSchema: wireSchema, view: toTaskSpansWire },
  })
}
