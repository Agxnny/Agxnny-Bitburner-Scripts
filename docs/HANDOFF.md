# Project Handoff Guide

GitHub `main` is the source of truth. Read this file first, then fetch current live files before editing. Target is Bitburner v3.x; live testing is v3.0.1.

## Engineering constraints: prefer modules over monoliths

Prefer small modules with narrow responsibilities that work together over large monolithic scripts.

Soft size targets:

```text
ordinary module / script        aim for <= 300 lines
review / split threshold        ~400 lines
exception threshold             >500 lines requires a clear reason
UI view module                  ideally 100-250 lines
shared UI component module      ideally 100-250 lines
entrypoint / coordinator        keep as small as practical
individual function             usually <= 40-60 lines
```

These are guardrails, not arbitrary hard failures. Split by responsibility, not merely to satisfy line count. Avoid circular imports and preserve Bitburner RAM awareness when introducing shared modules.

For GUI work specifically: React callbacks must remain Netscript-free. The async Netscript loop owns ports/files/process launches; React consumes cached plain-JS state and emits plain-JS requests.

## Current control modes

```text
STANDBY   controller parked
HGW       sequential automation
BATCH     serialized HWGW
PIPELINE  continuous single-target depth-2 HWGW
MULTI     controller-managed repeated finite multi-target waves
```

Startup defaults to STANDBY. Background prep is independent of production mode.

## Latest validated batching evidence

Real multi-target stress test `mixed 6 2 12 0.10 200 10` completed cleanly through distinct-target depth 5:

```text
depth 2: 2/2 clean
depth 3: 2/2 clean
depth 4: 2/2 clean
depth 5: 2/2 clean
worst max drift: 129 ms
worst minimum spacing: 151 ms
```

Targets exercised included `phantasy`, `silver-helix`, `joesguns`, `sigma-cosmetics`, and `omega-net`. Depth 6 did not fail; it was prep-limited because only five prepared candidates were available. Therefore global distinct-target concurrency 5 is proven clean and depth 6 remains inconclusive.

Per-target real MULTI overlap remains hard-capped at 1. Port 19 same-target history and Port 20 global distinct-target stress evidence are separate safety signals.

## Distributed target prepper V2

```text
hacking/prepper.js
model: DISTRIBUTED_TARGET_PREPPER_V2
state: Port 18
```

V2 periodically scans the full eligible target universe through shared target logic, reserves a bounded slice of remote RAM across multiple hosts, and prepares different targets concurrently.

Defaults:

```text
target refresh: 15 seconds
reserve ratio: 12.5% remote RAM
minimum reserve: 64 GB
maximum reserve: 1024 GB
money ready threshold: >=99.5%
security ready threshold: <= min +0.05
```

Production excludes all fresh Port 18 `reservedHosts[]` entries through `lib/execution.js`. Existing production work on a newly selected prep host drains naturally before prep uses it.

Port 18 publishes aggregate prep state plus `prepTargets[]` entries containing hostname, current/max money, money ratio, security delta, action, active host, and advisory ETA.

## Modular dashboard refactor

The old monolithic `ui/dashboard.js` has been replaced by a parity-first modular architecture.

```text
ui/
  dashboard.js              small shell + async loop
  state.js                  cached snapshot / version bridge
  actions.js                plain-JS request model + async action processor
  styles.js                 shared styles
  components/
    format.js               formatting helpers
    layout.js               cards, buttons, badges, grids, hero metrics
  views/
    overview.js
    targets.js
    economy.js
    batch.js
    network.js
    diagnostics.js
```

Detailed architecture notes are in `docs/GUI_ARCHITECTURE.md`.

Feature parity retained:

```text
- six existing tabs
- single-mounted React tree
- React-local tab switching
- collapsible normal cards and hero cards
- quick STANDBY / HGW / BATCH / PIPELINE / MULTI controls
- prep + hold and Resume controls
- manual target override
- money-goal controls
- MULTI finite/controller controls
- live MULTI activity
- pipeline summary
- serialized and completed batch timing telemetry
- network view
- diagnostics/test commands
- stale pipeline freshness gating
```

