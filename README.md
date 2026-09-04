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

## Main GUI

```text
run ui/dashboard.js
```

Current tabs are **Overview, Targets, Economy, Network, and Diagnostics**.

Key controls now include:

- **Overview → Prep target to 100%** — grow continuously to full money, then weaken to minimum security and hold the target prepared for batching.
- **Overview → Resume auto HGW** — releases prep hold.
- **Targets → Manual target override** — set a specific eligible money server as the controller target, or clear the override to return to automatic economic target selection.
- **Economy → Manual money goal** — set/clear a savings target and spending lock.

React event callbacks only queue plain-JS requests. Netscript port/file work stays in the dashboard main loop so GUI interaction remains stable.

## Current architecture

- **Home is the control/UI node.** HGW workers are never dispatched to home.
- **Workers** are minimal `hack`, `grow`, and `weaken` scripts running on remote execution hosts.
- **Planner** discovers the network, eligible targets, and execution hosts.
- **Economic selector** chooses the preferred automatic hostname, desired-money percentage, and hack fraction.
- **Controller** currently uses sequential tactical HGW for normal automation and prep, while synchronized HWGW is validated separately.
- **Prep-and-hold mode** grows to 100%, then weakens to minimum, then stops for batch testing.
- **Manual target mode** overrides the controller hostname at runtime through Port 13. Target switches wait until current workers/tactical analysis finish.
- **Progression advisor** compares home RAM, new cloud servers, and cloud-server upgrades.
- **Cloud capacity automation** executes advisor-selected purchases/upgrades and independently retries affordable cloud actions every few seconds, so long prep phases no longer require a HACK completion to trigger spending.
- **Manual money goal** remains a hard interlock that disables automated cloud spending.
- **Telemetry** records real hack returns and rolling income.
- **Main GUI** consumes structured state instead of performing expensive analysis itself.

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

This creates the clean starting state required for synchronized batch testing.

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

When the advisor selects a new cloud server or upgrade, `hacking/refresh.js` now performs a lightweight affordability check every 5 seconds using the cached goal cost and live home cash. Once affordable, it retries the cloud spender even if no HACK has completed. This is especially important during long GROW/WEAKEN prep windows and later during batching.

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
| 13 | controller command queue (prep/resume/manual target) |

## First HWGW batching milestone

`hacking/batch-runner.js` provides a synchronized single HWGW batch against a prepared target.

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
  architecture.md
```

## RAM philosophy

Home RAM is control-plane capacity, not worker capacity. Persistent home processes should stay small; expensive short-lived analysis and timed batch execution belong on remote hosts.

## Roadmap

1. validate prep/manual-target GUI controls and independent cloud purchase/upgrade retries;
2. expose richer batch timing/health state in the main GUI;
3. integrate one synchronized batch into automatic production;
4. move strategic review from raw HACK completion to full batch completion;
5. measure timing drift and tune the landing gap dynamically;
6. add overlapping/pipelined batches with RAM reservation and collision prevention;
7. add target/strategy hysteresis and predicted-versus-actual calibration;
8. split more dispatch/scheduling work out of the home controller;
9. optimize the whole remote RAM pool across multiple targets;
10. flesh out the independent stock subsystem.

See `docs/architecture.md` for the architectural direction.
