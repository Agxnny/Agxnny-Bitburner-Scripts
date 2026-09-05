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

## Distributed target prepper V3 adaptive focus

```text
hacking/prepper.js
hacking/prepper-allocation.js
model: DISTRIBUTED_TARGET_PREPPER_V3_ADAPTIVE_FOCUS
state: Port 18
policy: ADAPTIVE_FOCUS_GROW_THEN_WEAKEN
```

The prepper still scans the full eligible target universe and reserves a bounded slice of remote RAM, but allocation is now adaptive. `hacking/prepper-allocation.js` compares different focus widths and estimates target-completion throughput. It may spread prep across several targets or concentrate several reserved hosts on the same target when that is projected to finish useful prep work faster.

Defaults:

```text
target refresh: 15 seconds
reserve ratio: 12.5% remote RAM
minimum reserve: 64 GB
maximum reserve: 1024 GB
money ready threshold: >=99.5%
security ready threshold: <= min +0.05
```

Prep ordering remains money-first. If a target is below the money threshold, the current stage is GROW even when security is elevated. After money reaches the threshold, the next stage becomes WEAKEN until security is within tolerance.

Important same-target behavior:

```text
- one target may receive multiple GROW/WEAKEN jobs on different reserved hosts in the same prep wave
- host allocations for a target are launched together from one calculated plan
- a target is considered busy while any job from its current wave remains active
- that target is not replanned until every job in its current wave finishes
- after the wave finishes, live money/security is read again before another stage is admitted
```

This avoids duplicate re-planning against partially completed same-target grow effects while still allowing unused prep hosts to work on other non-busy targets.

Production excludes all fresh Port 18 `reservedHosts[]` entries through `lib/execution.js`. Existing production work on a newly selected prep host drains naturally before prep uses it.

Port 18 V3 publishes the existing aggregate prep state plus:

```text
activeTargetCount
activeJobs[] with waveId / target / action / threads / host
prepTargets[].activeJobs
prepTargets[].activeThreads
prepTargets[].hosts[]
focus {
  mode
  width
  targets[]
  estimatedMakespanMs
  estimatedTargetsPerHour
  waveId
  launchedJobs
}
```

The focus estimator is advisory. It optimizes current prep-stage throughput using live grow/weaken thread demand, durations, and reserved-host capacities; each finished wave is followed by a fresh calculation from actual server state.

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

### Targets prep-progress card

The Targets tab contains `Servers below max money` using Port 18 prep telemetry. It shows server, money %, active/queued GROW or WEAKEN state, advisory ETA, and current host/security information.

The V3 telemetry now exposes multiple hosts/threads per target, but the current card still presents the compatibility `host` field first. A future small UI improvement can render focused host count/thread totals directly.

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
18 adaptive distributed prepper state
19 rolling per-target safety history
20 progressive global stress-test state
```

See `docs/RUNTIME_STATE.md` for the current contract.

## Immediate validation sequence

```text
1. run gitpull.js
2. restart startup/prepper so V3 + prepper-allocation.js are live
3. run diagnostics/mem-audit.js and confirm no unmanaged files
4. watch Targets -> Servers below max money
5. use ps on two or more reserved prep hosts and confirm the same target can appear simultaneously when focus mode concentrates
6. confirm Port 18 / GUI money percentage jumps faster for focused targets
7. confirm a focused target is not assigned a second wave until all jobs from its current wave have finished
8. confirm targets switch from concentrated GROW to WEAKEN only after money reaches >=99.5%
9. confirm prepared count rises and no prep jobs collide with production hosts
```

Because the new `ui/*` support files are ordinary `.js` files outside `lib/`, the current `diagnostics/mem-audit.js` labels them as `script` even though they are imported modules. That audit classification is cosmetic.

## Next development sequence after prep validation

```text
1. Let adaptive prep raise prepared-target count above five.
2. Re-run stress test through depth 6; depth 5 is already proven.
3. Improve stress BLOCKED behavior so it observes Port 18 readiness instead of relaunching a blocked runner every 10 seconds.
4. Persist/consume proven global stress depth as an evidence ceiling for production MULTI, never as a forced depth.
5. Validate repeated controller-owned MULTI waves and MULTI -> STANDBY drain.
6. Move from whole-wave repetition to rolling per-target admissions.
7. Add target-local recovery before aggressive continuous admission or same-target overlap.
8. Keep watchdog termination deferred until batching/pipeline behavior is stable.
```

XP scoring remains a proxy rather than exact Formula-based hacking XP.
