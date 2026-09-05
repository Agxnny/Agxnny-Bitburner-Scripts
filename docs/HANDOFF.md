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
etaModel: FULL_READY_GROW_PLUS_WEAKEN_V1
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

### Prep ETA semantics

`prepTargets[].etaMs` is now intended to mean estimated time until the target is fully ready, not merely time until the currently running grow/weaken cycle finishes.

For a low-money target the estimator includes:

```text
remaining time in the active GROW wave
+ any additional projected GROW rounds needed at the reserved-pool capacity
+ projected WEAKEN cleanup caused by current security plus the remaining grow work
```

For a money-ready/high-security target it includes remaining active WEAKEN time plus any additional weaken rounds. Queued targets also add an advisory delay based on the latest adaptive focus width/makespan. Because the prep allocator recalculates after each wave from live state, queued ETA remains advisory rather than an exact schedule.

## Modular dashboard architecture

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

### Readability + diagnostics refinement phase 1

The first operational refinement pass is now committed:

```text
- global dashboard typography increased roughly 10-15%
- primary values/card titles/buttons are more prominent
- Diagnostics now has a top-level HEALTHY / DEGRADED / SAFETY STOP / STALE TELEMETRY verdict
- Diagnostics has real buttons for:
    Smoke tests
    Progression test
    Memory audit
    Income diagnostic
    Economy target diagnostic
    Progression diagnostic
    Target ranking diagnostic
- direct diagnostics launched from the GUI are tracked with label, state, PID, start age, and finish age
- only one tracked direct diagnostic is admitted at a time from the dashboard
- State Ages now uses fresh/aging/stale visual severity
- read-only diagnostics may run in any controller mode
```

React callbacks still only enqueue plain-JS actions. The Netscript loop in `ui/actions.js` performs `ns.run`, PID tracking, and completion polling. Do not move Netscript calls into React callbacks.

### Overview control cleanup

The Overview tab is being treated as a status/control summary rather than a duplicate control surface.

Removed from Overview:

```text
BATCH launch button
PIPELINE launch button
MULTI launch button
manual Prep + hold button
```

Overview now keeps only the generic controller actions that are still useful everywhere:

```text
Standby
HGW
Resume safety
```

MULTI configuration/start remains on the Batch tab. Background prepper operation is automatic and no longer needs a duplicate manual Prep + hold button on Overview. BATCH/PIPELINE backend modes are still present for compatibility/testing; only their redundant Overview buttons were removed. Do not delete backend mode support until it has been explicitly reviewed and proven obsolete.

### Targets prep-progress card

The Targets tab contains `Servers below max money` using Port 18 prep telemetry. It shows server, money %, active/queued GROW or WEAKEN state, advisory ETA, and current host/security information.

The V3 telemetry exposes multiple hosts/threads per target, but the current card still presents the compatibility `host` field first. The next UI refinement should render focused host count/thread totals directly and improve prep-state progress presentation.

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
2. restart startup/dashboard so current UI modules reload
3. rapidly switch all six tabs repeatedly and confirm the dashboard remains alive/snappy
4. confirm larger typography is readable without making Batch/Diagnostics unmanageably tall
5. confirm Overview now shows only Standby / HGW / Resume safety controls
6. open Diagnostics and confirm the top verdict is HEALTHY under normal fresh state
7. click Memory audit and confirm it launches, shows RUNNING + PID, then COMPLETE
8. click Income / Economy targets / Progression / Target ranking and confirm each launches once and reports completion
9. confirm clicking another direct diagnostic while one is running reports Busy rather than launching duplicate tracked work
10. confirm prepper V3 remains active and no GUI changes disturb production/prep state
```

Because the new `ui/*` support files are ordinary `.js` files outside `lib/`, the current `diagnostics/mem-audit.js` labels them as `script` even though they are imported modules. That audit classification is cosmetic.

## Planned refinement sequence after phase-1 validation

```text
1. Targets: show focused allocation as N hosts · Nt and improve prep progress visualization.
2. Overview: add compact global activity visibility for production / prep / spending.
3. Network: add used/max RAM plus PREP / PRODUCTION / FREE / DRAINING role information and useful sorting.
4. Economy: add explicit manual-goal progress visualization and stronger spend-lock reason.
5. Diagnostics: add stress evidence/status controls once stress BLOCKED behavior is improved.
6. Batch: add compact live H -> W1 -> G -> W2 progress and later requested/proven/effective concurrency.
7. Let adaptive prep raise prepared-target count above five and re-run stress through depth 6.
8. Improve stress BLOCKED behavior so it observes Port 18 readiness instead of relaunching a blocked runner every 10 seconds.
9. Persist/consume proven global stress depth as an evidence ceiling for production MULTI, never as a forced depth.
10. Keep watchdog termination deferred until batching/pipeline behavior is stable.
```

XP scoring remains a proxy rather than exact Formula-based hacking XP.
