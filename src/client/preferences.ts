/**
 * View preferences the panel remembers in this browser.
 *
 * These are viewing choices, not DSH state: nothing here belongs in a Session
 * log or in the Host, so they live in `localStorage` next to the panel. Anything
 * read back is validated, because the stored value is untrusted input.
 * @module dsh-tasks/client/preferences
 */

/** Narrowest label column the reader can drag to. */
export const LABEL_WIDTH_MIN = 160
/** Widest label column the reader can drag to. */
export const LABEL_WIDTH_MAX = 520
/** Label column width before the reader drags it. */
export const LABEL_WIDTH_DEFAULT = 260

/** Row height presets, from densest to roomiest. */
export const DENSITIES = [
  { id: 'compact', rowPx: 20, lanePx: 24, barPx: 8 },
  { id: 'cosy', rowPx: 26, lanePx: 30, barPx: 10 },
  { id: 'roomy', rowPx: 34, lanePx: 38, barPx: 14 },
] as const

/** One row-height preset identity. */
export type DensityId = (typeof DENSITIES)[number]['id']

/** Stored view preferences. */
export interface ViewPreferences {
  /** Label column width in CSS pixels. */
  readonly labelWidth: number
  /** Row height preset. */
  readonly density: DensityId
  /** A manually chosen lane order, or `undefined` while the automatic order applies. */
  readonly laneOrder: readonly string[] | undefined
}

/** What the panel shows before the reader changes anything. */
export const DEFAULT_PREFERENCES: ViewPreferences = {
  labelWidth: LABEL_WIDTH_DEFAULT,
  density: 'cosy',
  laneOrder: undefined,
}

/** Where the panel keeps these. */
const STORAGE_KEY = 'dsh-tasks/view-preferences'

/** Clamp a label width into the draggable range. */
export function clampLabelWidth(width: number): number {
  if (!Number.isFinite(width)) return LABEL_WIDTH_DEFAULT
  return Math.min(LABEL_WIDTH_MAX, Math.max(LABEL_WIDTH_MIN, Math.round(width)))
}

/** Read one density preset, falling back to the default. */
export function densityOf(id: DensityId): (typeof DENSITIES)[number] {
  return DENSITIES.find(entry => entry.id === id) ?? DENSITIES[1]
}

/**
 * Parse a stored value, dropping anything that does not fit the contract.
 * @param raw - parsed JSON of unknown shape.
 * @returns the preferences it establishes, or the defaults.
 */
function parse(raw: unknown): ViewPreferences {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_PREFERENCES
  const record = raw as Record<string, unknown>
  const width = typeof record.labelWidth === 'number' ? clampLabelWidth(record.labelWidth) : LABEL_WIDTH_DEFAULT
  const density = DENSITIES.some(entry => entry.id === record.density)
    ? record.density as DensityId
    : DEFAULT_PREFERENCES.density
  const order = Array.isArray(record.laneOrder) && record.laneOrder.every(entry => typeof entry === 'string')
    ? record.laneOrder as string[]
    : undefined
  return { labelWidth: width, density, laneOrder: order }
}

/**
 * Read the stored preferences.
 * @param storage - storage to read, defaulting to the browser's.
 * @returns the stored preferences, or the defaults when nothing valid is stored.
 */
export function loadPreferences(storage: Storage | undefined = globalThis.localStorage): ViewPreferences {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (raw === null || raw === undefined) return DEFAULT_PREFERENCES
    return parse(JSON.parse(raw))
  } catch {
    // Private-mode storage, a quota error, or malformed JSON all mean "no preference".
    return DEFAULT_PREFERENCES
  }
}

/**
 * Store the preferences, ignoring a storage that refuses to write.
 * @param preferences - the value to remember.
 * @param storage - storage to write, defaulting to the browser's.
 */
export function savePreferences(
  preferences: ViewPreferences,
  storage: Storage | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // A refusal to persist is not worth interrupting the reader over.
  }
}
