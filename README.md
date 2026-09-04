# Agxnny Bitburner Scripts

A modular Bitburner automation project for v3.x, currently focused on an early-game distributed HGW system with a control-only home node, remote worker execution, remote tactical planning, runtime telemetry, progression guidance, economic target selection, automatic rooting, adaptive money targeting, controlled cloud-server purchasing, diagnostics, and a path toward multi-target HWGW batching.

## Current architecture

- **Home is the control/UI node.** HGW worker threads are not dispatched to home; its RAM is kept available for the persistent controller, dashboard/GUI, updater, and future orchestration services.
- **Workers** stay minimal and only perform assigned `hack`, `grow`, or `weaken` actions on remote execution hosts.
- **Planner** performs expensive network discovery and baseline target ranking, then publishes cached state for lightweight consumers.
- **Refresh coordinator** runs remotely. It performs a lightweight rooting/tool check every 30 seconds, but only runs the heavy target/RAM planner after a completed `HACK` or when the execution pool expands.
- **Automatic rooting** detects newly owned port-opening programs, roots every immediately rootable server, publishes the result on Port 9, then triggers a fresh planner/economy pass only when new servers were gained.
- **Automated cloud purchasing** follows the progression advisor. When the selected progression goal is an affordable new cloud server, one server may be purchased per strategic refresh using the deterministic `hgw-001`, `hgw-002`, ... naming scheme. Existing manually named cloud servers are left unchanged.
- **Manual money goal** is a user spending lock. While active, it overrides the automatic progression cash goal for target economics and blocks automated cloud purchases even if stale advisor state still says a server is affordable.
- **New-host sync** copies execution/support files to newly rooted or newly purchased RAM hosts without rerunning the heavy startup deploy on home.
- **Economic strategy selector** compares live target state, real **remote-only** worker capacity, preparation waves, exponentially weighted prep time, expected production rate, the current progression cash goal, and multiple desired-money percentages. Small targets below the partial-prep threshold are forced to 100% money before production.
- **Controller** runs persistently on home, adopts the selected server and desired-money strategy, requests remote tactical plans, dispatches workers across the remote RAM pool, and publishes state.
- **Tactical planner** is launched on remote execution hosts and receives both the chosen hack fraction and chosen desired-money percentage.
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

## Manual money goal / purchase lock

Set a cash target with convenient `k`, `m`, `b`, or `t` suffixes:

```text
run economy/manual-goal.js 50m
run economy/manual-goal.js 1.5b "Save for milestone"
```

Inspect or clear it with:

```text
run economy/manual-goal.js status
run economy/manual-goal.js clear
```

While a manual goal is active:

- Port 11 records the manual target;
- `hacking/economy-planner.js` uses the remaining amount to that target as the active economic goal;
- automatic progression recommendations are still calculated for visibility but are not treated as the active spending goal;
- `network/cloud-buy.js` has a direct hard lock and will publish `BLOCKED_MANUAL_GOAL` instead of purchasing;
- setting or clearing the goal triggers a lightweight economy/target refresh without requiring a full network planner pass.

Reaching the manual target does **not** automatically clear it. Automated purchasing stays locked until you explicitly run `clear`, which prevents reaching the savings target from immediately spending the money you just accumulated.

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
| 11 | manual money-goal / automated-spending lock snapshot |

## Hacking flow

The current controller is sequential HGW rather than timed batching:

1. adopt the latest economic target and desired-money percentage,
2. observe live money/security,
3. request the tactical calculation on a remote host,
4. weaken/grow/hack using remote worker hosts only,
5. after the `HACK` completes, let the remote refresh chain reconsider network, RAM, progression, target, and strategy.

There is deliberately **no home fallback for HGW workers**. If remote worker RAM is unavailable, the controller waits instead of consuming the control/UI node. Partial dispatches remain safe: if only part of a requested action fits remotely, the controller waits for that work to finish and recalculates from live state.

## Event-driven planning, rooting, purchasing, and RAM-pool growth

The heavy `hacking/planner.js` is not timer-driven during normal operation. `hacking/refresh.js` performs meaningful refresh paths for HACK completion, execution-pool expansion, and manual money-goal changes.

If a rooting pass gains one or more servers, the system immediately refreshes the planner, syncs runtime files to the new hosts, and recalculates the economic strategy using the expanded execution pool.

