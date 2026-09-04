# Agxnny Bitburner Scripts

A modular Bitburner automation project for v3.x, currently focused on an early-game distributed HGW system with a control-only home node, remote worker execution, adaptive economic targeting, progression automation, a unified control-plane GUI, diagnostics, and a path toward multi-target HWGW batching.

## Quick start

After pulling the repo, normal startup is now one command:

```text
run startup.js
```

`startup.js` opens the main GUI on home and then hands automation startup to `kickstart.js` in quiet mode. Background services therefore stay quiet while the GUI becomes the primary control surface.

For maintenance/update:

```text
run gitpull.js
run startup.js
```

`kickstart.js` remains available as the lower-level automation bootstrap when the GUI is not wanted.

## Main GUI

The main interface is:

```text
run ui/dashboard.js
```

It is a cached-state consumer only: expensive game analysis stays in remote planners and services rather than being duplicated inside the GUI. The current GUI has five tabs:

- **Overview** — current HGW target/action, target state, remote execution RAM, income, economy goal, and system summary.
- **Targets** — selected economic strategy, target reasoning, economic ranking, and targets rejected by value filters.
- **Economy** — progression goal, manual money lock, cloud-purchase state, and useful money-goal commands.
- **Network** — discovery/rooting status, port tools, and the remote RAM pool.
- **Diagnostics** — cached health checks, manual smoke/progression-test buttons, state ages, and common diagnostic commands.

The older `diagnostics/dashboard.js` remains a focused diagnostic panel. The new `ui/dashboard.js` is the primary day-to-day control-plane GUI and is intended to grow into the main interface for the whole automation stack.

## Current architecture

- **Home is the control/UI node.** HGW workers are never dispatched to home; its RAM is reserved for controller/orchestration, GUI, updater, and future control services.
- **Workers** remain minimal `hack`, `grow`, and `weaken` scripts running only on remote execution hosts.
- **Planner** performs network discovery and baseline target ranking, then publishes cached state.
- **Refresh coordinator** runs remotely, checks rooting periodically, and performs heavy strategic refreshes only after meaningful events.
- **Automatic rooting** detects newly available port tools, roots eligible servers, and expands the remote RAM pool.
- **Controlled cloud purchasing** can buy one advisor-approved server per strategic refresh with deterministic names `hgw-001`, `hgw-002`, ... .
- **Manual money goal** overrides the automatic cash goal and hard-locks automated purchasing until explicitly cleared.
- **Economic strategy selector** compares live target state, remote-only worker capacity, prep waves, exponential prep cost, desired-money percentages, progression distance, and cash-relative target value.
- **Controller** runs persistently on home and orchestrates HGW while tactical calculation and worker execution remain remote.
- **Telemetry** records real hack returns and rolling income rates.
- **Main GUI** consumes Ports 1/2/3/5/7/8/9/10/11 and presents the state without owning strategy logic.

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

## HGW flow

The current controller is sequential HGW rather than timed batching:

1. adopt the latest selected target and desired-money percentage;
2. observe live money/security;
3. request tactical calculation on a remote host;
4. weaken/grow/hack using remote workers only;
5. after HACK completion, run the strategic review chain.

There is deliberately no home worker fallback. If remote worker RAM is unavailable, the controller waits instead of consuming the control/UI node.

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
run diagnostics/dashboard.js
run diagnostics/mem-audit.js
run diagnostics/economy-targets.js
run diagnostics/income.js
run diagnostics/progression.js
run economy/manual-goal.js status
run network/inspect.js
run network/root.js
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

economy/
  manual-goal.js

hacking/
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

Home RAM is control-plane capacity, not worker capacity. Persistent home processes should be small and useful; expensive short-lived analysis belongs on remote hosts. The GUI is intentionally state-driven so adding more visibility does not require adding expensive Netscript APIs to home.

## Roadmap

1. validate the new unified GUI and one-command startup;
2. add the strict post-HACK strategic review barrier;
3. add target/strategy hysteresis;
4. split dispatch/scheduling out of the controller to reduce persistent home RAM;
5. expose more progression controls safely through GUI command/state channels;
6. calibrate predicted income against real telemetry;
7. optimize the whole remote RAM pool across multiple targets;
8. transition from sequential HGW to timed HWGW batches.

See `docs/architecture.md` for the architectural direction.
