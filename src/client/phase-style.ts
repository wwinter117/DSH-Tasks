/**
 * Phase presentation: the bar hue class and the reusable state dot each phase
 * maps to. Kept apart from the components so the mapping is stated once.
 * @module dsh-tasks/client/phase-style
 */
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TaskPhase } from '../contract.ts'
import type { TasksKey } from './locales.ts'
import css from './Timeline.module.css'

/**
 * Read one generated class name, failing loudly when the stylesheet no longer
 * declares it. The module map is typed as an index signature, so a renamed class
 * would otherwise degrade to an unstyled bar instead of an error.
 * @param name - class name as written in the stylesheet.
 * @returns the hashed class name.
 */
function classOf(name: string): string {
  const value = css[name]
  /* v8 ignore next -- the stylesheet declares every name this module reads. */
  if (value === undefined) throw new Error(`dsh-tasks: stylesheet has no class ${name}`)
  return value
}

/** CSS Module class carrying the phase's bar colour. */
export const PHASE_CLASS: Readonly<Record<TaskPhase, string>> = {
  idle: classOf('phaseIdle'),
  generating: classOf('phaseGenerating'),
  tool: classOf('phaseTool'),
  delegated: classOf('phaseDelegated'),
  approval: classOf('phaseApproval'),
  question: classOf('phaseQuestion'),
}

/**
 * Coarse state the shared `StateDot` primitive already expresses. The six phases
 * collapse to three dot states on purpose: the dot says whether the task needs
 * the viewer, the bar hue says what it is doing.
 */
export const PHASE_DOT: Readonly<Record<TaskPhase, StateDotState>> = {
  idle: 'idle',
  generating: 'ongoing',
  tool: 'ongoing',
  delegated: 'ongoing',
  approval: 'warning',
  question: 'warning',
}

/** Locale key naming each phase. */
export const PHASE_KEY: Readonly<Record<TaskPhase, TasksKey>> = {
  idle: 'phase.idle',
  generating: 'phase.generating',
  tool: 'phase.tool',
  delegated: 'phase.delegated',
  approval: 'phase.approval',
  question: 'phase.question',
}
