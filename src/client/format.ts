/**
 * Formatting helpers for the timeline. Pure functions, so tick selection and
 * duration text are unit-testable without a renderer.
 * @module dsh-tasks/client/format
 */

/** Two-digit zero padding. */
function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/**
 * Wall-clock time of an instant, in the viewer's zone.
 * @param ms - Unix epoch milliseconds.
 * @returns `HH:MM`.
 */
export function formatClock(ms: number): string {
  const at = new Date(ms)
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * Wall-clock time with seconds, for the live cursor and detail rows.
 * @param ms - Unix epoch milliseconds.
 * @returns `HH:MM:SS`.
 */
export function formatClockSeconds(ms: number): string {
  const at = new Date(ms)
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
}

/**
 * Date and time of an instant, for facts that may not be from today.
 * @param ms - Unix epoch milliseconds.
 * @returns `MM-DD HH:MM`.
 */
export function formatStamp(ms: number): string {
  const at = new Date(ms)
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** Unit suffixes a duration reads with, supplied by the locale dictionary. */
export interface DurationUnits {
  readonly hour: string
  readonly minute: string
  readonly second: string
}

/**
 * Render a duration at two significant units.
 * @param ms - duration in milliseconds.
 * @param units - localized unit suffixes.
 * @returns the duration text, for example `2h 05m`.
 */
export function formatDuration(ms: number, units: DurationUnits): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}${units.hour} ${pad(minutes)}${units.minute}`
  if (minutes > 0) return `${minutes}${units.minute} ${pad(seconds)}${units.second}`
  return `${seconds}${units.second}`
}

/** Candidate tick spacings, coarse enough that a label fits between two ticks. */
const TICK_STEPS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  3_600_000,
  3 * 3_600_000,
  6 * 3_600_000,
  12 * 3_600_000,
  86_400_000,
] as const

/**
 * Choose the tick spacing that keeps roughly `target` pixels between grid lines.
 * @param windowMs - drawn window length in milliseconds.
 * @param widthPx - track width in pixels.
 * @param target - desired pixels between two ticks.
 * @returns the chosen spacing in milliseconds.
 */
export function tickStep(windowMs: number, widthPx: number, target = 110): number {
  const wanted = windowMs * (target / Math.max(1, widthPx))
  for (const step of TICK_STEPS) {
    if (step >= wanted) return step
  }
  return TICK_STEPS[TICK_STEPS.length - 1] as number
}

/**
 * Tick instants aligned to the step boundary, covering the window.
 * @param from - window left edge.
 * @param to - window right edge.
 * @param step - tick spacing.
 * @returns tick instants in ascending order.
 */
export function ticks(from: number, to: number, step: number): number[] {
  const first = Math.ceil(from / step) * step
  const out: number[] = []
  for (let at = first; at <= to && out.length < 200; at += step) out.push(at)
  return out
}
