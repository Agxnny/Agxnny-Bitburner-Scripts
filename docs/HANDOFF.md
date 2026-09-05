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

Usage now accepts an eighth positional argument:

```text
run diagnostics/multi-target-stress.js [profile] [maxDepth] [wavesPerDepth] [targetCount] [hackFraction] [stageGapMs] [prepWaitMinutes] [startDepth|resume]
```

Examples:

```text
# full validation from depth 2
run diagnostics/multi-target-stress.js mixed 6 2 12 0.10 200 10 2

# continue at durable provenDepth + 1
run diagnostics/multi-target-stress.js mixed 8 2 12 0.10 200 20 resume

# explicitly validate only depth 6 upward
run diagnostics/multi-target-stress.js mixed 8 2 12 0.10 200 20 6
```

When a child MULTI wave returns BLOCKED, the stress coordinator no longer blindly relaunches it every 10 seconds. It enters `WAITING_PREP`, reads fresh Port 18 prepper telemetry every 2 seconds, publishes `preparedCount` and `requiredPreparedCount`, and only retries the child once `preparedCount >= currentDepth`. It aborts if the controller leaves STANDBY and times out at the configured prep-wait limit. This substantially reduces noisy blocked-run churn.

Caveat: Port 18 `preparedCount` is the full eligible prepared universe, while a particular MONEY/BALANCED/XP ranking may still yield fewer usable candidates. Therefore a retry after `preparedCount >= depth` can still legitimately BLOCK again. If that occurs, V2 returns to prep-aware waiting rather than tight relaunching. A future decision module can use profile-specific candidate counts directly.

## Distributed target prepper V3 adaptive focus

```text
hacking/prepper.js
hacking/prepper-allocation.js
model: DISTRIBUTED_TARGET_PREPPER_V3_ADAPTIVE_FOCUS
state: Port 18
policy: ADAPTIVE_FOCUS_GROW_THEN_WEAKEN
etaModel: FULL_READY_GROW_PLUS_WEAKEN_V1
```

The prepper scans the full eligible target universe and reserves a bounded slice of remote RAM. Allocation is adaptive: it may spread prep or concentrate multiple reserved hosts on one target. Defaults are 12.5% remote RAM reserve, min 64 GB, max 1024 GB, money ready >=99.5%, security ready <= min+0.05. Prep is money-first, then security cleanup. One target may receive multiple same-wave jobs across different reserved hosts.

Port 18 publishes `preparedCount`, `needsPrepCount`, `activeJobs`, `activeTargetCount`, `prepTargets`, reserved hosts/RAM, and adaptive focus data. `prepTargets[].etaMs` estimates full ready time, not just current job completion.

## Modular dashboard architecture

```text
ui/
  dashboard.js              small shell + async loop
  state.js                  cached snapshot / version bridge
  actions.js                plain-JS request model + async action processor
  styles.js                 shared styles
  components/
    format.js
    layout.js
  views/
    overview.js
    targets.js
    economy.js
    batch.js
    network.js
    diagnostics.js
```

React callbacks must remain Netscript-free. The dashboard uses one mounted React tree; the async Netscript loop owns process/port/file operations.

### Current UI refinement state

- global typography enlarged for at-a-glance use
- Diagnostics has health verdict, real test/diagnostic buttons, direct diagnostic PID/status tracking, and state-age severity
- Overview duplicate BATCH/PIPELINE/MULTI/Prep+hold launch buttons removed; Standby/HGW/Resume remain
- Batch currently exposes manual MULTI controls; AUTOMULTI will become the primary path after backend decision/controller logic is ready
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

Current production screenshot showed healthy controller-owned MULTI depth 3 across `phantasy`, `silver-helix`, and `omega-net`, with the prior omega-net completion at 100% money, +0.000 security, correct order, 195 ms minimum spacing, and 15 ms max drift. Do not start stress while controller MULTI is active.

When ready to validate V2:

```text
1. run gitpull.js
2. put controller fully in STANDBY and allow active MULTI wave to drain
3. run diagnostics/multi-target-stress.js mixed 6 2 12 0.10 200 20 2
4. if depth 6 is prep-limited, confirm Port 20 reports WAITING_PREP and preparedCount/requiredPreparedCount instead of repeated child launches
5. after a completed run: cat /data/multi-stress-evidence.txt
6. then test resume with: run diagnostics/multi-target-stress.js mixed 8 2 12 0.10 200 20 resume
7. confirm resume begins at provenDepth + 1
```

## AUTOMULTI implementation sequence

```text
DONE 1. persistent stress evidence helper + stress-run recording
DONE 2. prep-aware WAITING_PREP + explicit startDepth + durable-evidence resume
NEXT 3. pure AUTOMULTI decision module: prepared targets + production RAM + target value + durable stress ceiling + timing/history evidence
4. controller AUTO state machine: ASSESS -> VALIDATE if needed -> RUN -> OBSERVE -> ADAPT
5. Batch-tab AUTOMULTI button/status; keep manual controls as Advanced/Manual
6. expose Possible / Proven / AUTO effective concurrency
7. runtime validation and conservative fallback/demotion behavior
8. later keep global distinct-target depth separate from per-target overlap depth
```

AUTOMULTI must never treat more RAM or more prepared targets as permission to exceed proven stress evidence. It may request controlled validation for a higher depth, but production remains at the last trusted ceiling until that evidence exists. XP scoring remains a proxy rather than exact Formula-based hacking XP.
