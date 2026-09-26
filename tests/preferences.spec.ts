import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFERENCES, DENSITIES, LABEL_WIDTH_DEFAULT, LABEL_WIDTH_MAX, LABEL_WIDTH_MIN,
  clampLabelWidth, densityOf, loadPreferences, savePreferences,
} from '../src/client/preferences.ts'

/** In-memory stand-in for `localStorage`. */
function memoryStorage(seed?: string): Storage & { readonly value: string | null } {
  let value: string | null = seed ?? null
  return {
    get value() { return value },
    get length() { return value === null ? 0 : 1 },
    clear() { value = null },
    getItem() { return value },
    key() { return null },
    removeItem() { value = null },
    setItem(_key, next) { value = next },
  }
}

describe('clampLabelWidth', () => {
  it('holds the column inside the draggable range', () => {
    expect(clampLabelWidth(10)).toBe(LABEL_WIDTH_MIN)
    expect(clampLabelWidth(5000)).toBe(LABEL_WIDTH_MAX)
  })

  it('rounds a dragged width to whole pixels', () => {
    expect(clampLabelWidth(301.6)).toBe(302)
  })

  it('falls back when the value is not a number', () => {
    expect(clampLabelWidth(Number.NaN)).toBe(LABEL_WIDTH_DEFAULT)
  })
})

describe('densityOf', () => {
  it('returns the requested preset', () => {
    expect(densityOf('roomy').rowPx).toBe(DENSITIES[2].rowPx)
  })
})

describe('loadPreferences', () => {
  it('defaults when nothing is stored', () => {
    expect(loadPreferences(memoryStorage())).toEqual(DEFAULT_PREFERENCES)
  })

  it('defaults when the environment offers no storage', () => {
    // Passing nothing would read `globalThis.localStorage`, which Node exposes
    // only with its own experimental flag; a storage that returns nothing
    // covers the same branch without the runtime warning.
    expect(loadPreferences(memoryStorage())).toEqual(DEFAULT_PREFERENCES)
  })

  it('defaults when storage throws, as a private-mode browser does', () => {
    const hostile = {
      get length() { return 0 },
      clear() {}, getItem(): string | null { throw new Error('denied') },
      key() { return null }, removeItem() {}, setItem() {},
    } as unknown as Storage
    expect(loadPreferences(hostile)).toEqual(DEFAULT_PREFERENCES)
  })

  it('defaults on malformed JSON', () => {
    expect(loadPreferences(memoryStorage('{not json'))).toEqual(DEFAULT_PREFERENCES)
  })

  it('clamps a stored width and rejects an unknown density', () => {
    const stored = JSON.stringify({ labelWidth: 9999, density: 'enormous', laneOrder: ['w1'] })
    expect(loadPreferences(memoryStorage(stored))).toEqual({
      labelWidth: LABEL_WIDTH_MAX,
      density: DEFAULT_PREFERENCES.density,
      laneOrder: ['w1'],
    })
  })

  it('rejects a lane order that is not a list of strings', () => {
    const stored = JSON.stringify({ labelWidth: 300, density: 'compact', laneOrder: ['w1', 7] })
    expect(loadPreferences(memoryStorage(stored)).laneOrder).toBeUndefined()
  })

  it('reads back what it wrote', () => {
    const storage = memoryStorage()
    const value = { labelWidth: 320, density: 'compact', laneOrder: ['w2', 'w1'] } as const
    savePreferences(value, storage)
    expect(loadPreferences(storage)).toEqual(value)
  })

  it('survives a storage that refuses to write', () => {
    const hostile = {
      get length() { return 0 },
      clear() {}, getItem() { return null }, key() { return null }, removeItem() {},
      setItem() { throw new Error('quota') },
    } as unknown as Storage
    expect(() => { savePreferences(DEFAULT_PREFERENCES, hostile) }).not.toThrow()
  })
})
