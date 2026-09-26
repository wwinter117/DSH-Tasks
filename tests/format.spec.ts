import { describe, expect, it } from 'vitest'
import { formatClock, formatClockSeconds, formatDuration, formatStamp, tickStep, ticks } from '../src/client/format.ts'

const UNITS = { hour: 'h', minute: 'm', second: 's' }

describe('formatClock', () => {
  it('renders hours and minutes in the viewer zone', () => {
    const at = new Date(2026, 8, 26, 9, 5, 30).getTime()
    expect(formatClock(at)).toBe('09:05')
  })

  it('adds seconds when asked', () => {
    const at = new Date(2026, 8, 26, 9, 5, 30).getTime()
    expect(formatClockSeconds(at)).toBe('09:05:30')
  })

  it('renders a month and day stamp for cross-day facts', () => {
    const at = new Date(2026, 8, 26, 9, 5, 30).getTime()
    expect(formatStamp(at)).toBe('09-26 09:05')
  })
})

describe('formatDuration', () => {
  it('uses hours and minutes above an hour', () => {
    expect(formatDuration(3 * 3_600_000 + 5 * 60_000, UNITS)).toBe('3h 05m')
  })

  it('uses minutes and seconds above a minute', () => {
    expect(formatDuration(95_000, UNITS)).toBe('1m 35s')
  })

  it('uses seconds below a minute', () => {
    expect(formatDuration(8_000, UNITS)).toBe('8s')
  })

  it('never renders a negative duration', () => {
    expect(formatDuration(-5_000, UNITS)).toBe('0s')
  })
})

describe('tickStep', () => {
  it('keeps at least the target pixels between two labels', () => {
    for (const windowMs of [15 * 60_000, 3_600_000, 6 * 3_600_000, 24 * 3_600_000]) {
      for (const width of [300, 900, 1600]) {
        const step = tickStep(windowMs, width)
        expect((windowMs / step) * width).toBeGreaterThanOrEqual(110)
      }
    }
  })

  it('never picks a coarser step than the spacing requires', () => {
    // The step below 15 minutes would already clear 110 px at this size.
    expect(tickStep(3_600_000, 4000)).toBe(5 * 60_000)
  })

  it('picks a coarser step when the same window is compressed', () => {
    expect(tickStep(24 * 3_600_000, 300)).toBeGreaterThan(tickStep(24 * 3_600_000, 1200))
  })

  it('falls back to the coarsest step for an absurd window', () => {
    expect(tickStep(365 * 24 * 3_600_000, 800)).toBe(86_400_000)
  })
})

describe('ticks', () => {
  it('aligns ticks to the step and stays inside the window', () => {
    const step = 3_600_000
    const from = new Date(2026, 8, 26, 9, 20).getTime()
    const to = new Date(2026, 8, 26, 12, 5).getTime()
    const marks = ticks(from, to, step)
    expect(marks.map(mark => formatClock(mark))).toEqual(['10:00', '11:00', '12:00'])
  })

  it('returns nothing when the window holds no boundary', () => {
    expect(ticks(1000, 1999, 3_600_000)).toEqual([])
  })
})