The progression refresh can also trigger `network/cloud-buy.js`. It only purchases when the current advisor goal is `PURCHASED_SERVER`, that goal is affordable, and no manual money goal is active. At most **one** cloud server is bought in a single strategic pass, preventing a large cash balance from being drained by a purchase loop. After a purchase, the planner and sync pass run again so the new server joins the execution pool before target selection finishes.

Automated cloud servers use this naming scheme:

```text
hgw-001
hgw-002
hgw-003
...
```

The purchaser chooses the first unused managed name, so numbering remains stable even if older managed servers are missing. Existing manually named purchased servers are not renamed.

## Adaptive economic strategy selection

The baseline target score remains:

```text
max money × hack percent per thread × hack chance / hack time
```

For targets large enough to justify partial preparation, the selector evaluates:

```text
25%, 40%, 55%, 70%, 85%, 100%
```

There is also a **small-server full-prep floor**. The current test value is **$5,000,000 server max money**. If a server's maximum money is at or below that threshold, the partial percentages are not considered and the server is forced to **100% money before hacking**.

The selector also has a cash-relative target-value filter. It compares **player cash against the server's maximum money**, not the server's current money. The current test threshold ignores a target when player cash is at least 200% above that server's max (3x its max), provided another viable target remains. If every target would be filtered, AUTO mode falls back instead of becoming targetless.

Economic prep and production estimates now exclude home from hack/grow/weaken capacity, matching actual dispatch policy. `executionCapacity.policy` is published as `REMOTE_ONLY`, so later diagnostics can distinguish worker RAM from control-node RAM.

The selected `moneyTargetPercent` is stored in Port 2/Port 8 state, adopted by the controller, and passed into `hacking/tactical-planner.js`. `lib/threads.js` supports arbitrary money-target percentages, so tactical execution follows the economic decision rather than automatically growing to max.

Run:

```text
run diagnostics/economy-targets.js
run diagnostics/dashboard.js
```

The economic diagnostic shows the winning server, chosen money percentage, target strategies, and alternatives. The dashboard's **Target Reasoning** section is intended for live troubleshooting.

## Progression advisor

`lib/progression.js` currently compares home RAM upgrades, buying a new cloud server, and the best next RAM-doubling upgrade across owned cloud servers. Home RAM now has a clearer role: it buys orchestration/UI headroom rather than worker throughput, while cloud/rooted RAM expands the actual HGW execution pool.

When a new-cloud-server candidate is selected and affordable, automation may execute that recommendation unless the manual money-goal lock is active. Cloud-server **upgrades are still advisory only**; automatic upgrade spending has not been enabled yet.

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
run economy/manual-goal.js status
run network/inspect.js
run network/root.js
run hacking/thread-plan.js
```

## Repository layout

```text
kickstart.js
gitpull.js
gitpull-self-update.js
manifest.json

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

Home RAM is treated as **control-plane capacity**, not worker capacity. The long-term goal is for home to host orchestration, state coordination, GUI/dashboard, and lightweight control functions while remote/rooted/cloud servers provide the data-plane RAM for HGW work and expensive short-lived analysis.

Current design examples:

- hack/grow/weaken workers never dispatch to home;
- tactical planning uses the same remote execution pool and has no home fallback;
- economic strategy capacity excludes home so prediction matches dispatch;
- the heavy target/RAM planner runs only after a completed HACK or genuine execution-pool expansion;
- manual goal changes refresh only economy/purchase/target state rather than the heavy planner;
- the lightweight root check runs remotely every 30 seconds;
- newly rooted and newly purchased hosts are synced remotely;
- cloud purchasing is a short-lived remote action rather than controller logic;
- the persistent controller remains the next major home-RAM optimization target.

## Roadmap

The next major layers are:

1. validate remote-only worker execution, adaptive money-target choices, the $5m full-prep floor, cash-relative value filtering, manual savings goals, and advisor-driven server purchases against real gameplay;
2. tune the cash/server-max ignore threshold after testing;
3. add the strict post-HACK review barrier;
4. add target/strategy-switch hysteresis so small score changes do not cause churn;
5. split worker dispatch/scheduling out of the controller to reduce persistent home RAM further;
6. calibrate predicted income against real telemetry;
7. expand progression candidate types and decide whether cloud upgrades should also be automated;
8. optimize the whole remote RAM pool across multiple targets;
9. transition from sequential HGW to timed HWGW batches.

See `docs/architecture.md` for the architectural direction.