### New Targets prep-progress card

The Targets tab now contains `Servers below max money` using Port 18 prep telemetry. It shows:

```text
SERVER
MONEY %
STATE        active/queued GROW or WEAKEN
ETA 100%     advisory prep estimate
HOST / SEC   active reserved host or security delta
```

The card also shows prepared count, below-max count, active prep count, reserved prep RAM, and reserved host count.

Important: the ETA is advisory. It is estimated from current grow/weaken timing, queue position, and reserved prep-host capacity; target state can change before completion.

## GUI runtime model that must not regress

```text
Netscript async loop
    -> refresh snapshot about once per second
    -> process queued plain-JS actions

React tree
    -> mounted once
    -> checks a JS version counter frequently
    -> owns tabs and collapse state locally
    -> never directly calls Netscript APIs
```

The prior direct/reactive Netscript approach caused unstable tab switching and dashboard termination. Do not reintroduce Netscript calls inside React callbacks.

## Multi-target runner/controller

Current real finite executor:

```text
hacking/multi-target-runner.js
model: MULTI_TARGET_EXECUTOR_V2_CONFIGURABLE_FINITE
```

Usage:

```text
run hacking/multi-target-runner.js [money|balanced|xp] [targetCount 2-12] [hackFraction] [stageGapMs] [globalDepth 2-12]
```

Controller MULTI repeats finite waves automatically. COMPLETE re-evaluates and launches another wave; BLOCKED retries later; SAFETY_STOP halts future admissions until Resume; mode changes wait for the current finite wave to drain.

## Runtime state ports

```text
12 serialized batch
14 live worker timing events; exactly one real coordinator owns it
15 latest completed batch
16 single-target pipeline state
17 multi-target scheduler/executor state
18 distributed prepper state
19 rolling per-target safety history
20 progressive global stress-test state
```

See `docs/RUNTIME_STATE.md` for the current contract.

## Immediate validation sequence

The modular dashboard code is committed but still requires live Bitburner validation.

```text
1. run gitpull.js
2. stop/restart ui/dashboard.js or run startup.js so all imported UI modules reload
3. run diagnostics/mem-audit.js
4. verify there are no unmanaged .js files
5. rapidly switch all six tabs repeatedly; dashboard must remain alive
6. collapse/reopen cards and hero metrics across tabs
7. test Standby/HGW/Batch/Pipeline mode buttons without running risky work unnecessarily
8. open Targets and verify the Servers below max money card receives fresh Port 18 state
9. confirm money %, prep state, ETA, and active host/security values update over time
10. test MULTI form editing and finite/controller buttons while respecting STANDBY safety gates
11. inspect ps home if the dashboard exits or tab switching becomes sticky
```

Because the new `ui/*` support files are ordinary `.js` files outside `lib/`, the current `diagnostics/mem-audit.js` labels them as `script` even though they are imported modules. That audit classification is cosmetic; the important checks are managed/unmanaged status and dashboard RAM.

## Next development sequence after GUI validation

```text
1. Let prepper V2 raise prepared-target count above five.
2. Re-run stress test through depth 6; depth 5 is already proven.
3. Improve stress BLOCKED behavior so it observes Port 18 readiness instead of relaunching a blocked runner every 10 seconds.
4. Persist/consume proven global stress depth as an evidence ceiling for production MULTI, never as a forced depth.
5. Validate repeated controller-owned MULTI waves and MULTI -> STANDBY drain.
6. Move from whole-wave repetition to rolling per-target admissions.
7. Add target-local recovery before aggressive continuous admission or same-target overlap.
8. Keep watchdog termination deferred until batching/pipeline behavior is stable.
```

XP scoring remains a proxy rather than exact Formula-based hacking XP.
