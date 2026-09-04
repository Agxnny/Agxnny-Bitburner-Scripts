# Agxnny Bitburner Scripts

A modular Bitburner automation project for v3.x, focused on a distributed HGW/HWGW system with a control-only home node, remote worker execution, adaptive economic targeting, progression automation, a unified control-plane GUI, diagnostics, and staged migration toward fully pipelined batching.

## Quick start

```text
run startup.js
```

`startup.js` opens the main GUI on home and launches the automation stack through `kickstart.js --quiet`.

For maintenance/update:

```text
run gitpull.js
run startup.js
```

## Documentation / new-chat handoff

For continued development in a fresh chat, start with:

- [`docs/HANDOFF.md`](docs/HANDOFF.md) — current milestone, latest live validation, highest-priority issue, and immediate next work.
- [`docs/README.md`](docs/README.md) — documentation index and recommended reading order.
- [`docs/architecture.md`](docs/architecture.md) — architecture and control/data flows.
- [`docs/SYSTEM_MAP.md`](docs/SYSTEM_MAP.md) — responsibility map by script/module.
- [`docs/RUNTIME_STATE.md`](docs/RUNTIME_STATE.md) — runtime ports and controller command contract.
- [`docs/TESTING.md`](docs/TESTING.md) — validation procedures and acceptance criteria.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — prioritized future work.

**GitHub `main` is the source of truth.** Before changing any existing script, fetch/read the current repository file first rather than reconstructing it from an old conversation.

A useful first prompt for a new development chat is:

```text
Continue my Bitburner automation project from GitHub.
Read docs/HANDOFF.md first, then inspect the current live files before editing anything.
The GitHub main branch is the source of truth.
Work on the highest-priority known issue documented there, and refresh the docs after major changes.
```

## Main GUI

```text
run ui/dashboard.js
```

Current tabs are **Overview, Targets, Economy, Network, and Diagnostics**.

Key controls include:

- **Overview → Execution mode** — choose **Normal HGW** or **Batched HWGW** at runtime.
- **Overview → Prep target to 100%** — grow continuously to full money, then weaken to minimum security and hold the target.
- **Overview → Resume auto HGW / batching** — releases prep hold and resumes the currently selected execution mode.
- **Targets → Manual target override** — set a specific eligible money server as the controller target, or clear the override to return to automatic economic target selection.
- **Economy → Manual money goal** — set/clear a savings target and spending lock.

The dashboard now mounts its React tree once and keeps presentation state alive instead of repeatedly clearing and re-printing the entire UI. Tab selection is React-local and therefore immediate; the asynchronous dashboard loop only refreshes cached runtime snapshots and processes queued commands. React callbacks remain Netscript-free and only mutate plain-JS request/input state.

## Current architecture

- **Home is the control/UI node.** HGW workers are never dispatched to home.
- **Workers** are minimal `hack`, `grow`, and `weaken` scripts running on remote execution hosts.
- **Planner** discovers the network, eligible targets, and execution hosts.
- **Economic selector** chooses the preferred automatic hostname, desired-money percentage, and hack fraction.
- **Controller** can switch at runtime between sequential tactical HGW and synchronized single-batch HWGW production.
- **Automatic batch mode** prepares the selected strategy target, launches one synchronized HWGW batch, waits for complete recovery, then requires a fresh planner/economy review before another batch may launch.
- **Prep-and-hold mode** grows to 100%, then weakens to minimum, then stops until automatic execution is resumed.
- **Manual target mode** overrides the controller hostname at runtime through Port 13. Target switches wait until current workers/tactical/batch work is idle.
- **Progression advisor** compares home RAM, new cloud servers, and cloud-server upgrades.
- **Cloud capacity automation** executes advisor-selected purchases/upgrades and independently retries affordable cloud actions every few seconds, so long prep phases no longer require a HACK completion to trigger spending.
- **Manual money goal** remains a hard interlock that disables automated cloud spending.
- **Telemetry** records real hack returns and rolling income.
- **Main GUI** consumes structured state instead of performing expensive analysis itself.

## Current batching status

Automatic single-batch production is integrated and the control/review flow is working. The original W2 under-compensation defect has been corrected.

Original failing automatic batch on `sigma-cosmetics`:

```text
25H / 1W / 298G / 1W
money after batch: 100%
security after batch: +1.13
```

Root cause: `growthAnalyzeSecurity(growThreads, target, 1)` was evaluated while the prepared target was already at max money, so host-aware API semantics capped the reported grow-security increase and W2 was reduced to the one-thread minimum.

The runner now uses the uncapped future-operation calculation:

```text
ns.growthAnalyzeSecurity(growThreads)
```

First corrected live batch on the same target:

```text
25H / 1W / 298G / 24W
money after batch: 100%
security after batch: minimum (3.00 / 3.00)
standalone repair weaken: not required
```

Repeated automatic-batch validation is still in progress. Several consecutive clean cycles are required before the security issue is treated as fully closed and before overlapping batches are considered.

See `docs/HANDOFF.md` and `docs/TESTING.md` for full context and acceptance criteria.

## Execution modes

The controller accepts runtime mode changes through Port 13. The GUI exposes these as two buttons on the Overview tab.

### Normal HGW

Sequential tactical production:

```text
WEAKEN / GROW prep as needed
        ↓
HACK
        ↓
repeat
```

### Batched HWGW

The current automatic batching milestone is deliberately conservative: **one synchronized batch at a time**.

```text
prepare selected strategy baseline
        ↓
HACK
WEAKEN_HACK
GROW
WEAKEN_GROW
        ↓
full batch COMPLETE
        ↓
planner + economy + target review
        ↓
repair target if recovery is imperfect
        ↓
next batch
```

