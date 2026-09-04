# Agxnny Bitburner Scripts

A modular Bitburner automation project for v3.x, currently focused on an early-game distributed HGW system with low-RAM control, remote tactical planning, runtime telemetry, progression guidance, economic target selection, automatic rooting, adaptive money targeting, automated cloud-server purchasing, diagnostics, and a path toward multi-target HWGW batching.

## Current architecture

- **Workers** stay minimal and only perform assigned `hack`, `grow`, or `weaken` actions.
- **Planner** performs expensive network discovery and baseline target ranking, then publishes cached state for lightweight consumers.
- **Refresh coordinator** runs remotely. It performs a lightweight rooting/tool check every 30 seconds, but only runs the heavy target/RAM planner after a completed `HACK` or when the execution pool expands.
- **Automatic rooting** detects newly owned port-opening programs, roots every immediately rootable server, publishes the result on Port 9, then triggers a fresh planner/economy pass only when new servers were gained.
- **Automated cloud purchasing** follows the progression advisor. When the selected progression goal is an affordable new cloud server, one server may be purchased per strategic refresh using the deterministic `hgw-001`, `hgw-002`, ... naming scheme. Existing manually named cloud servers are left unchanged.
- **New-host sync** copies execution/support files to newly rooted or newly purchased RAM hosts without rerunning the heavy startup deploy on home.
- **Economic strategy selector** compares live target state, real distributed thread capacity, preparation waves, exponentially weighted prep time, expected production rate, the current progression cash goal, and multiple desired-money percentages. Small targets below the partial-prep threshold are forced to 100% money before production.
- **Controller** runs persistently, adopts the selected server *and* desired-money strategy, requests tactical plans, dispatches workers across the rooted RAM pool, and publishes state.
- **Tactical planner** performs the expensive HGW thread calculation remotely and receives both the chosen hack fraction and chosen desired-money percentage.
- **Telemetry** records actual `ns.hack()` returns and rolling income rates from distributed hack workers.
- **Progression advisor** ranks home RAM, new cloud-server capacity, and cloud-server upgrades through one candidate schema.
- **Diagnostic dashboard** remains deliberately lightweight and consumes cached state only. Its target-reasoning section explains the economic winner, controller mismatch/stall state, value-filter exclusions, and selected-strategy reasoning.

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
| 10 | latest automated cloud-purchase snapshot |

## Hacking flow

The current controller is sequential HGW rather than timed batching:

1. adopt the latest economic target and desired-money percentage,
2. observe live money/security,
3. weaken until security is acceptable,
4. grow only until the selected desired-money percentage is reached,
5. hack using the selected hack fraction,
6. after the `HACK` completes, let the remote refresh chain reconsider network, RAM, progression, target, and strategy.

Partial dispatches are safe: if only part of a requested action fits, the controller waits for that work to finish and recalculates from live state.

## Event-driven planning, rooting, purchasing, and RAM-pool growth

The heavy `hacking/planner.js` is not timer-driven during normal operation. `hacking/refresh.js` performs two meaningful refresh paths:

- every 30 seconds, run the lightweight rooting check remotely;
- after a completed `HACK`, run the full planner/economy/strategy review.

If a rooting pass gains one or more servers, the system immediately refreshes the planner, syncs runtime files to the new hosts, and recalculates the economic strategy using the expanded execution pool.

The progression refresh can also trigger `network/cloud-buy.js`. It only purchases when the current advisor goal is `PURCHASED_SERVER` and that goal is affordable. At most **one** cloud server is bought in a single strategic pass, preventing a large cash balance from being drained by a purchase loop. After a purchase, the planner and sync pass run again so the new server joins the execution pool before target selection finishes.

Automated cloud servers use this naming scheme:

```text
hgw-001
hgw-002
hgw-003
...
```

The purchaser chooses the first unused managed name, so numbering remains stable even if older managed servers are missing. Existing manually named purchased servers are not renamed.

Bitburner v3.0.1 uses the `ns.cloud` purchased-server API; the purchaser uses `ns.cloud.purchaseServer(hostname, ram)` and follows the RAM size selected by the progression advisor.

## Adaptive economic strategy selection

The baseline target score remains:

