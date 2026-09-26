# DSH-Tasks 设计文档

> 一个 DSH 插件：把 DSH 的每个工作区、每个会话，画成一条横向甘特时间轴，实时显示每个任务处在哪个相位。

本文档是设计记录，记录**为什么这样设计**，以及每条决定依赖的 DSH 事实（附源码出处）。当前实现状态见仓库根 README。

---

## 1. 问题

DSH 的会话是按工作区组织的，但现有 GUI 只有**纵向列表**（侧边栏工作区浏览器、自动化任务页）。当同时有多个工作区、每个工作区多个会话在跑时，有两个问题看不到答案：

1. **现在到底有哪些任务在跑？**（跨工作区的一览）
2. **哪些任务卡在我这里？**（等审批、等回答）

纵向列表能回答"某个工作区有哪些会话"，但回答不了"跨工作区、按时间对齐"的问题。这正是横向时间轴要补的位置。

## 2. 核心决定

| # | 决定 | 选择 | 理由 |
|---|---|---|---|
| D1 | 「任务」是什么 | **任务 ≡ 会话** | 标题、起止、状态、归属工作区全部现成；不需要第二套生命周期 |
| D2 | 横轴时间语义 | **真实墙上时间 + 自动视窗** | 有会话在跑时右端跟随「现在」，空闲时视窗收缩并隐藏无活动工作区 |
| D3 | 任务条语义 | **真实工作时段（多段）** | 一个会话画成多段，段间留空隙；段 = 真的有事件活动的时间区间 |
| D4 | 纵向结构 | **一行 = 一个会话，工作区做分组标题** | 多段条天然可读、行高恒定；经典甘特做法 |
| D5 | 状态词汇表 | **6 相位** | 3 个工作相位 + 2 个等待相位 + 空闲；`completionUnread` 降级为角标 |
| D6 | 交付形态 | **独立仓库 + 可安装 bundle** | 一个包两面（host + client），从 Plugins 页安装 |

## 3. 依赖的 DSH 事实

每一条都是勘察源码确认的，不是推测。

### 3.1 工作区与会话

- **Workspace** = 稳定 uuid + 规范化路径（`fs.realpath`）+ 标题 + 有序 `sessionIds`。成员资格要求「id 在名册里」**且**「会话 header 的 cwd 规范化后等于工作区路径」。服务是 `ctx.workspaceRegistry`（`ctx.workspace`），持久化在 `~/.dsh/storages/workspace.json`。
- **Session** 持久化为 `~/.dsh/sessions/<cwd-slug>/<sessionId>/session.v4.jsonl.zstd`，每条事件带 `time`（epoch ms）。`SessionHeader.createdAt` 是 epoch ms。
- 一个工作区**可以有任意多个并发会话**；`AgentRegistry` 是 `Map<SessionId, AgentEntry>`，只有归档会话被门禁。
- 会话**没有「结束」概念**，只有 `archivedSessionIds`。

### 3.2 标题

标题是一等的、日志支撑的：`session/title` 事件，来源三种 —— `fallback`（取首条人类消息的前 N 词）、`provider`（LLM 生成）、`user`（手动改名并**钉住**，之后的自动生成被跳过）。

**shipped 组合只注册了 first-prompt 节奏**（`packages/bundle/base/cordis.patch.yml` → `@deepseek-ai/dsh-session-title-first-prompt-llm`），所以标题生成一次就稳定，只有手动改名会变。因此「会话开始时的标题」与当前标题在实践中是同一个，改名同步显示是正确行为。

客户端注意：**存在两个同名 `SessionSummary`**。wire 层那个（`dsh-api-session-controller` 的 `types.d.ts`）带 `sessionId` / `parentSessionId`，而客户端行对象那个（`.../client` 的 `sessions/service.d.ts`）字段名是 `id` / `parentId`，并且**自带 `title` 和 `displayTitle`**（"durable title → project basename → session id" 的兜底链）。