The controller will not launch the next batch while the post-batch review barrier is active. This prevents strategy analysis from being performed on the temporary post-HACK/pre-recovery target state.

## Manual target override

Use the **Targets** tab in the main GUI. Enter a hostname such as:

```text
foodnstuff
```

and press **Set manual target**. The controller validates the hostname against the planner's currently eligible target ranking. If accepted, automatic hostname changes are suspended until **Clear / auto target** is pressed.

Manual target mode changes the hostname only. Its default strategy is 100% desired money / 10% hack fraction unless later strategy integration explicitly changes that behavior.

## Target prep mode

Prep mode intentionally does not alternate grow/weaken during the money-fill stage:

```text
GROW until ~100% money
        ↓
WEAKEN until minimum security
        ↓
PREPARED_HOLD
```

This creates a clean deterministic starting state for batch testing or manual holds.

## Manual money goal / spending lock

```text
run economy/manual-goal.js 50m
run economy/manual-goal.js 1.5b "Save for milestone"
run economy/manual-goal.js status
run economy/manual-goal.js clear
```

While active, the goal is persisted on home, published on Port 11, used by target economics, and independently blocks `network/cloud-buy.js`.

## Cloud capacity automation

The progression advisor can emit:

```text
PURCHASED_SERVER
CLOUD_SERVER_UPGRADE
```

`network/cloud-buy.js` handles both actions.

New managed servers use deterministic names:

```text
hgw-001
hgw-002
hgw-003
...
```

When the advisor selects a new cloud server or upgrade, `hacking/refresh.js` performs a lightweight affordability check every 5 seconds using the cached goal cost and live home cash. Once affordable, it retries the cloud spender even if no HACK has completed.

The expensive planner/economy/target chain is **not** rerun on every retry. It only runs after a successful capacity change, at which point planner + sync + economy + target selection refresh so the new RAM joins the remote execution pool.

If the advisor currently prefers a non-cloud progression goal such as home RAM, the cloud spender does not override that decision. An active manual money goal blocks both purchases and upgrades.

## Runtime state and ports

| Port | Purpose |
| --- | --- |
| 1 | controller snapshot |
| 2 | planner / selected strategy |
| 3 | tactical plan |
| 4 | hack-completion event queue |
| 5 | income telemetry |
| 6 | diagnostic-test request queue |
| 7 | economy/progression snapshot |
| 8 | economic target ranking |
| 9 | rooting/tool state |
| 10 | automated cloud-capacity action state |
| 11 | manual money-goal / spending lock |
| 12 | latest synchronized HWGW batch state |
| 13 | controller command queue (prep/resume/manual target/execution mode) |

## HWGW batch runner

`hacking/batch-runner.js` executes a synchronized single HWGW batch against a prepared target.

Landing order:

```text
HACK
  + gap
WEAKEN_HACK
  + gap
GROW
  + gap
WEAKEN_GROW
```

Default gap: **200 ms**.

Example:

```text
run hacking/batch-runner.js n00dles 0.10 200 1
```

The runner reserves the entire remote RAM requirement before launching anything and publishes batch state on Port 12.

## Adaptive economic strategy

For sufficiently large targets, the selector evaluates:

```text
25%, 40%, 55%, 70%, 85%, 100%
```

Servers at or below the current **$5,000,000 max-money floor** are forced to 100% preparation. Economic capacity estimates are remote-only.

## Useful commands

```text
run startup.js
run ui/dashboard.js
run diagnostics/mem-audit.js
run diagnostics/economy-targets.js
run diagnostics/income.js
run diagnostics/progression.js
run economy/manual-goal.js status
run network/inspect.js
run network/root.js
run hacking/batch-runner.js n00dles 0.10 200 1
```

## Repository layout

```text
startup.js
kickstart.js
gitpull.js
gitpull-self-update.js
manifest.json

ui/
  dashboard.js
  stocks.js

stocks/
  terminal.js

economy/
  manual-goal.js

hacking/
  batch-runner.js
  controller.js
  planner.js
  refresh.js
  economy-planner.js
  economy-targets.js
  tactical-planner.js
  telemetry.js
  thread-plan.js
  workers/
    hack.js
    grow.js
    weaken.js

lib/
  deployment.js
  execution.js
  network.js
  output.js
  progression.js
  runtime-state.js
  state.js
  targets.js
  telemetry.js
  threads.js

network/
  cloud-buy.js
  deploy.js
  inspect.js
  root.js
  sync.js

diagnostics/
  dashboard.js
  economy-targets.js
  income.js
  mem-audit.js
  progression.js
  test.js
  test-launcher.js

docs/
  README.md
  HANDOFF.md
  architecture.md
  SYSTEM_MAP.md
  RUNTIME_STATE.md
  TESTING.md
  ROADMAP.md
```

## RAM philosophy

Home RAM is control-plane capacity, not worker capacity. Persistent home processes should stay small; expensive short-lived analysis and timed batch execution belong on remote hosts.

## Roadmap

Immediate priority:

1. validate several consecutive corrected automatic batches recover without standalone correction;
2. add predicted-vs-actual batch recovery and landing telemetry;
3. measure timing drift and tune/adapt the landing gap;
4. implement overlapping/pipelined batches with global RAM reservations and collision prevention;
5. split more dispatch/scheduling work out of the home controller;
6. optimize the whole remote RAM pool across multiple targets;
7. flesh out the independent stock subsystem.

See `docs/ROADMAP.md` for the full staged roadmap.
