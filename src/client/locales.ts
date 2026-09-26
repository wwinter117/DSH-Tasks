/** Locale namespace owned by dsh-tasks. */
export const NS = 'dsh-tasks'

/** Chinese copy; the key set is the source of truth for the namespace. */
export const zh = {
  'panel.title': '任务时间轴',
  'panel.summary': '{workspaces} 个工作区 · {sessions} 个任务',
  'panel.hidden': '已隐藏 {tasks} 个子代理会话、{workspaces} 个窗口外工作区',
  'panel.empty': '这个时间窗口内没有任务活动。',
  'panel.empty.hint': '切换更大的窗口，或开启「显示子代理会话」。',
  'panel.loading': '正在读取 {count} 个任务的活动区间…',

  'window.auto': '自适应',
  'window.1h': '1 小时',
  'window.6h': '6 小时',
  'window.24h': '24 小时',
  'window.label': '时间窗口',

  'filter.subagents': '显示子代理会话',
  'filter.label': '过滤',

  'axis.now': '现在',

  'lane.count': '{count} 个任务',
  'lane.add': '在 {workspace} 新建任务',
  'lane.collapse': '折叠 {workspace}',
  'lane.expand': '展开 {workspace}',

  'task.spanCount': '{count} 段活动',
  'task.lastEvent': '最后活动',
  'task.lastPrompt': '最后推进',
  'task.created': '创建于',
  'task.unread': '有未查看的完成',
  'task.open': '打开会话',
  'task.clippedStart': '活动在窗口左侧之前开始',
  'task.clippedEnd': '活动在窗口右侧之后继续',

  'phase.idle': '空闲',
  'phase.generating': '正在生成',
  'phase.tool': '正在调工具',
  'phase.delegated': '正在等子任务',
  'phase.approval': '等你审批',
  'phase.question': '等你回答',

  'detail.title': '任务详情',
  'detail.workspace': '工作区',
  'detail.phase': '当前状态',
  'detail.close': '关闭',
  'detail.spans': '活动区间',
  'detail.spanRange': '{start} → {end}',
  'detail.duration': '时长',
  'detail.noSpans': '没有已记录的活动区间。',

  'unit.hour': '小时',
  'unit.minute': '分',
  'unit.second': '秒',
} as const

/** Every message key this namespace owns. */
export type TasksKey = keyof typeof zh

/** English copy; the record type rejects a key set that drifts from Chinese. */
export const en: Record<TasksKey, string> = {
  'panel.title': 'Task timeline',
  'panel.summary': '{workspaces} workspaces · {sessions} tasks',
  'panel.hidden': 'Hiding {tasks} subagent sessions and {workspaces} out-of-window workspaces',
  'panel.empty': 'No task was active inside this window.',
  'panel.empty.hint': 'Pick a wider window, or show subagent sessions.',
  'panel.loading': 'Reading activity for {count} tasks…',

  'window.auto': 'Auto',
  'window.1h': '1 hour',
  'window.6h': '6 hours',
  'window.24h': '24 hours',
  'window.label': 'Time window',

  'filter.subagents': 'Show subagent sessions',
  'filter.label': 'Filters',

  'axis.now': 'now',

  'lane.count': '{count} tasks',
  'lane.add': 'New task in {workspace}',
  'lane.collapse': 'Collapse {workspace}',
  'lane.expand': 'Expand {workspace}',

  'task.spanCount': '{count} segments',
  'task.lastEvent': 'Last activity',
  'task.lastPrompt': 'Last prompt',
  'task.created': 'Created',
  'task.unread': 'Unviewed completion',
  'task.open': 'Open session',
  'task.clippedStart': 'Activity starts before the window',
  'task.clippedEnd': 'Activity continues past the window',

  'phase.idle': 'Idle',
  'phase.generating': 'Generating',
  'phase.tool': 'Running a tool',
  'phase.delegated': 'Waiting on a subtask',
  'phase.approval': 'Waiting for your approval',
  'phase.question': 'Waiting for your answer',

  'detail.title': 'Task detail',
  'detail.workspace': 'Workspace',
  'detail.phase': 'Current state',
  'detail.close': 'Close',
  'detail.spans': 'Activity segments',
  'detail.spanRange': '{start} → {end}',
  'detail.duration': 'Duration',
  'detail.noSpans': 'No recorded activity segment.',

  'unit.hour': 'h',
  'unit.minute': 'm',
  'unit.second': 's',
}
