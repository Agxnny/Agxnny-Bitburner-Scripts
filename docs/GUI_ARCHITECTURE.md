# GUI Architecture

The main dashboard is intentionally modular. `ui/dashboard.js` is the shell and async bridge; feature rendering lives in focused view modules.

## Module layout

```text
ui/
  dashboard.js              shell, header, tabs, async Netscript loop
  dashboard-launcher.js     deferred admission for main + stock dashboards
  state.js                  cached runtime snapshot + validation process truth
  actions.js                plain-JS fields/request queue + Netscript action processor
  styles.js                 shared styles
  components/
    format.js               formatting helpers
    layout.js               cards, hero metrics, buttons, grids, badges
  views/
    overview.js
    targets.js
    economy.js
    batch.js
    validation.js
    network.js
    diagnostics.js

stocks/
  dashboard.js              separate active Market Lab
  styles.js
  candles.js
```

## Core safety rule

React callbacks must remain Netscript-free.

```text
async Netscript loop
    -> reads ports/files/process state
    -> refreshes cached plain-JS snapshot
    -> executes queued plain-JS requests

React tree
    -> mounted once
    -> reads cached state
    -> owns tab/collapse state
    -> queues plain-JS requests only
```

Direct Netscript calls from React callbacks previously made tab switching unstable and could terminate the GUI. Preserve this separation.

## Refresh model

- runtime snapshots refresh every 1 second;
- React bridge checks the state version every 100 ms;
- async action loop ticks every 25 ms;
- tab/collapse changes are React-local and do not wait for Netscript;
- validation process activity is checked separately from the persisted validation telemetry file so stale files do not permanently lock controls.

## Seven tabs

| Tab | Function |
| --- | --- |
| Overview | Target, 5-minute income, remote RAM, execution mode, health/economy, active workers. Generic controls are STANDBY, HGW, and Resume safety. |
| Targets | Manual/auto target override, selected economic strategy, prep progress/ETA, top economic targets. |
| Economy | Persistent manual savings target/spending lock, cash/remaining goal, cloud action, next progression goal. |
| Batch | Serialized batch state, pipeline state, real MULTI configuration/activity, latest completion and landing diagnostics. |
| Validation | Depth-2 qualification, individual full-depth testing, PROVEN2+ set testing, live landing stream, per-target/per-depth evidence. |
| Network | Discovered/rooted hosts, port tools, remote execution hosts and RAM. |
| Diagnostics | Health verdict, smoke/progression tests, memory/income/economy/progression/ranking diagnostics, state ages, safety notes. |

Specialized BATCH/PIPELINE/MULTI controls are intentionally not duplicated on Overview. MULTI controls live on Batch; validation controls live on Validation.

All normal cards and hero cards are collapsible.

## Validation UI

The target selector supports:

```text
MIXED · prepared VALIDATE2 only
ALL PREPARED · includes DEPTH1
PROVEN2+ SET · full-depth each
<individual planner targets>
```

Individual targets can use `FULL DEPTH TEST`. The PROVEN2+ set uses `FULL DEPTH · PROVEN2+ SET` and sequentially climbs every already-qualified target. Waves/depth, hack %, and stage gap are user controls. Launch is locked unless the controller is fully STANDBY and no other validator is active.

The evidence table shows each target's durable proven depth and tested depth markers. This is validation evidence; current production MULTI still uses per-target depth 1.

## Prep-progress UI

Targets consumes fresh Port 18 adaptive prepper state. It shows prepared count, below-max count, active prep jobs, reserved RAM/hosts, and per-target money %, action/queue state, ETA, and host/security context. ETA is advisory and estimates full readiness rather than only the current worker cycle.

## Batch/MULTI UI

Batch exposes MONEY/BALANCED/XP profile, top-target count, global live-batch cap, hack %, and stage gap for finite/controller MULTI. It explicitly displays the current production per-target cap of one batch. It also shows pipeline cadence/status, active MULTI target timing, completed recovery/drift/spacing, serialized batch state, and latest completion timeline.

## Diagnostics UI

Diagnostics provides a high-level HEALTHY / DEGRADED / SAFETY STOP / STALE TELEMETRY verdict plus actionable test buttons. Diagnostic process activity is tracked for dashboard-launched scripts; Port-6 test requests are separate from that process tracker.

## Stock Market Lab

`stocks/dashboard.js` is a separate read-only React window launched at startup. It is not a tab in the main control plane.

It provides:
- recorder/TIX/4S/trading status badges;
- cash and progress toward the $25b 4S API goal;
- portfolio values and unrealized P&L;
- true wall-clock CANDLES windows: 5m, 15m, 30m, 1h, 4h;
- HISTORY · LINE ranges: 15m, 1h, 3h, 6h, 12h, 24h, ALL;
- gap markers only when the gap intersects the visible chart range;
- market watch table and symbol selection.

Stock trading is disabled. `ui/stocks.js` is an older placeholder, not the active Market Lab.

## Maintainability guardrails

Follow `HANDOFF.md`: ordinary modules aim <=300 lines, review around 400, >500 needs a reason. Prefer focused modules, keep state transport/actions/styles/views separable, avoid circular imports, and do not grow `ui/dashboard.js` back into a feature monolith.
