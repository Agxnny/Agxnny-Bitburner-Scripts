# Agxnny Bitburner Scripts

A modular Bitburner automation project for v3.x, currently focused on an early-game distributed HGW system with low-RAM control, remote tactical planning, runtime telemetry, progression guidance, economic target selection, diagnostics, and a path toward adaptive multi-target HWGW batching.

## Current architecture

The codebase is intentionally split by responsibility:

- **Workers** stay minimal and only perform assigned `hack`, `grow`, or `weaken` actions.
- **Planner** performs expensive network discovery and baseline target ranking, then publishes cached state for lightweight consumers.
- **Refresh coordinator** runs remotely and refreshes the full planner, economy state, and economic target choice every 30 seconds.
- **Economic target selector** compares targets by estimated prep time, available RAM, expected production rate, and the current cash goal. A smaller prepared server can therefore outrank a richer server that would take too long to grow/weaken right now.
- **Controller** runs persistently, tracks the live target state, adopts the latest planner-selected target between jobs, requests tactical plans, dispatches workers across the rooted RAM pool, and publishes controller state.
- **Tactical planner** performs the expensive HGW thread calculations on a remote host, publishes one requested plan, then exits.
- **Execution layer** distributes worker threads across home and rooted RAM hosts while preserving a home reserve.
- **Telemetry** records actual `ns.hack()` returns and rolling income rates from distributed hack workers.
- **Progression advisor** ranks home RAM, new cloud-server capacity, and cloud-server upgrades through one candidate schema. Home RAM receives extra weight while home is below the dynamically measured core-automation RAM threshold.
- **Diagnostic dashboard** is deliberately lightweight and consumes cached state only. It also exposes explicit manual-test buttons without importing expensive test/progression logic into the dashboard process.

The long-term direction is adaptive strategy tuning, global RAM-pool optimization across multiple targets, and eventually timed HWGW batching without replacing these interfaces.

## Quick start

After pulling a clean copy from GitHub:

```text
run gitpull.js
run kickstart.js
```

For dashboard/GUI-style operation, start the stack quietly:

```text
run kickstart.js --quiet
```

`--quiet` suppresses explicit controller/planner/service printouts while leaving state publication, telemetry, planning, and HGW work active. `kickstart.js` propagates the flag through planner, deployment, remote refresh services, the controller, and tactical-planner launches. One-off diagnostic/report scripts remain explicit tools and can continue to print when you run them manually.

`kickstart.js` performs a zero-delay handoff sequence:

1. refresh `hacking/planner.js`,
2. run `network/deploy.js`, which copies worker/support files to rooted RAM hosts and starts remote telemetry, diagnostics, and refresh services,
3. start `hacking/controller.js` on home.

The clean updater intentionally stops active automation and replaces repo-managed files, so run `kickstart.js` again after a pull.

## Runtime state and ports

The current IPC layout is:

| Port | Purpose |
| --- | --- |
| 1 | latest controller state snapshot |
| 2 | latest planner state snapshot / current target priority |
| 3 | latest tactical thread-plan snapshot |
| 4 | hack-completion event queue |
| 5 | aggregate income telemetry snapshot |
| 6 | user-triggered diagnostic-test request queue |
| 7 | latest economy/progression snapshot |
| 8 | latest economic target-ranking snapshot |

State snapshot ports are replaced with the latest value. Port 4 and Port 6 are queues consumed by their respective remote services.

## Hacking flow

The current controller is sequential HGW rather than timed batching:

1. adopt the latest planner-selected target when idle,
2. observe live money/security,
3. request a fresh tactical plan,
4. dispatch the requested action across the available RAM pool,
5. wait for the launched jobs to finish,
6. discard the old tactical request and calculate again from live state.

Partial dispatches are therefore safe: if only part of a requested grow/weaken/hack fits, the controller waits for that work to finish and recalculates the remaining need instead of blindly launching a stale remainder.

## Periodic planning and target priority

`hacking/refresh.js` runs on a rooted remote host and refreshes the decision chain every 30 seconds:

1. `hacking/planner.js` rescans the network and rebuilds baseline target/ranking/RAM state,
2. `hacking/economy-planner.js` refreshes player cash, progression goal, remaining money required, and observed HGW income,
3. `hacking/economy-targets.js` evaluates the freshly-ranked targets and writes the economically preferred target back into Port 2.

The controller itself does not import these expensive analysis APIs. It simply sees the refreshed Port-2 target and can switch between jobs.

## Economic target selection

The baseline target score remains:

```text
max money × hack percent per thread × hack chance / hack time
```

That answers which server looks strongest in isolation. The economic selector answers a more useful early-game question: **which server is likely to get us to the current cash goal fastest from its present state?**