实现选择直接用 `displayTitle`：它就是侧边栏给同一会话显示的标签，时间轴与侧边栏一致比自造兜底更有价值。

这个陷阱还真的咬过一次：早期版本的子代理过滤写成 `summary.parentSessionId !== undefined`，而该参数在结构类型里是**可选**的，所以类型检查放过了它、运行期永远读到 `undefined`——过滤实际上只靠 `origin` 生效。修正后与工作区树自己的 `origin === 'subagent'` 规则对齐（fork 有 parent 但不是子代理，fork 是独立任务）。

### 3.3 状态：为什么必须自己算

存在三层正交事实：

- **`AgentStatus = 'idle' | 'running'`**（host）。关键陷阱：**卡在等审批或等回答时，`running` 仍然是 `true`**。
- **`workspace/session-activity` waterfall**（host）——合并 turn / job / subagent / schedule 家族的完整「是否在干活」答案。
- **客户端 `SessionStatus`**：`running: boolean | undefined`、`pendingInteraction`（`approval` | `question`）、`completionUnread`。

前两层客户端拿不到，第三层只有三个布尔/枚举事实，**不足以区分「正在生成」和「正在调工具」**。所以相位必须由插件自己在 host 侧折叠事件流得出 —— 见 §4。

### 3.4 时间戳：可得的与不可得的

| 事实 | 可得性 |
|---|---|
| 会话创建时间 `SessionHeader.createdAt` | ✅ epoch ms |
| 每条事件的 `time` | ✅ host 侧，epoch ms |
| `SessionSummary.updatedAt` | ⚠️ 定义是 `max(createdAt, lastPromptAt)`，而 `lastPromptAt` 只折叠**人类**的 `user/message`。它是「最后一次被人类推进」，**不是**最后一次活动，更不是结束 |
| 会话结束时间 | ❌ 不存在 |
| turn 的时间戳 | ❌ `session-turn-outline` 只给 `seq/prompt/response`，无时间 |

**这就是为什么 D3 必须走 Host 半边**：客户端根本拿不到事件时间序列，「真实工作时段」只能在 host 侧算。

### 3.5 插件形态

- 插件 = Cordis 插件：ESM 模块导出 `apply(ctx, config)`（可带 `name` / `inject` / `Config`）。
- **bundle** = 包声明 `dsh.bundle.patch` 指向一份 `cordis.patch.yml` 层。profile 的 `dsh.profile.bundles` 按序叠放各层，再叠 profile 自己的 patch、home 级 patch、`--patch` overlay。
- **一个包可以两面**：host 半边是包根的 `main`（在 host 进程内跑，拿完整 `ctx`），client 半边是 `exports["./client"]`，由 `package.json` 的 `dsh.client` 激活。
- **关键**：`packages/client/modules` 扫描的是 **Host Loader 的全部 entry 中声明了 `dsh.client` 的包**，不限定官方 web-app bundle。所以一个外部 bundle 插一行指向带 `dsh.client` 的包，浏览器就会自动拿到它的 `/plugins/<pkg>/client.js` 行。
- 安装通道：`dsh plugin add <registry|path|github|tarball>`，或 GUI 侧边栏 Plugins 页。

### 3.6 客户端模块系统的产物契约

客户端 bundle 必须是 **lazy-CJS factory**：一段脚本，向页面模块加载器登记包名与 `factory(require)`。DSH 仓库里的产出预设是 `packages/client/tsdown.client.ts`，**它不在任何已发布的包里**（仓库文档明确说明「仓库之外的包要自己复刻这一步构建」）。本仓库因此自带一份最小预设。

产物格式就是三行包装：

```js
window.__ModuleLoader__.load({ id: "<pkg>", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
  /* …CJS body… */
return module.exports; } });
```

产出配置：`entryFileNames: 'client.js'`、`chunkFileNames: 'client.[name].js'`、CJS 格式、基线 external。

### 3.7 运行时免费的模块与座位

