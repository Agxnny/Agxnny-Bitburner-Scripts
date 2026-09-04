# Agxnny Bitburner Scripts

A modular Bitburner automation project for v3.x, currently focused on an early-game distributed HGW system with low-RAM control, remote tactical planning, runtime telemetry, progression guidance, diagnostics, and a path toward adaptive multi-target HWGW batching.

## Current architecture

The codebase is intentionally split by responsibility:

- **Workers** stay minimal and only perform assigned `hack`, `grow`, or `weaken` actions.
- **Planner** performs expensive network discovery and baseline target ranking, then publishes cached state for lightweight consumers.
- **Controller** runs persistently, tracks the live target state, requests tactical plans, dispatches workers across the rooted RAM pool, and publishes controller state.
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

`kickstart.js` performs a zero-delay handoff sequence:

1. refresh `hacking/planner.js`,
2. run `network/deploy.js`, which copies worker/support files to rooted RAM hosts and starts remote support services,
3. start `hacking/controller.js` on home.

The clean updater intentionally stops active automation and replaces repo-managed files, so run `kickstart.js` again after a pull.

## Runtime state and ports

The current IPC layout is:

| Port | Purpose |
| --- | --- |
| 1 | latest controller state snapshot |
| 2 | latest planner state snapshot |
| 3 | latest tactical thread-plan snapshot |
| 4 | hack-completion event queue |
| 5 | aggregate income telemetry snapshot |
| 6 | user-triggered diagnostic-test request queue |

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

## Target ranking

`lib/targets.js` currently uses an explainable baseline score:

```text
max money × hack percent per thread × hack chance / hack time
```

This is deliberately not the final optimizer. Grow recovery, weaken recovery, RAM-time efficiency, and multi-target competition will be added by the adaptive strategy layer.

## Progression advisor

`lib/progression.js` currently compares:

- home RAM upgrades,
- buying a new cloud server,
- the best next RAM-doubling upgrade across owned cloud servers.

The shared value model is RAM gained per dollar with role weights. Home normally receives a control-node utility premium and receives a larger temporary weight when home is below the RAM tier required to host the core controller + tactical-planner stack with reserve.

Future candidates are intended to include port-opening programs and explicit save/hold recommendations without changing the consumer interface.

## Telemetry

Distributed hack workers publish their actual `ns.hack()` return value to Port 4. `hacking/telemetry.js` runs on a rooted remote host, aggregates those events, and publishes Port 5 with:

- total HGW money,
- lifetime income/sec,
- rolling 1-minute and 5-minute income/sec,
- successful and zero-return hack counts,
- recent hacks and per-target totals,
- execution-pool utilization copied from controller state.

This avoids measuring player-money deltas, so unrelated income sources do not contaminate HGW performance data.

## Diagnostics

Useful commands include:

```text
run diagnostics/dashboard.js
run diagnostics/test.js --list
run diagnostics/test.js controller-state
run diagnostics/test.js telemetry-state
run diagnostics/test.js progression-advisor
run diagnostics/income.js
run diagnostics/progression.js
run network/inspect.js
run network/root.js
run hacking/thread-plan.js
run hacking/dispatch.js weaken foodnstuff 5
```

The dashboard is intended for **live function checks only**, not as a home for every diagnostic. Expensive/manual tests stay explicit. Dashboard buttons write a request to Port 6, and the remote `diagnostics/test-launcher.js` launches the selected test off home.

## Repository layout

```text
kickstart.js

gitpull.js
gitpull-self-update.js
manifest.json

hacking/
  controller.js             persistent HGW controller
  planner.js                network / target / RAM planner
  tactical-planner.js       short-lived expensive HGW calculation
  dispatch.js               manual distributed-dispatch diagnostic
  targets.js                target-ranking diagnostic
  telemetry.js              remote income collector
  thread-plan.js            manual HGW thread-plan diagnostic
  workers/
    hack.js
    grow.js
    weaken.js

lib/
  execution.js              RAM pool + distributed thread dispatch
  network.js                discovery / access analysis helpers
  progression.js            progression candidate ranking
  runtime-state.js          Ports 1-3 state transport
  state.js                  target/controller state model
  targets.js                target analysis/ranking
  telemetry.js              Ports 4-5 telemetry transport
  threads.js                expensive HGW thread calculator

network/
  deploy.js                 copy execution/support files + start remote services
  inspect.js                read-only network/capability diagnostic
  root.js                   lightweight rooting pass

diagnostics/
  dashboard.js              lightweight cached-state live dashboard
  income.js                 income telemetry printout
  progression.js            progression-advisor printout
  test.js                   named smoke/functional tests
  test-launcher.js          remote Port-6 manual-test launcher

docs/
  architecture.md
```

`manifest.json` is the authoritative list used by `gitpull.js` for managed files.

## RAM philosophy

RAM optimization is treated by lifetime and role, not by raw script size alone. Persistent home processes receive the most scrutiny; expensive short-lived planners are acceptable when they run remotely or only during setup.

Current examples from Bitburner v3.0.1 testing:

- `diagnostics/dashboard.js` has been reduced to cached-state-only behavior and should remain close to base script RAM.
- `hacking/telemetry.js` is a base-cost persistent remote service.
- `hacking/tactical-planner.js` is intentionally expensive because its analysis APIs are expensive, so it runs remotely and exits immediately.
- `hacking/controller.js` is the next important persistent-home optimization target; a future dispatcher split can move its `exec` cost off home.

## Roadmap

The next major layers are:

1. continue reducing persistent home RAM usage,
2. add more progression candidate types such as port openers,
3. validate and use real hack-income telemetry in strategy decisions,
4. build an adaptive strategy evaluator for hack %, grow target %, recovery cost, and money/sec/GB,
5. optimize the whole RAM pool across multiple targets,
6. add predicted-vs-actual performance metrics,
7. transition from sequential HGW to timed HWGW batches,
8. expand the persistent dashboard as new structured state becomes useful.

See [`docs/architecture.md`](docs/architecture.md) for the architectural direction.