# Agxnny Bitburner Scripts

A modular Bitburner automation project for v3.x, currently focused on an early-game distributed HGW system with a control-only home node, remote worker execution, adaptive economic targeting, progression automation, a unified control-plane GUI, diagnostics, and a path toward multi-target HWGW batching.

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

Current tabs:

- **Overview** — target, 5-minute income, remote RAM, active money goal, live HGW state, execution state, economy, and system health.
- **Targets** — selected economic strategy, prep/weighted prep, expected income, economic ETA, rankings, and filtered targets.
- **Economy** — progression goal, manual savings lock, cloud-purchase state, and common money-goal commands.
- **Network** — discovery/rooting metrics, port tools, and remote execution hosts.
- **Diagnostics** — cached health checks, manual test buttons, state ages, and common diagnostic commands.

The older `diagnostics/dashboard.js` remains a focused troubleshooting panel. `ui/dashboard.js` is the main control-plane GUI.

## Stock trading workspace

Stock trading is deliberately isolated from the HGW control plane and is **not started by `startup.js`**. It has its own terminal and GUI placeholders so it can be developed later without bloating the main dashboard or mixing trading logic into HGW orchestration.

```text
run stocks/terminal.js
run ui/stocks.js
```

At present both are display-only placeholders and **do not place trades**. The intended future split is:

```text
stocks/terminal.js   -> trading-engine logs / decisions / order events
ui/stocks.js         -> portfolio, signals, positions, risk and controls
```

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
- **Main GUI** consumes cached state and presents it without owning strategy logic.
- **Stock subsystem** is a separate future workspace with its own terminal and GUI.

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
run stocks/terminal.js
run ui/stocks.js
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
  stocks.js

stocks/
  terminal.js

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

The stock subsystem is also kept separate so enabling stock trading later does not automatically increase the footprint of the main HGW dashboard.

## Roadmap

1. validate the polished unified GUI and one-command quiet startup;
2. add safe GUI controls through low-RAM command/state channels;
3. add the strict post-HACK strategic review barrier;
4. add target/strategy hysteresis;
5. split dispatch/scheduling out of the controller to reduce persistent home RAM;
6. calibrate predicted income against real telemetry;
7. flesh out the independent stock terminal/GUI and stock runtime-state contract;
8. optimize the whole remote RAM pool across multiple targets;
9. transition from sequential HGW to timed HWGW batches.

See `docs/architecture.md` for the architectural direction.
