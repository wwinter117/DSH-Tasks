/**
 * Sidebar entry icon for the task timeline panel.
 * @module dsh-tasks/client/TasksPanelIcon
 */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Props the `sidebar.panellist` slot assembles for this icon. */
export type TasksPanelIconProps = PropsRuntime<'sidebar.panellist'>

/**
 * Render the sidebar glyph: three offset bars, the timeline's own motif.
 * @param props - owner-supplied size and selection state.
 * @returns the icon element.
 */
export function TasksPanelIcon({ size, active }: TasksPanelIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      data-active={active ? 'true' : 'false'}
    >
      <rect x="1" y="3" width="9" height="2.5" rx="1.25" fill="currentColor" />
      <rect x="4" y="6.75" width="11" height="2.5" rx="1.25" fill="currentColor" opacity="0.72" />
      <rect x="2" y="10.5" width="6" height="2.5" rx="1.25" fill="currentColor" opacity="0.48" />
    </svg>
  )
}
