# Agxnny Bitburner Scripts

A modular Bitburner automation project for v3.x, currently focused on an early-game distributed HGW system with low-RAM control, remote tactical planning, runtime telemetry, progression guidance, economic target selection, automatic rooting, adaptive money targeting, diagnostics, and a path toward multi-target HWGW batching.

## Current architecture

- **Workers** stay minimal and only perform assigned `hack`, `grow`, or `weaken` actions.
- **Planner** performs expensive network discovery and baseline target ranking, then publishes cached state for lightweight consumers.
- **Refresh coordinator** runs remotely. It performs a lightweight rooting/tool check every 30 seconds, but only runs the heavy target/RAM planner after a completed `HACK` or when new root access expands the execution pool.
- **Automatic rooting** detects newly owned port-opening programs, roots every immediately rootable server, publishes the result on Port 9, then triggers a fresh planner/economy pass only when new servers were gained.
- **New-host sync** copies execution/support files to newly rooted RAM hosts without rerunning the heavy startup deploy on the 8GB home node.
- **Economic strategy selector** compares live target state, real distributed thread capacity, preparation waves, exponentially weighted prep time, expected production rate, the current progression cash goal, and multiple desired-money percentages.
- **Controller** runs persistently, adopts the selected server *and* desired-money strategy, requests tactical plans, dispatches workers across the rooted RAM pool, and publishes state.
- **Tactical planner** performs the expensive HGW thread calculation remotely and now receives both the chosen hack fraction and chosen desired-money percentage.
- **Telemetry** records actual `ns.hack()` returns and rolling income rates from distributed hack workers.
- **Progression advisor** ranks home RAM, new cloud-server capacity, and cloud-server upgrades through one candidate schema.
- **Diagnostic dashboard** remains deliberately lightweight and consumes cached state only.

## Quick start

```text
run gitpull.js
run kickstart.js
```

For quiet dashboard/GUI-style operation:

```text
run kickstart.js --quiet
```

The clean updater intentionally stops active automation, so run `kickstart.js` again after a pull.

## Runtime state and ports

| Port | Purpose |
| --- | --- |
| 1 | latest controller state snapshot |
| 2 | latest planner state / selected target strategy |
| 3 | latest tactical thread-plan snapshot |
| 4 | hack-completion event queue |
| 5 | aggregate income telemetry snapshot |
| 6 | user-triggered diagnostic-test request queue |
| 7 | latest economy/progression snapshot |
| 8 | latest economic target/strategy ranking snapshot |
| 9 | latest rooting/tool-discovery snapshot |

## Hacking flow

The current controller is sequential HGW rather than timed batching:

1. adopt the latest economic target and desired-money percentage,
2. observe live money/security,
3. weaken until security is acceptable,
4. grow only until the selected desired-money percentage is reached,
5. hack using the selected hack fraction,
6. after the `HACK` completes, let the remote refresh chain reconsider network, RAM, progression, target, and strategy.

Partial dispatches are safe: if only part of a requested action fits, the controller waits for that work to finish and recalculates from live state.

## Event-driven planning, rooting, and RAM-pool growth

The heavy `hacking/planner.js` is not timer-driven during normal operation. `hacking/refresh.js` performs two meaningful refresh paths:

- every 30 seconds, run the lightweight rooting check remotely;
- after a completed `HACK`, run the full planner/economy/strategy review.

If a rooting pass gains one or more servers, the system immediately refreshes the planner, syncs runtime files to the new hosts, and recalculates the economic strategy using the expanded execution pool.

Buying a new port-opening program therefore does not require restarting the stack.

## Adaptive economic strategy selection

The baseline target score remains:

```text
max money × hack percent per thread × hack chance / hack time
```

That baseline answers which server looks strongest in isolation. The economic strategy selector answers the more useful early-game question:

> Which server, prepared to what money level, is expected to reach the current progression goal fastest with the RAM we can actually dispatch?

For each eligible target the selector currently evaluates these desired-money levels:

```text
25%, 40%, 55%, 70%, 85%, 100%
```

For every server/percentage combination it:

- reads live money and security;
- calculates the grow amount needed only to reach that desired percentage;
- calculates security-prep and grow-recovery weaken work;
- measures actual hack/grow/weaken thread capacity host-by-host after used RAM and the home reserve are removed;
- converts thread requirements into real worker waves;
- estimates raw prep time and production-cycle time;
- applies the 30-minute exponential prep penalty to long preparation commitments;
- estimates steady cash/sec and progression-goal ETA.

Each server keeps its best percentage strategy, then those best strategies compete globally. This allows, for example, a partially prepared `sigma-cosmetics` strategy to compete against a fully prepared `n00dles` strategy rather than forcing both targets to 100% money.

The selected `moneyTargetPercent` is stored in Port 2/Port 8 state, adopted by the controller, and passed into `hacking/tactical-planner.js`. `lib/threads.js` already supports arbitrary money-target percentages, so the tactical grow phase stops at the chosen threshold instead of automatically growing to max.

Run:

```text
run diagnostics/economy-targets.js
```

to see the winning server, chosen money percentage, top target strategies, and all candidate money percentages for the selected target.

## Progression advisor

`lib/progression.js` currently compares home RAM upgrades, buying a new cloud server, and the best next RAM-doubling upgrade across owned cloud servers. Home RAM receives extra weight while home is below the measured core-automation requirement.

Future candidates are intended to include port-opening programs and explicit save/hold recommendations without changing the consumer interface.

## Telemetry

Distributed hack workers publish actual `ns.hack()` returns to Port 4. `hacking/telemetry.js` aggregates those events remotely and publishes Port 5 with total HGW money, rolling income rates, hack outcomes, recent/per-target history, and execution-pool utilization.

## Diagnostics

Useful commands include:

```text
run diagnostics/dashboard.js
run diagnostics/mem-audit.js
run diagnostics/mem-audit.js --path
run diagnostics/economy-targets.js
run diagnostics/income.js
run diagnostics/progression.js
run diagnostics/test.js --list
run network/inspect.js
run network/root.js
run hacking/thread-plan.js
```

`diagnostics/mem-audit.js` scans the live `.js` files installed on home and reports their current RAM cost. The dashboard remains focused on live function checks rather than becoming a giant report screen.

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

RAM optimization is treated by lifetime and role, not raw file size alone. Persistent home processes receive the most scrutiny; expensive analysis is acceptable when short-lived and remote.

Current design examples:

- the heavy target/RAM planner runs only after a completed HACK or genuine root-pool expansion;
- the lightweight root check runs remotely every 30 seconds;
- newly rooted hosts are synced remotely;
- economic strategy calculation is short-lived and remote;
- the controller remains the next major persistent-home RAM optimization target.

## Roadmap

The next major layers are:

1. validate adaptive money-target choices against real gameplay;
2. add target/strategy-switch hysteresis so small score changes do not cause churn;
3. reduce persistent controller RAM with a dispatcher split;
4. calibrate predicted income against real telemetry;
5. expand progression candidate types;
6. optimize the whole RAM pool across multiple targets;
7. transition from sequential HGW to timed HWGW batches;
8. expand the persistent dashboard as structured state becomes useful.

See `docs/architecture.md` for the architectural direction.