模块表（`PLATFORM_MODULES`）已经免费提供：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。

因此 `ui-session` / `ui-workspace` / `ui-layout` **都不需要运行时导入**：数据与 hook 通过 slot props 送达，slot 名用 `import type` 做声明合并（类型导入被擦除，不产生运行时边）。

UI 座位：

| 座位 | 基数 | 用途 |
|---|---|---|
| `main` | keyed（scope root） | 主区域整块面板，按 sidebar entry id 调度；保留 key `conversation` |
| `sidebar.panellist` | list | 侧边栏入口图标，其 id 即 `main` 的 key |
| `shell.overlay` | list（scope root） | 全窗口浮层，click-through；留给后续常驻缩略条 |

每个 scope 自带 `useWorkspaces` / `useSessions` / `useSessionStatus`，实时性由既有 WebSocket 与快照 store 免费提供。

### 3.8 投影注册表：工作区间的载体

`ctx.sessionProjections.register()` 是**正好干这件事**的机制，且 `session-projection` 与 `session-projection-cache` 都在 **base** 层，任何 profile 都装了。

单元契约：

- `key`：投影键，通过声明合并进 `SessionProjectionStateMap` / `SessionProjectionMap`。
- `stateSchema`：Zod，校验持久化 state。
- `init(header, inheritedEventCount)`：空日志的初值。
- `apply(state, event)`：**纯同步**折叠；不关心的事件**必须返回同一引用**（`Object.is`，零下游工作）。
- `wire: { viewSchema, view }`：**有它才离开 host**；`view` 的产物按 `Object.is` 比对，对象值必须复用引用以抑制发布。
- `stateVersion`：序列化字段或折叠语义变更时递增，旧缓存行会被丢弃而不是前向应用成垃圾。
- state 必须是**纯 JSON**（持久化缓存前提）。

**收益**：注册之后，每一行会话（含冷会话，走持久化投影缓存）的值会**跟着会话列表一起来**，在 `SessionSummary.projections.values.<key>` 里。客户端一次拿到全部会话的区间数据，attached 会话还通过投影变更流实时更新。零额外往返、不需要自建 Remote。

> 为什么不用自建 Remote：`ctx.remote.$on()` 只接受第一方白名单 `API_REMOTE_FORWARDED_EVENTS`，第三方包无法扩展。走 unary Remote 逐个拉则是 N+1 往返 + 轮询，严格更差。

## 4. 架构

```
┌─ dsh-tasks (单个 npm 包, 单个 bundle) ─────────────────────┐
│                                                            │
│  host 半边  src/index.ts → lib/index.js                    │
│    apply(ctx)                                              │
│      └─ ctx.sessionProjections.register('taskSpans', …)    │
│           折叠每个会话的事件流 → 工作区间 + 当前相位         │
│           wire 后随会话列表抵达浏览器                        │
│                                                            │
│  client 半边  src/client/index.ts → lib/client.js          │
│    apply(ctx)                                              │
│      ├─ slots.inject('main')                → 时间轴页面     │
│      └─ slots.inject('sidebar.panellist')   → 入口图标       │
│                                                            │
│  cordis.patch.yml → insert 一行 host row                    │
│    （client 半边由该包 manifest 的 dsh.client 自动登记）      │
└────────────────────────────────────────────────────────────┘
```

**一个包，一个 row。** host row 进 Loader；`dsh.client` 让浏览器半边被扫描进 `__DSH_BOOT__`。

### 4.1 Host 半边：`taskSpans` 投影

state（纯 JSON）：

```ts
interface TaskSpansState {
  readonly spans: readonly (readonly [number, number])[]  // [startMs, endMs]，升序、已合并、已封顶
  readonly phase: TaskPhase                                // 当前相位
  readonly lastEventAt: number                             // 最后一次事件时间，0 表示还没有
  readonly unreadAt: number                                // 最后一次「跑完」的时间，0 表示无
}
```