```text
max money × hack percent per thread × hack chance / hack time
```

That baseline answers which server looks strongest in isolation. The economic strategy selector answers the more useful early-game question:

> Which server, prepared to what money level, is expected to reach the current progression goal fastest with the RAM we can actually dispatch?

For targets large enough to justify partial preparation, the selector evaluates:

```text
25%, 40%, 55%, 70%, 85%, 100%
```

There is also a **small-server full-prep floor**. The initial test value is **$5,000,000 server max money**. If a server's maximum money is at or below that threshold, the partial percentages are not considered and the server is forced to **100% money before hacking**. This prevents a cheap early target from being attacked at 25% simply because its prep is short. The threshold is deliberately a single tuning constant so it can be adjusted after observing real gameplay.

For every allowed server/percentage combination the selector:

- reads live money and security;
- calculates the grow amount needed only to reach that desired percentage;
- calculates security-prep and grow-recovery weaken work;
- measures actual hack/grow/weaken thread capacity host-by-host after used RAM and the home reserve are removed;
- converts thread requirements into real worker waves;
- estimates raw prep time and production-cycle time;
- applies the 30-minute exponential prep penalty to long preparation commitments;
- estimates steady cash/sec and progression-goal ETA.

Each server keeps its best allowed percentage strategy, then those strategies compete globally. This allows a partially prepared larger server to compete against a fully prepared small server without making tiny targets artificially under-prepared.

The selector also has a cash-relative target-value filter. It compares **player cash against the server's maximum money**, not the server's current money. The current test threshold ignores a target when player cash is at least 200% above that server's max (3x its max), provided another viable target remains. If every target would be filtered, AUTO mode falls back instead of becoming targetless.

The selected `moneyTargetPercent` is stored in Port 2/Port 8 state, adopted by the controller, and passed into `hacking/tactical-planner.js`. `lib/threads.js` supports arbitrary money-target percentages, so tactical execution follows the economic decision rather than automatically growing to max.

Run:

```text
run diagnostics/economy-targets.js
run diagnostics/dashboard.js
```

The economic diagnostic shows the winning server, chosen money percentage, target strategies, and alternatives. The dashboard's **Target Reasoning** section is intended for live troubleshooting: it shows why the economic selector chose the target, whether the controller matches that choice, current tactical state, prep/grow load, low-value targets that were ignored, and whether a small-server full-prep rule affected the selected strategy.

## Progression advisor

`lib/progression.js` currently compares home RAM upgrades, buying a new cloud server, and the best next RAM-doubling upgrade across owned cloud servers. Home RAM receives extra weight while home is below the measured core-automation requirement.

When a new-cloud-server candidate is selected and affordable, automation may now execute that recommendation. Cloud-server **upgrades are still advisory only**; automatic upgrade spending has not been enabled yet.

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

`diagnostics/mem-audit.js` scans the live `.js` files installed on home and reports their current RAM cost. The dashboard remains focused on live function checks and target reasoning rather than becoming a giant report screen.

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

RAM optimization is treated by lifetime and role, not raw file size alone. Persistent home processes receive the most scrutiny; expensive analysis is acceptable when short-lived and remote.

Current design examples:

- the heavy target/RAM planner runs only after a completed HACK or genuine execution-pool expansion;
- the lightweight root check runs remotely every 30 seconds;
- newly rooted and newly purchased hosts are synced remotely;
- cloud purchasing is a short-lived remote action rather than controller logic;
- economic strategy calculation is short-lived and remote;
- the controller remains the next major persistent-home RAM optimization target.

## Roadmap

The next major layers are:

1. validate adaptive money-target choices, the $5m full-prep floor, cash-relative value filtering, and advisor-driven server purchases against real gameplay;
2. tune the cash/server-max ignore threshold after testing;
3. add the strict post-HACK review barrier;
4. add target/strategy-switch hysteresis so small score changes do not cause churn;
5. reduce persistent controller RAM with a dispatcher split;
6. calibrate predicted income against real telemetry;
7. expand progression candidate types and decide whether cloud upgrades should also be automated;
8. optimize the whole RAM pool across multiple targets;
9. transition from sequential HGW to timed HWGW batches.

See `docs/architecture.md` for the architectural direction.
