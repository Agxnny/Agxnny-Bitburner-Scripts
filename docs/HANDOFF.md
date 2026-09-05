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

Historical real stress validation completed cleanly through distinct-target depth 5:

```text
depth 2: 2/2 clean
depth 3: 2/2 clean
depth 4: 2/2 clean
depth 5: 2/2 clean
worst max drift: 129 ms
worst minimum spacing: 151 ms
```

Depth 6 was prep-limited, not failed. Per-target real MULTI overlap remains hard-capped at 1. Port 19 same-target history and global distinct-target stress evidence are separate safety signals.

## AUTOMULTI / stress evidence foundation

Durable evidence:

```text
lib/multi-stress-evidence.js
data file: /data/multi-stress-evidence.txt
model: MULTI_STRESS_EVIDENCE_V1
```

Completed stress runs persist highest proven clean depth, highest attempted depth, accumulated clean waves, unique targets, drift/spacing extremes, last status/reason, and real FAILED/SAFETY_STOP depth. BLOCKED/ABORTED runs never reduce already-proven depth. Historical depth-5 evidence predates this file and is intentionally not silently seeded; controlled tests should recreate machine-readable proof.

### Stress tester V2: prep-aware + resumable

```text
diagnostics/multi-target-stress.js
model: MULTI_TARGET_STRESS_V2_PREP_AWARE_RESUME
Port: 20 live state
```

Usage accepts an eighth positional argument `startDepth|resume`.

```text
run diagnostics/multi-target-stress.js mixed 6 2 12 0.10 200 10 2
run diagnostics/multi-target-stress.js mixed 8 2 12 0.10 200 20 resume
run diagnostics/multi-target-stress.js mixed 8 2 12 0.10 200 20 6
```

When a child wave returns BLOCKED, stress enters WAITING_PREP, watches fresh Port 18 every ~2 seconds, publishes prepared/required counts, and only retries once enough prepared targets exist.

## AUTOMULTI decision engine V1

Pure decision module:

```text
lib/automulti-decision.js
model: AUTOMULTI_DECISION_V1
```

It explicitly separates:

```text
Possible depth   prepared + conservative RAM-feasible distinct targets
Proven depth     durable stress proof, with conservative depth-2 fallback
Effective depth  min(Possible, Proven)
Validation depth next unproven level when Possible > Proven
```

The chosen config contains profile/objective, targetCount, globalDepth, hackPercent, and stageGapMs. Target scoring uses throughput/efficiency plus Port 19 history safety weighting. Global production depth never exceeds proven stress evidence.

Current RAM feasibility intentionally sums complete per-batch RAM requirements rather than assuming perfect stage-time reuse, so Possible depth is conservative.

### Shared live candidate path

```text
lib/multi-target-ranking.js
lib/automulti-live.js
```

`multi-target-ranking.js` centralizes the intended candidate-source policy:

```text
XP             planner baseline ranking
MONEY/BALANCED economic ranking when >=2 rows exist
               otherwise planner fallback
```

`automulti-live.js` is now the single live adapter for AUTOMULTI. It reads planner/economic state, production RAM after prep reservations, Port 19 target history, durable stress evidence, and builds the hack-percent scenarios consumed by the pure decision engine.

`diagnostics/automulti-advisor.js` now uses this live adapter and prints the ranking source. This matches the existing real MULTI runner candidate-source behavior. The runner still contains its tiny legacy `sourceRankings()` helper with the same policy; remove that duplicate when the runner is next safely rewritten so there is one literal implementation as well as behavioral parity.

### AUTOMULTI supervisory coordinator V1

```text
hacking/automulti-controller.js
state file: /data/automulti-controller-state.txt
model: AUTOMULTI_CONTROLLER_V1
usage: run hacking/automulti-controller.js [money|balanced|xp] [validate|no-validate]
```

This is a focused supervisor rather than more logic inside the already-large main controller. The normal `hacking/controller.js` and finite `multi-target-runner.js` remain the execution plane; AUTOMULTI only sends normal Port 13 controller requests.

State flow:

```text
ASSESS -> RUN -> OBSERVE -> ADAPT
                    |
                    +-> VALIDATE_PENDING -> STANDBY/drain -> VALIDATING -> ASSESS
```

Behavior:

```text
- reassesses live candidates/RAM/evidence every ~5 seconds
- starts MULTI from STANDBY using the safe Effective configuration
- while MULTI runs, config changes are queued for subsequent finite waves
- observes completed real MULTI runIds and counts clean AUTO waves
- after 3 clean AUTO waves, if Possible > Proven and validation is enabled:
    request STANDBY
    allow the current finite wave to drain naturally
    launch the existing stress tester only at the next validation depth
    use 2 validation waves, mixed profile, 10% hack, 200 ms gap, 20 minute prep wait
    after stress exits, reassess durable evidence and resume production
- a MULTI safety stop is respected; AUTOMULTI does not auto-clear it
- if another execution mode (HGW/BATCH/PIPELINE) owns the controller, AUTOMULTI reports BLOCKED and does not take it over
```

