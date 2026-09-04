# Agxnny Bitburner Scripts

A modular Bitburner automation project for v3.x, currently focused on an early-game distributed HGW system with low-RAM control, remote tactical planning, runtime telemetry, progression guidance, economic target selection, automatic rooting, diagnostics, and a path toward adaptive multi-target HWGW batching.

## Current architecture

The codebase is intentionally split by responsibility:

- **Workers** stay minimal and only perform assigned `hack`, `grow`, or `weaken` actions.
- **Planner** performs expensive network discovery and baseline target ranking, then publishes cached state for lightweight consumers. Baseline refreshes no longer overwrite a valid economic target while the fresh economy pass is still running.
- **Refresh coordinator** runs remotely. It performs a lightweight rooting/tool check every 30 seconds, but only runs the heavy target/RAM planner after a completed `HACK` or when new root access expands the execution pool.
- **Automatic rooting** detects newly owned port-opening programs, roots every immediately rootable server, publishes the result on Port 9, then triggers a fresh planner/economy pass only when new servers were actually gained.
- **New-host sync** copies the execution/support files to newly rooted RAM hosts after the planner discovers them, without rerunning the heavy startup deploy on the 8GB home node.
- **Economic target selector** compares targets by live money/security state, real distributed thread capacity, estimated prep waves, exponentially weighted prep time, expected production rate, and the current cash goal. A smaller prepared server can therefore outrank a richer server that would take too long to grow/weaken right now.
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

`--quiet` suppresses explicit controller/planner/service printouts while leaving state publication, telemetry, planning, rooting, and HGW work active. One-off diagnostic/report scripts remain explicit tools and can continue to print when run manually.

`kickstart.js` performs a zero-delay handoff sequence:

1. refresh `hacking/planner.js`,
2. run `network/deploy.js`, which copies worker/support files to rooted RAM hosts and starts remote telemetry, diagnostics, and refresh services,
3. wait for a fresh economic target decision from the remote refresh chain,
4. start `hacking/controller.js` on home using that economic target.

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
| 9 | latest rooting/tool-discovery snapshot |

State snapshot ports are replaced with the latest value. Port 4 and Port 6 are queues consumed by their respective remote services.

## Hacking flow

The current controller is sequential HGW rather than timed batching:

1. adopt the latest planner-selected target when idle,
2. observe live money/security,
3. request a fresh tactical plan,
4. dispatch the requested action across the available RAM pool,
5. wait for the launched jobs to finish,
6. after a completed `HACK`, allow the remote refresh coordinator to re-evaluate network, RAM, progression, and target priority before the next cycle settles.

Partial dispatches are safe: if only part of a requested grow/weaken/hack fits, the controller waits for that work to finish and recalculates from live state instead of blindly launching a stale remainder.

## Event-driven planning, rooting, and RAM-pool growth

The heavy `hacking/planner.js` is not timer-driven during normal operation. `hacking/refresh.js` performs two kinds of checks:

- every 30 seconds, run the lightweight `network/root.js` remotely to detect owned port tools and root any server whose port requirement is now satisfied;
- after a completed `HACK`, run the full planner/economy/target review.

If a rooting pass gains one or more new servers, that is also considered a meaningful topology event. The refresh service immediately runs the full planner, then `network/sync.js` copies the runtime files to the newly rooted RAM hosts, and finally economy/target selection is recalculated using the expanded execution pool.

This means buying a new port-opening program does not require restarting the automation stack. Within the next rooting check, newly rootable servers can be claimed automatically and added to the distributed RAM pool.

The planner still publishes its baseline #1 separately and preserves the previous valid economic winner while a fresh economy pass is running, avoiding temporary target switches caused by a baseline refresh.

## Economic target selection

The baseline target score remains:

```text
max money × hack percent per thread × hack chance / hack time
```

That answers which server looks strongest in isolation. The economic selector answers a more useful early-game question: **which server is likely to get us to the current cash goal fastest from its present state with the RAM we can actually dispatch?**

For each eligible target it reads live money and security, calculates required weaken/grow/recovery threads, and measures current distributed worker capacity by summing the thread slots that actually fit on each execution host after used RAM and the home reserve are removed. Prep and production time are then calculated in waves rather than from aggregate RAM alone, including host fragmentation.

Prep time is weighted non-linearly. The current model uses a 30-minute exponential scale: short prep stays near its real elapsed time, while multi-hour prep receives a rapidly increasing penalty. The economic selector ranks by this weighted prep cost plus estimated production time toward the current cash goal.

The Port-8 economic snapshot records usable RAM, per-action thread capacity, raw prep time, weighted prep time, prep penalty multiplier, prep/production wave counts, estimated steady income, and the resulting economic ETA. `diagnostics/economy-targets.js` displays the weighting so target decisions remain inspectable.

The next strategy step is to compare multiple desired money percentages instead of assuming every target must be grown to 100% before production.

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

`diagnostics/mem-audit.js` scans the live `.js` files installed on home and reports their current RAM cost. When `manifest.json` is available it also marks each file as managed or unmanaged; the audit still works if the manifest is missing.

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
  deployment.js              shared remote deployment file list
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
  sync.js                    lightweight post-root runtime sync

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

`manifest.json` is the authoritative list used by `gitpull.js` for managed files.

## RAM philosophy

RAM optimization is treated by lifetime and role, not by raw script size alone. Persistent home processes receive the most scrutiny; expensive short-lived planners are acceptable when they run remotely or only during setup.

Current design examples:

- the heavy target/RAM planner runs only after a completed HACK or a genuine root-pool expansion, not every 30 seconds;
- the lightweight root check runs remotely every 30 seconds;
- newly rooted hosts are synced remotely instead of rerunning startup deployment on home;
- the controller remains the next major persistent-home RAM optimization target.

## Roadmap

The next major layers are:

1. validate capacity-aware, prep-weighted target switching and automatic root-pool expansion against real gameplay,
2. add target-switch hysteresis,
3. evaluate partial grow targets instead of assuming every server should reach 100%,
4. continue reducing persistent home RAM usage,
5. add more progression candidate types such as port openers,
6. use real hack-income telemetry to calibrate predicted target income,
7. optimize the whole RAM pool across multiple targets,
8. transition from sequential HGW to timed HWGW batches,
9. expand the persistent dashboard as new structured state becomes useful.

See [`docs/architecture.md`](docs/architecture.md) for the architectural direction.