折叠规则：

- 每个已提交事件取 `event.time`。
- 与上一段末尾间隔 ≤ `GAP_MS` → 延长上一段；否则开新段。
- 只保留最近 `MAX_SPANS` 段（按仓库规矩「给完整结果加边界」：区间数组必须封顶）。
- 相位按事件类型推导：assistant 文本/推理 → `generating`；tool call/result → `tool`；subagent/job 相关 → `delegated`；`turn/end` 且此前在跑 → 空闲侧。
- **`apply` 必须返回同一引用**（不关心的事件）或复用 `view` 引用（几何没实质变化时），否则每个事件都会触发客户端重渲染 —— 这是热路径。

相位与播放器状态合流：`pendingInteraction` 来自客户端 `SessionStatus`（它知道是否在等审批/等回答），投影提供工作相位。二者在客户端做一次纯函数合流，得到最终 6 相。

### 4.2 Client 半边：渲染

- **`useWorkspaces`** → 工作区分组标题 + 色带；按最近活动排序；窗口内无活动的工作区自动收起。
- **`useSessions`** → 会话行 + `projections.values.title`（标题）+ `projections.values.taskSpans`（区间与相位）。
- **`useSessionStatus`** → `pendingInteraction`（拆分「等你审批」/「等你回答」）与 `completionUnread`（角标）。
- **自动视窗**：窗口 = `[now - span, now]`，其中 `span` 由窗口内活动自适应；有 `running` 会话时右端跟随「现在」（用 rAF/定时器推进），无活动时静止。
- **虚拟滚动**：行数可达数十行，用 `@tanstack/react-virtual`（DSH 仓库已在 `ui-trajectory`/`ui-chat` 使用）。
- **交互**：
  - 点条 → 详情面板：标题、工作区、全量区间、创建时间、最后一次事件、相位、`todos` / `goal` 投影、跳转打开该会话。
  - 点工作区分组标题上的 `+` → 在该工作区新建任务（新会话）。
  - 悬停条 → `HoverCard` 摘要。

### 4.3 补齐历史（设计时遗漏、实现中发现）

投影缓存里，一个会话在 host 第一次折叠它之前**没有本插件的行**。实测：本机 395 个会话里只有 3 个（当时有活跃 agent 的）有区间数据，其余 392 个的 `dshTasksSpans` 键根本不存在。时间轴若不管这件事，首次打开几乎是空的。

解法是客户端对象层已有的显式读取通道：`ctx.sessions.refreshProjections(sessionId)`（契约注释："Load all Session projections once per connection"）。面板对**窗口回溯范围内、最近活跃、且尚无投影值**的会话调用它，每次页面加载每个会话一次，失败则允许下次重试。

实测效果：接入后同一个真实数据集从「3 个工作区 · 4 个任务」变为「7 个工作区 · 16 个任务」。

### 4.4 6 相位

| 相位 | 触发 | 视觉 |
|---|---|---|
| `idle` 空闲 | 无 running、无 pending | 中性 |
| `generating` 正在生成 | running，最后事件是 assistant 文本/推理 | 品牌色，呼吸 |
| `tool` 正在调工具 | running，最后事件是 tool call/result | 品牌色 |
| `delegated` 正在等子任务 | running，最后事件指向 subagent / 后台 job | 品牌色，虚线纹理 |
| `approval` 等你审批 | `pendingInteraction.kind === 'approval'` | 琥珀色，静态醒目 |
| `question` 等你回答 | `pendingInteraction.kind === 'question'` | 琥珀色 |

`completionUnread` 是叠加角标，不是第 7 相位。

## 5. 已知风险与缓解

