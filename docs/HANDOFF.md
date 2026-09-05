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

When a child wave returns BLOCKED, stress enters WAITING_PREP, watches fresh Port 18 every ~2 seconds, publishes prepared/required counts, and only retries once enough prepared targets exist. A profile can still have fewer usable top candidates than the full prepper count, so another legitimate BLOCKED may return to waiting.

## AUTOMULTI decision engine V1

Pure decision module:

```text
lib/automulti-decision.js
model: AUTOMULTI_DECISION_V1
```

This module has no Netscript calls. It consumes precomputed candidate scenarios and chooses a safe production configuration. It explicitly separates:

```text
Possible depth   prepared + conservative RAM-feasible distinct targets
Proven depth     durable stress proof, with conservative depth-2 fallback
Effective depth  min(Possible, Proven)
Validation depth next unproven level when Possible > Proven
```

The chosen config contains profile/objective, targetCount, globalDepth, hackPercent, and stageGapMs. Target scoring combines objective throughput/efficiency with a target-history safety factor. A latest unhealthy real history sample heavily penalizes that target; repeated clean history can slightly prefer it. Global production depth never exceeds proven stress evidence.

Current V1 RAM feasibility is intentionally conservative: it sums complete per-batch RAM requirements for selected distinct targets rather than assuming perfect stage-time reuse. This may underestimate Possible depth but must not over-admit. Later controller integration can use the shared host/time calendar for a tighter feasibility check.

Read-only live advisor:

```text
diagnostics/automulti-advisor.js
usage: run diagnostics/automulti-advisor.js [money|balanced|xp]
```

It reads planner rankings, actual production RAM after prep reservations, Port 19 batch history, and durable stress evidence. It evaluates hack percentages 5 / 7.5 / 10 / 12.5 / 15 / 20 at the currently validated 200 ms stage gap and prints the chosen config plus Possible / Proven / Effective / next validation depth. It never changes controller mode or launches workers.

The advisor currently uses planner baseline rankings for its candidate universe. Before controller AUTO is wired, reconcile this with the multi-runner profile/economic ranking helper so advisor and executor rank the same candidate set.

## Distributed target prepper V3 adaptive focus

```text
hacking/prepper.js
hacking/prepper-allocation.js
model: DISTRIBUTED_TARGET_PREPPER_V3_ADAPTIVE_FOCUS
state: Port 18
```

The prepper scans the full eligible target universe and reserves a bounded slice of remote RAM. Allocation is adaptive: it may spread prep or concentrate multiple reserved hosts on one target. Defaults are 12.5% remote RAM reserve, min 64 GB, max 1024 GB, money ready >=99.5%, security ready <= min+0.05. Prep is money-first, then security cleanup. One target may receive multiple same-wave jobs across different reserved hosts.

Port 18 publishes `preparedCount`, `needsPrepCount`, `activeJobs`, `activeTargetCount`, `prepTargets`, reserved hosts/RAM, and adaptive focus data. `prepTargets[].etaMs` estimates full ready time, not just current job completion.

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
- Batch currently exposes manual MULTI controls; AUTOMULTI will become the primary path after backend controller logic is ready
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

Current production MULTI may remain active because `diagnostics/automulti-advisor.js` is read-only. After pulling:

```text
1. run gitpull.js
2. while MULTI is still running, run diagnostics/automulti-advisor.js money
3. verify it prints Possible / Proven / Effective and does not alter the running controller
4. sanity-check chosen hack %, selected targets, usable RAM, and validation recommendation
5. optionally run balanced and xp advisor modes for comparison
6. do not run stress until controller is fully STANDBY
```

If durable stress evidence has not yet been recreated, V1 deliberately reports a conservative proven fallback of depth 2 even though historical manual evidence was higher. After controlled stress is rerun, the advisor should automatically consume the higher durable proof.

## AUTOMULTI implementation sequence

```text
DONE 1. persistent stress evidence helper + stress-run recording
DONE 2. prep-aware WAITING_PREP + explicit startDepth + durable-evidence resume
DONE 3. pure AUTOMULTI decision module + read-only live advisor
NEXT 4. reconcile shared profile/economic candidate ranking, then controller AUTO state machine: ASSESS -> VALIDATE if needed -> RUN -> OBSERVE -> ADAPT
5. Batch-tab AUTOMULTI button/status; keep manual controls as Advanced/Manual
6. expose Possible / Proven / AUTO effective concurrency
7. runtime validation and conservative fallback/demotion behavior
8. later keep global distinct-target depth separate from per-target overlap depth
```

AUTOMULTI must never treat more RAM or more prepared targets as permission to exceed proven stress evidence. It may request controlled validation for a higher depth, but production remains at the last trusted ceiling until that evidence exists. XP scoring remains a proxy rather than exact Formula-based hacking XP.
