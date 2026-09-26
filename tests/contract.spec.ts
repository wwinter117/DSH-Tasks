import { describe, expect, it } from 'vitest'
import {
  EMPTY_TASK_SPANS,
  MAX_SPANS,
  SPAN_GAP_MS,
  SPAN_QUANTUM_MS,
  foldTaskSpans,
  phaseOf,
  toTaskSpansWire,
  type TaskSpansState,
} from '../src/contract.ts'

/** Fold a list of `[type, time]` events in order. */
function fold(events: readonly (readonly [string, number])[]): TaskSpansState {
  let state = EMPTY_TASK_SPANS
  for (const [type, time] of events) state = foldTaskSpans(state, type, time)
  return state
}

const T0 = 1_700_000_000_000

describe('phaseOf', () => {
  it('classifies assistant output and turn openings as generating', () => {
    for (const type of ['assistant/message', 'assistant/attempt', 'turn/start', 'step/start', 'user/message']) {
      expect(phaseOf(type, 'idle')).toBe('generating')
    }
  })

  it('classifies tool traffic as tool', () => {
    expect(phaseOf('tool/call', 'idle')).toBe('tool')
    expect(phaseOf('tool/result', 'idle')).toBe('tool')
  })

  it('classifies a closed turn as idle', () => {
    expect(phaseOf('turn/end', 'tool')).toBe('idle')
    expect(phaseOf('session/end-seed', 'generating')).toBe('idle')
  })

  it('classifies delegated namespaces by prefix, so an absent contributor never matches', () => {
    expect(phaseOf('subagent/start', 'idle')).toBe('delegated')
    expect(phaseOf('job/settled', 'idle')).toBe('delegated')
  })

  it('keeps the previous phase for an unrecognised event', () => {
    expect(phaseOf('todo/write', 'tool')).toBe('tool')
    expect(phaseOf('something/else', 'generating')).toBe('generating')
  })
})

describe('foldTaskSpans', () => {
  it('opens a zero-length span on the first event and publishes the exact instant', () => {
    const state = fold([['turn/start', T0]])
    expect(state.started).toBe(true)
    expect(state.wire.spans).toEqual([[T0, T0]])
    expect(state.wire.lastEventAt).toBe(T0)
    expect(state.wire.phase).toBe('generating')
  })

  it('extends the open span while events stay inside the gap', () => {
    const state = fold([['turn/start', T0], ['tool/call', T0 + 1000], ['tool/result', T0 + 2000]])
    expect(state.wire.spans).toHaveLength(1)
    expect(state.wire.spans[0]?.[0]).toBe(T0)
    expect(state.wire.phase).toBe('tool')
  })

  it('opens a new span once the gap is exceeded', () => {
    const state = fold([['turn/start', T0], ['turn/start', T0 + SPAN_GAP_MS + 1]])
    expect(state.wire.spans).toEqual([[T0, T0], [T0 + SPAN_GAP_MS + 1, T0 + SPAN_GAP_MS + 1]])
  })

  it('treats an event exactly on the gap boundary as contiguous', () => {
    const state = fold([['turn/start', T0], ['turn/start', T0 + SPAN_GAP_MS]])
    expect(state.wire.spans).toHaveLength(1)
  })

  it('opens a new span when time moves backwards', () => {
    const state = fold([['turn/start', T0], ['turn/start', T0 - 1]])
    expect(state.wire.spans).toHaveLength(2)
  })

  it('drops the oldest span once the cap is reached', () => {
    const events: (readonly [string, number])[] = []
    for (let index = 0; index < MAX_SPANS + 5; index += 1) {
      events.push(['turn/start', T0 + index * (SPAN_GAP_MS + 1)])
    }
    const state = fold(events)
    expect(state.wire.spans).toHaveLength(MAX_SPANS)
    // The oldest survivors start after the dropped head.
    expect(state.wire.spans[0]?.[0]).toBe(T0 + 5 * (SPAN_GAP_MS + 1))
  })

  it('trims the published open end to the quantization grid', () => {
    const state = fold([['turn/start', T0], ['turn/start', T0 + 10 * SPAN_QUANTUM_MS + 400]])
    const end = state.wire.spans[0]?.[1]
    expect(end).toBe(T0 + 10 * SPAN_QUANTUM_MS)
    expect(state.wire.lastEventAt).toBe(end)
    // The exact instant survives for the next gap decision.
    expect(state.lastEventAt).toBe(T0 + 10 * SPAN_QUANTUM_MS + 400)
  })
})

describe('wire publication', () => {
  it('reuses the published reference while only sub-quantum detail moved', () => {
    const first = fold([['turn/start', T0]])
    const second = foldTaskSpans(first, 'assistant/message', T0 + 10)
    expect(second.wire).toBe(first.wire)
  })

  it('publishes a new reference when the phase changes', () => {
    const first = fold([['turn/start', T0]])
    const second = foldTaskSpans(first, 'turn/end', T0 + 10)
    expect(second.wire).not.toBe(first.wire)
    expect(second.wire.phase).toBe('idle')
  })

  it('publishes a new reference when a span opens', () => {
    const first = fold([['turn/start', T0]])
    const second = foldTaskSpans(first, 'turn/start', T0 + SPAN_GAP_MS + 1)
    expect(second.wire).not.toBe(first.wire)
  })

  it('publishes a new reference once the open end crosses a quantum', () => {
    const first = fold([['turn/start', T0]])
    const second = foldTaskSpans(first, 'assistant/message', T0 + SPAN_QUANTUM_MS)
    expect(second.wire).not.toBe(first.wire)
  })

  it('exposes exactly the state the fold published', () => {
    const state = fold([['turn/start', T0], ['tool/call', T0 + 5]])
    expect(toTaskSpansWire(state)).toBe(state.wire)
  })
})

describe('EMPTY_TASK_SPANS', () => {
  it('describes a Session with no committed events', () => {
    expect(EMPTY_TASK_SPANS.started).toBe(false)
    expect(EMPTY_TASK_SPANS.wire).toEqual({ spans: [], lastEventAt: 0, phase: 'idle' })
  })

  it('is plain JSON, which the persisted projection cache requires', () => {
    const state = fold([['turn/start', T0], ['tool/call', T0 + 1000]])
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })
})
