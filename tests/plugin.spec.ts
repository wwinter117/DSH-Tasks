import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { afterEach, describe, expect, it } from 'vitest'
import { PROJECTION_KEY } from '../src/contract.ts'
import * as plugin from '../src/index.ts'

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

/**
 * Boot a root context carrying the real Session store and projection registry,
 * then mount this plugin exactly as the Loader would: as the module namespace
 * with its `apply` and `inject` exports.
 */
async function boot(): Promise<Context> {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(plugin).await()
  return ctx
}

describe('host half against the real projection registry', () => {
  it('folds committed events into one published work interval', async () => {
    const ctx = await boot()
    const session = ctx.sessions.create(SessionId('dsh-tasks-fold'))
    session.append('turn/start', { turn: 1 })
    session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('call-1'), name: 'bash', arguments: '{}' })
    session.append('step/end', { turn: 1, step: 1 })

    const state = ctx.sessionProjections.stateOf(session, PROJECTION_KEY)
    expect(state?.started).toBe(true)
    // The three commits happen within milliseconds, so they coalesce into one segment.
    expect(state?.wire.spans).toHaveLength(1)
    expect(state?.wire.phase).toBe('tool')
    expect(state?.wire.lastEventAt).toBe(state?.wire.spans[0]?.[1])
  })

  it('publishes the same wire value the state holds', async () => {
    const ctx = await boot()
    const session = ctx.sessions.create(SessionId('dsh-tasks-snapshot'))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })

    const state = ctx.sessionProjections.stateOf(session, PROJECTION_KEY)
    const snapshot = ctx.sessionProjections.snapshot(session)
    expect(snapshot.values[PROJECTION_KEY]).toEqual(state?.wire)
    expect(state?.wire.phase).toBe('generating')
  })

  it('reports the phase each committed event establishes', async () => {
    const ctx = await boot()
    const session = ctx.sessions.create(SessionId('dsh-tasks-phases'))
    session.append('turn/start', { turn: 1 })
    expect(ctx.sessionProjections.stateOf(session, PROJECTION_KEY)?.wire.phase).toBe('generating')
    session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('call-1'), name: 'bash', arguments: '{}' })
    expect(ctx.sessionProjections.stateOf(session, PROJECTION_KEY)?.wire.phase).toBe('tool')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(ctx.sessionProjections.stateOf(session, PROJECTION_KEY)?.wire.phase).toBe('idle')
  })

  it('starts empty for a Session with no committed events', async () => {
    const ctx = await boot()
    const session = ctx.sessions.create(SessionId('dsh-tasks-empty'))
    expect(ctx.sessionProjections.stateOf(session, PROJECTION_KEY)).toEqual({
      lastEventAt: 0,
      started: false,
      wire: { spans: [], lastEventAt: 0, phase: 'idle' },
    })
  })

  it('releases its key when the plugin is disposed', async () => {
    const ctx = new Context()
    roots.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)

    const fiber = ctx.plugin(plugin)
    await fiber.await()
    await fiber.dispose()

    // A fresh mount finds the key free, which is the HMR-safety contract every
    // registry contribution owes.
    const second = ctx.plugin(plugin)
    await expect(second.await()).resolves.toBeDefined()
  })

  it('declares the service it reads', () => {
    expect(plugin.inject).toEqual(['sessionProjections'])
    expect(plugin.name).toBe('task-timeline')
  })
})