AUTOMULTI validation therefore never overlaps production MULTI. Validation temporarily parks production at a safe boundary and reuses the existing evidence system.

Known V1 follow-up: if a validation depth records a real FAILED/SAFETY_STOP, add an evidence-aware retry cooldown/lockout so AUTOMULTI does not repeatedly re-attempt the same failed depth after another clean-wave interval.

## Distributed target prepper V3 adaptive focus

```text
hacking/prepper.js
hacking/prepper-allocation.js
model: DISTRIBUTED_TARGET_PREPPER_V3_ADAPTIVE_FOCUS
state: Port 18
```

The prepper scans the full eligible target universe and reserves a bounded slice of remote RAM. Allocation is adaptive. Defaults are 12.5% remote RAM reserve, min 64 GB, max 1024 GB, money ready >=99.5%, security ready <= min+0.05. Prep is money-first, then security cleanup. One target may receive multiple same-wave jobs across different reserved hosts.

## Modular dashboard architecture

```text
ui/
  dashboard.js
  state.js
  actions.js
  styles.js
  components/format.js
  components/layout.js
  views/overview.js
  views/targets.js
  views/economy.js
  views/batch.js
  views/network.js
  views/diagnostics.js
```

React callbacks must remain Netscript-free. The dashboard uses one mounted React tree; the async Netscript loop owns process/port/file operations.

### Current UI refinement state

- global typography enlarged for at-a-glance use
- Diagnostics has health verdict, real test/diagnostic buttons, direct diagnostic PID/status tracking, and state-age severity
- Overview duplicate BATCH/PIPELINE/MULTI/Prep+hold launch buttons removed; Standby/HGW/Resume remain
- Batch currently exposes manual MULTI controls; AUTOMULTI button/status is next after coordinator runtime validation
- Targets still needs focused allocation display `N hosts · Nt`

## Multi-target runner/controller

```text
hacking/multi-target-runner.js
model: MULTI_TARGET_EXECUTOR_V2_CONFIGURABLE_FINITE
```

Controller MULTI repeats finite waves automatically. COMPLETE re-evaluates and relaunches; BLOCKED retries; SAFETY_STOP stops admissions until Resume; mode changes wait for active wave drain. Per-target overlap remains 1.

## Runtime state ports

```text
12 serialized batch
14 worker timing event queue; exactly one real coordinator owns it
15 latest completed batch
16 single-target pipeline
17 multi-target scheduler/executor
18 adaptive prepper
19 rolling per-target history
20 progressive global stress test
```

## Immediate validation sequence

The previous read-only advisor run showed:

```text
Possible 5 · Proven 2 · Effective 2
4196 GB usable / 59 production hosts
MONEY chose 20% hack
validation candidate depth 3
```

After pulling this pass:

```text
1. run gitpull.js
2. rerun diagnostics/automulti-advisor.js money
3. confirm output now includes ranking ECONOMIC (or PLANNER_FALLBACK if economic state is unavailable)
4. before live AUTOMULTI testing, put the main controller in STANDBY and let any existing MULTI wave drain
5. first conservative supervisor test:
   run hacking/automulti-controller.js money no-validate
6. confirm it transitions the main controller into MULTI at Effective depth and adapts without exceeding Proven
7. inspect: cat /data/automulti-controller-state.txt
8. only after the no-validate path is clean, test automatic validation with:
   run hacking/automulti-controller.js money validate
9. confirm it waits for 3 clean observed AUTO waves, requests STANDBY, drains, then launches only the next validation depth
```

Do not run two AUTOMULTI coordinators simultaneously.

## AUTOMULTI implementation sequence

```text
DONE 1. persistent stress evidence helper + stress-run recording
DONE 2. prep-aware WAITING_PREP + explicit startDepth + durable-evidence resume
DONE 3. pure AUTOMULTI decision module + shared live adapter + read-only advisor
DONE 4. supervisory AUTO state machine with controlled next-depth validation
NEXT 5. runtime validate no-validate supervisor path, then validate path
6. Batch-tab AUTOMULTI button/status; keep manual controls as Advanced/Manual
7. expose Possible / Proven / AUTO effective concurrency in GUI
8. add failed-depth validation cooldown/lockout
9. remove the runner's now-redundant local sourceRankings helper
10. later keep global distinct-target depth separate from per-target overlap depth
```

AUTOMULTI must never treat more RAM or more prepared targets as permission to exceed proven stress evidence. XP scoring remains a proxy rather than exact Formula-based hacking XP.
