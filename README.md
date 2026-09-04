# Agxnny Bitburner Scripts

A modular Bitburner automation project for v3.x, currently focused on a distributed HGW/HWGW system with a control-only home node, remote worker execution, adaptive economic targeting, progression automation, a unified control-plane GUI, diagnostics, and staged migration toward fully pipelined multi-target batching.

## Quick start

Normal startup is one command:

```text
run startup.js
```

`startup.js` always opens the main GUI on home and launches the automation stack through `kickstart.js --quiet`. Background services keep publishing state, but terminal output stays quiet so the GUI is the primary presentation surface.

For maintenance/update:

```text
run gitpull.js
run startup.js
```

`kickstart.js` remains available as the lower-level automation bootstrap when the GUI is not wanted.

## Main GUI

The primary day-to-day interface is:

```text
run ui/dashboard.js
```

The dashboard is intentionally simple and state-driven. It uses a restrained dark control-panel layout with status badges, headline metrics, compact cards, progress bars, and a small tab set instead of trying to put every script output on one screen.

Current tabs are **Overview, Targets, Economy, Network, and Diagnostics**. The Overview tab now includes target-prep controls, and the Economy tab includes the manual money-goal controls. The older `diagnostics/dashboard.js` remains a focused troubleshooting panel.

## Stock trading workspace

Stock trading is deliberately isolated from the HGW control plane and is **not started by `startup.js`**.

```text
run stocks/terminal.js
run ui/stocks.js
```

Both are currently non-trading placeholders for a later stock subsystem.

## Current architecture

- **Home is the control/UI node.** HGW workers are never dispatched to home; its RAM is reserved for controller/orchestration, GUI, updater, and future control services.
- **Workers** remain minimal `hack`, `grow`, and `weaken` scripts running only on remote execution hosts.
- **Planner** performs network discovery and baseline target ranking, then publishes cached state.
- **Refresh coordinator** runs remotely, checks rooting periodically, and performs heavy strategic refreshes only after meaningful events.
- **Automatic rooting** detects newly available port tools, roots eligible servers, and expands the remote RAM pool.
- **Controlled cloud purchasing** can buy one advisor-approved server per strategic refresh with deterministic names `hgw-001`, `hgw-002`, ... .
- **Manual money goal** overrides the automatic cash goal and hard-locks automated purchasing until explicitly cleared.
- **Economic strategy selector** compares live target state, remote-only worker capacity, prep waves, exponential prep cost, desired-money percentages, progression distance, and cash-relative target value.
- **Controller** still runs the normal production loop sequentially while the synchronized HWGW path is validated separately.
- **Prep-and-hold mode** can be requested from the GUI. It grows the current controller target all the way to 100% money without switching to weaken when security rises, then performs weaken-only recovery to minimum security and holds the prepared target for batch testing.
- **Telemetry** records real hack returns and rolling income rates.
- **Main GUI** consumes cached state and sends lightweight controller commands without owning strategy logic.

## Target prep mode

The **Overview** tab provides two controller actions:

- **Prep target to 100%** — keeps issuing grow work until the current target reaches full money, then switches to weaken-only until security is back at minimum.
- **Resume auto HGW** — releases the prepared hold and returns control to the normal economic HGW strategy.

Prep mode intentionally does **not** alternate grow/weaken during the money-fill phase. Once preparation is complete, the controller holds the target at 100% money / minimum security instead of immediately hacking it again. This makes it convenient for manual HWGW batch validation.

## Manual money goal / spending lock

```text
run economy/manual-goal.js 50m
run economy/manual-goal.js 1.5b "Save for milestone"
run economy/manual-goal.js status
run economy/manual-goal.js clear
```

While active, the goal is persisted on home, published on Port 11, used by target economics, and independently blocks `network/cloud-buy.js`. Reaching the goal does not clear the lock automatically.

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
| 10 | automated cloud-purchase state |
| 11 | manual money-goal / spending lock |
| 12 | latest synchronized HWGW batch state |
| 13 | controller command queue (GUI prep/resume actions) |

## Current HGW flow

The main controller is still sequential while batching is validated:

1. adopt the latest selected target and desired-money percentage;
2. observe live money/security;
3. request tactical calculation on a remote host;
4. weaken/grow/hack using remote workers only;
5. after HACK completion, run the strategic review chain.

When prep mode is active, the tactical planner is explicitly forced into either `PREP_GROW` or `PREP_WEAKEN`, preventing its normal security-first decision rule from causing grow/weaken oscillation.

There is deliberately no home worker fallback.

## First HWGW batching milestone

`hacking/batch-runner.js` provides an experimental **single synchronized HWGW batch** for a prepared target. It is not yet wired into the controller automatically.

The landing order is:

```text
HACK
  + gap
WEAKEN_HACK
  + gap
GROW
  + gap
WEAKEN_GROW
```

The default gap is **200 ms**. All workers are launched up front and use the v3 `additionalMsec` HGW option so their effects land in the required order. The runner reserves the entire batch across the remote RAM pool before launching anything; if the whole batch cannot fit, it refuses to launch rather than creating a partial unsafe batch.

The worker scripts remain backward compatible with sequential execution. Their fourth argument is now an optional `additionalMsec`, and batch metadata can be supplied in later arguments.

The batch runner currently requires the target to already be prepared: security must be near minimum and money must be at the chosen desired-money level. The GUI prep mode provides a convenient way to prepare and hold the controller target at the strict 100% / minimum-security state for this test path.

Example when connected to a sufficiently large remote execution host:

```text
run hacking/batch-runner.js n00dles 0.10 200 1
```

Arguments are:

```text
target  hackFraction  gapMs  moneyTargetPercent
```

Port 12 records `BLOCKED`, `READY`, `RUNNING`, `LAUNCH_FAILED`, or `COMPLETE` batch state including thread counts, landing times, allocations, final money, and final security.

This is intentionally **one batch at a time**. The next batching step is controller integration and then safe overlapping/pipelined batches once timing drift has been measured.

## Adaptive economic strategy

For sufficiently large targets, the selector evaluates:

```text
25%, 40%, 55%, 70%, 85%, 100%
```

Servers at or below the current **$5,000,000 max-money floor** are forced to 100% preparation. A cash-relative value filter also normally ignores a server when player cash reaches 3× that server's maximum money, provided another viable target remains.

Economic RAM estimates are remote-only, matching real dispatch policy.

## Automated cloud servers

Advisor-approved cloud servers use deterministic names:

```text
hgw-001
hgw-002
hgw-003
...
```

At most one is purchased per strategic refresh. Manual money-goal mode disables purchases completely.

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

Home RAM is control-plane capacity, not worker capacity. Persistent home processes should be small and useful; expensive short-lived analysis and timed batch execution belong on remote hosts. The GUI remains state-driven so visibility and low-cost command controls do not add expensive analysis APIs to home.

## Roadmap

1. validate prep-and-hold behavior on larger targets and confirm it does not oscillate between grow/weaken;
2. expose batch health/timing state in the main GUI;
3. integrate the batch runner into production after targets are prepared;
4. add a strict post-batch strategic review barrier;
5. measure timing drift and tune the landing gap dynamically;
6. add overlapping/pipelined batches with RAM reservation and collision prevention;
7. add target/strategy hysteresis and predicted-versus-actual calibration;
8. split more dispatch/scheduling work out of the home controller;
9. optimize the whole remote RAM pool across multiple targets;
10. flesh out the independent stock subsystem.

See `docs/architecture.md` for the architectural direction.