| 风险 | 缓解 |
|---|---|
| 客户端 bundle 产物格式是**未发布的内部契约**，DSH 升级可能改 | 自研预设集中在 `tsdown.config.ts` 一处，格式只有 banner/intro/footer 三行；升级时只需改这一处 |
| DSH 公开 API 是 **pre-stable** | `peerDependencies` 明确钉版本；投影 key 加前缀避免撞名；不依赖 `experimental/*` |
| 投影 `apply` 是**每个会话每个事件**的热路径 | 折叠保持 O(1) 摊销；不关心的事件返回同一引用；`wire.view` 在几何未变时复用引用 |
| `state` 必须是纯 JSON 且会被持久化缓存 | 只存数字数组与枚举，不存对象引用、不存 Date |
| 区间数组无界增长 | `MAX_SPANS` 封顶 + `GAP_MS` 合并 |
| Remote `$on` 白名单第三方不可扩展 | 完全不用 `$on`；走投影（随会话列表 + 变更流抵达） |
| 相位推导依赖事件类型，DSH 新增事件类型 | 未知类型保留上一个相位，不抛错也不误降级 |
| **host 代码改动不保证热生效** | ESM 按 URL 缓存，同一路径的 `lib/index.js` 在一个进程内只导入一次；实测只改注释的 patch 编辑不会重挂载 entry。改行名会让 Loader 重建 entry 并重新导入，但是否命中缓存取决于解析出的 URL 拼写。client 半边是另一条机制（host 对产物做 stat 轮询），一直可靠。判据：host 活着时任务行有活动段，陈旧时只有行没有段 |
| 投影缓存无本插件的行 → 时间轴首次几乎为空 | §4.3 的按需补齐 |
| 空闲会话也会进窗口造成噪声 | 自动视窗 + 工作区自动收起；分组标题显示计数 |

## 6. 验证证据

不是"应该能跑"，是实际跑过的：

- **折叠算法（单元）**：19 个测试覆盖合并阈值、边界值、封顶丢弃、时间倒流、相位分类、量化、以及 `wire` 引用复用/发布的四种触发条件。
- **真实数据（端到端）**：对运行中的 DSH 实例调 `session/list`，395 个会话全部带 `dshTasksSpans`；实测分布为区间中位数 13 段、最长 56 段（封顶 96 未触及）。
- **真实注册表（集成）**：6 个测试挂载真实的 `SessionStore` + `SessionProjectionRegistry`，用 `session.append()` 走真实提交路径，断言折叠结果、wire 快照、相位序列、以及 fiber 销毁后键被释放（HMR 安全契约）。
- **真实浏览器（端到端）**：Playwright + 系统 Chrome 驱动真实 `dsh web`：boot 图 65 条含 `dsh-tasks`；面板渲染 125 个任务条、137 条刻度线、7 个泳道按钮；详情弹层可开；点泳道 `+` 跳转到该工作区的新任务输入框；**控制台零错误**。
- **在用户长期运行的实例上（不重启）**：投影缓存每会话一个 JSON 文件。在只有该实例存活的时段内，插件会话对应文件里的 `seq` 与全体投影的最大 `seq` 同步推进，且**值本身在变**——`phase` 随真实事件从 `generating` 翻到 `tool`，段尾按 1 秒量子格前进（`...792000 → ...800000`）。这是折叠代码在该进程内实时执行的直接证据，排除了"陈旧行被保留"的解释。

一个反直觉的坑记录在案：`ctx.sessions.create({ seed })` 会在 seed 之后**追加一个 `session/end-seed` 事件**，时间戳是真实当前时间。用固定时间戳做种子会让每个事件都被判成新段。集成测试因此改用 `session.append()`。

## 7. 明确不做（YAGNI）

- 不做插件私有的任务实体、不做手工排期、不做历史区间编辑 —— 任务就是会话。
- 不做自建 Remote / 自建存储 —— 投影注册表已覆盖。
- 不做 `shell.overlay` 常驻缩略条 —— 留给后续版本。
- 不依赖 `experimental/agent-team` 的任务图 —— 它在默认产品里被隔离，且会引入第二套任务概念。
- 不改 DSH 仓库任何代码 —— 加成靠 bundle patch 层。
