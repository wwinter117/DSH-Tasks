# DSH-Tasks

English | [中文](README.zh.md)

A Gantt-style task timeline for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web GUI.

Every DSH Session is a task. The timeline draws each one as a row on a wall-clock axis, grouped by workspace, so you can see at a glance **what is running right now and what is waiting for you** — across every workspace at once.

![The task timeline panel](docs/screenshot.png)

## What it shows

- **One row per Session, grouped under its workspace.** Sessions with activity inside the drawn window appear; empty workspaces collapse away.
- **Real work segments, not session age.** A row is a set of intervals folded from the Session's own event log, so a task worked on all morning reads as segments across the morning rather than one long bar. A faint summary bar spans first-to-last activity.
- **Six phases, live.** `idle` · `generating` · `running a tool` · `waiting on a subtask` · `waiting for your approval` · `waiting for your answer`. The two waiting phases are the ones that need you, and a running row keeps an open, pulsing right edge.
- **Now sits in the middle, and the track slides under it.** The live cursor is centred on load, so history is a drag away in either direction and the clock keeps it there. Zoom chooses how much time the viewport shows — automatic, or a fixed 1 / 6 / 24 hours. Panning stops the follow; **Back to now** re-centres it.
- **Detail on click.** Workspace, phase, last activity, last prompt, and every recorded segment with its duration, plus a button that opens the Session.
- **Insert a task by clicking a workspace.** The `+` on a lane header starts a new Session in that workspace and takes you to its composer.

## Install

DSH-Tasks is a bundle: one package with a host half and a browser half.

**From the GUI.** Open the sidebar's **Plugins** page, choose **Add plugin**, and give it this repository's Git address or a published package name. Bundle membership is read at startup, so restart the `dsh web` process once afterwards.

**From the CLI.**

```sh
dsh plugin --profile web add github:wwinter117/DSH-Tasks
```

**From a checkout.** Link the checkout into your profile and insert the row yourself:

```sh
cd ~/.dsh/profiles/web
pnpm add link:/path/to/DSH-Tasks
```

Then append to `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: task-timeline
      name: 'dsh-tasks'
```

`dsh web` watches the profile's patch file and manifest, so the row applies without a restart.

Nothing else is needed: the page reconciles the client entry graph as it changes, so the sidebar entry appears in an already-open page. If it does not, reload the page once.

If the panel appears but every row is empty, the host half is still the module the process imported first: a plugin is imported once per process, and a rebuilt `lib/index.js` at the same path can be served from Node's ESM cache. Restart `dsh web`. A working host half shows activity segments; a stale one shows rows with no bars.

## Requirements

- A DSH web profile (`dsh web`). The host half declares `sessionProjections`, which the base bundle always provides.
- The build targets the DSH `0.1.7-rc.2` client module contract. DSH's public APIs are pre-stable; a runtime upgrade may require updating `PLATFORM_MODULES` in `tsdown.config.ts`.

## How it works

One npm package, two halves, one Loader row.

**Host half** (`src/index.ts`) registers one Session projection, `dshTasksSpans`, on `ctx.sessionProjections`. The registry drives the fold over every committed Session event and hands each client-visible value to the browser with the Session list — cold Sessions included, through the persisted projection cache. That is also the only push channel a third-party bundle has: `ctx.remote.$on()` accepts a first-party allowlist a plugin cannot extend.

The fold coalesces events within five minutes into one segment, caps the list at 96 segments, and derives the phase from the newest event's type. It quantises the published open end to one second and reuses the published object's reference while nothing visible moved, so a streaming Session does not republish the Session list many times a second.

**Browser half** (`src/client/`) registers a `main` panel and the `sidebar.panellist` entry that selects it. Both faces read the same key: the declaration merge lives in `src/contract.ts` precisely so the browser half can type its read.

The browser half also **fills in missing history**: the projection cache has no row for a Session until the host folds it, so the panel asks `ctx.sessions.refreshProjections(id)` for recent Sessions inside the window that have no value yet — once each per page load.

Why the intervals are computed on the host, why the window is automatic, and which DSH facts each decision rests on: [`docs/design.md`](docs/design.md).

## Known limitations

- **First run shows only recently active tasks.** A Session's intervals exist only after the host folds it once. The panel requests folds for Sessions inside the lookback window, so the timeline fills in as you look at it; Sessions idle for more than a day stay blank until something touches them.
- **The last activity time is second-resolution.** The published end of the open segment is floored to a one-second grid, which is what keeps publication cheap.
- **`waiting` phases need a connected client.** The blocking-approval and question phases come from client UI status; the log alone cannot tell them apart from work in progress.
- **Subagent Sessions are hidden by default.** Forks are not: a fork is a task in its own right. The filter matches the workspace tree's own `origin === 'subagent'` rule.
- **The track reaches back 24 hours.** Sessions whose only activity is older than that leave the timeline; open the Session itself for anything earlier.
- **The automatic zoom stops at 6 hours.** Activity that reaches further is reached by panning rather than by zooming out, and half of every viewport sits to the right of now — that empty future is the price of centring the cursor.
- **No virtualisation.** The default filters and the 24-hour cap keep rendered rows in the low hundreds; a full-history mode would need `@tanstack/react-virtual`.

## Development

```sh
pnpm install
pnpm run check     # typecheck all four programs, build both halves, run the tests
pnpm test          # 63 tests, including 6 against the real projection registry
pnpm run watch     # rebuild on change
```

The client half hot-reloads: with `dsh web` running, a rebuilt `lib/client.js` is picked up by the host's bundle poll and the panel swaps itself without a page refresh. The host half does not — see the restart note under Install.

`tsdown.config.ts` carries a self-contained copy of DSH's client bundle preset. The upstream preset lives in the DSH checkout under `packages/client/tsdown.client.ts` and is not published, so a plugin outside that repository reproduces the artifact contract: the `window.__ModuleLoader__.load({ id, factory })` wrapper, the platform module table as `external`, and CSS Modules compiled into a tagged `<style>` injection.

## License

MIT