For each eligible target it estimates current money, security prep, grow/weaken work, RAM-limited prep waves, expected cash/sec, recovery cost, and estimated time to reach the active progression goal.

When a progression goal still needs cash, targets are primarily ordered by estimated goal ETA. This allows a smaller, already-prepared target to beat a high-max-money server whose grow/weaken investment would delay cash for too long. When there is no outstanding cash goal, the selector falls back toward steady income rate while still accounting for prep cost.

This is still a first-pass economic model. Future strategy tuning will compare multiple hack fractions, grow targets, RAM-seconds, observed-versus-predicted income, and multiple simultaneous targets.

## Progression advisor

`lib/progression.js` currently compares home RAM upgrades, buying a new cloud server, and the best next RAM-doubling upgrade across owned cloud servers. The shared value model is RAM gained per dollar with role weights, with extra home-RAM weight while home is below the core automation threshold.

Future candidates are intended to include port-opening programs and explicit save/hold recommendations without changing the consumer interface.

## Telemetry

Distributed hack workers publish their actual `ns.hack()` return value to Port 4. `hacking/telemetry.js` runs on a rooted remote host, aggregates those events, and publishes Port 5 with total HGW money, rolling income rates, hack-event outcomes, recent/per-target history, and execution-pool utilization copied from controller state.

This avoids measuring player-money deltas, so unrelated income sources do not contaminate HGW performance data.

## Diagnostics

Useful commands include:

```text
run diagnostics/dashboard.js
run diagnostics/mem-audit.js
run diagnostics/mem-audit.js --path
run diagnostics/test.js --list
run diagnostics/test.js controller-state
run diagnostics/test.js telemetry-state
run diagnostics/test.js progression-advisor
run diagnostics/economy-targets.js
run diagnostics/income.js
run diagnostics/progression.js
run network/inspect.js
run network/root.js
run hacking/thread-plan.js
run hacking/dispatch.js weaken foodnstuff 5
```

`diagnostics/mem-audit.js` reads the managed manifest and prints the current RAM cost of every managed `.js` file. By default it sorts highest RAM first; `--path` sorts alphabetically. Imported library RAM is already included in the runnable script totals reported by Bitburner.

The dashboard is intended for **live function checks only**, not as a home for every diagnostic. Expensive/manual tests stay explicit. Dashboard buttons write a request to Port 6, and the remote `diagnostics/test-launcher.js` launches the selected test off home.

## Repository layout

```text
kickstart.js

gitpull.js
gitpull-self-update.js
manifest.json

hacking/
  controller.js
  planner.js
  refresh.js
  economy-planner.js
  economy-targets.js
  tactical-planner.js
  dispatch.js
  targets.js
  telemetry.js
  thread-plan.js
  workers/
    hack.js
    grow.js
    weaken.js

lib/
  execution.js
  network.js
  output.js                 shared --quiet / argument helpers
  progression.js
  runtime-state.js
  state.js
  targets.js
  telemetry.js
  threads.js

network/
  deploy.js
  inspect.js
  root.js

diagnostics/
  dashboard.js
  economy-targets.js
  income.js
  mem-audit.js              manifest-wide RAM report
  progression.js
  test.js
  test-launcher.js

docs/
  architecture.md
```

`manifest.json` is the authoritative list used by `gitpull.js` for managed files.

## RAM philosophy

RAM optimization is treated by lifetime and role, not by raw script size alone. Persistent home processes receive the most scrutiny; expensive short-lived planners are acceptable when they run remotely or only during setup.

Current examples from Bitburner v3.0.1 testing:

- `diagnostics/dashboard.js` has been reduced to cached-state-only behavior and should remain close to base script RAM.
- `hacking/telemetry.js` is a low-cost persistent remote service and can run silently under `--quiet`.
- `hacking/tactical-planner.js`, `hacking/planner.js`, and the economic analysis scripts are intentionally kept off the persistent home controller.
- `hacking/controller.js` remains the next important persistent-home optimization target; a future dispatcher split can move its `exec` cost off home.

## Roadmap

The next major layers are:

1. validate periodic economic target switching against real gameplay,
2. add live-state target comparisons and target-switch hysteresis,
3. evaluate partial grow targets instead of assuming every server should reach 100%,
4. continue reducing persistent home RAM usage,
5. add more progression candidate types such as port openers,
6. use real hack-income telemetry to calibrate predicted target income,
7. optimize the whole RAM pool across multiple targets,
8. transition from sequential HGW to timed HWGW batches,
9. expand the persistent dashboard as new structured state becomes useful.

See [`docs/architecture.md`](docs/architecture.md) for the architectural direction.
