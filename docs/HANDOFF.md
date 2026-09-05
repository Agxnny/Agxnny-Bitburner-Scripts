# Project Handoff Guide

GitHub `main` is the source of truth. Read this file first, then fetch current live files before editing. Target is Bitburner v3.x; live testing is v3.0.1.

## Engineering constraints

Prefer small modules with narrow responsibilities over monoliths. Soft targets: ordinary modules <=300 lines when practical, review/split around 400, >500 needs a reason; UI views/components ideally 100-250; individual functions usually <=40-60 lines. Split by responsibility, avoid circular imports, preserve Bitburner RAM awareness.

GUI rule: React callbacks stay Netscript-free. The async Netscript loop owns ports/files/process launches; React consumes cached plain-JS state and emits plain-JS requests.

## Current execution modes

```text
STANDBY   controller parked
HGW       sequential automation
BATCH     serialized HWGW
PIPELINE  continuous single-target depth-2 HWGW
MULTI     repeated finite multi-target waves
```

Startup defaults to STANDBY. Distributed background prep is independent of production mode.

## Validated concurrency evidence

Historical real distinct-target stress validation completed cleanly through global depth 5:

```text
depth 2: 2/2 clean
depth 3: 2/2 clean
depth 4: 2/2 clean
depth 5: 2/2 clean
worst max drift: 129 ms
worst minimum spacing: 151 ms
```

Depth 6 was prep-limited rather than failed. The historical result predates durable stress evidence and is intentionally not silently seeded.

Real same-target overlap evidence is a separate dimension. The single-target PIPELINE has real clean depth-2 history on some targets; real MULTI itself still hard-caps each target at depth 1 until the dedicated overlap rollout is validated.

## Durable global stress evidence

```text
lib/multi-stress-evidence.js
/data/multi-stress-evidence.txt
model: MULTI_STRESS_EVIDENCE_V1
```

Completed stress runs persist highest proven clean global distinct-target depth, attempted depth, clean waves, targets, drift/spacing extremes, last result, and real failed depth. BLOCKED/ABORTED do not reduce proof.

Stress tester:

```text
diagnostics/multi-target-stress.js
model: MULTI_TARGET_STRESS_V2_PREP_AWARE_RESUME
```

Usage:

```text
run diagnostics/multi-target-stress.js [profile] [maxDepth] [wavesPerDepth] [targetCount] [hackFraction] [stageGapMs] [prepWaitMinutes] [startDepth|resume]
```

BLOCKED waves enter WAITING_PREP and observe fresh Port 18 readiness instead of relaunching blindly.

## AUTOMULTI decision/controller

Pure decision engine:

```text
lib/automulti-decision.js
model: AUTOMULTI_DECISION_V1
```

It separates:

```text
Possible   prepared + conservative RAM-feasible global distinct-target depth
Proven     durable global stress proof, with conservative depth-2 fallback
Effective  min(Possible, Proven)
Validation next unproven global depth
```

Shared live path:

```text
lib/multi-target-ranking.js
lib/automulti-live.js
```

Candidate-source policy is now literally shared by advisor and real runner:

```text
XP             planner baseline rankings
MONEY/BALANCED economic rankings when >=2 rows
               planner fallback otherwise
```

The old local `sourceRankings()` helper has been removed from `hacking/multi-target-runner.js`. Do not reintroduce ranking-policy duplication.

Read-only advisor:

```text
diagnostics/automulti-advisor.js
run diagnostics/automulti-advisor.js [money|balanced|xp]
```

AUTOMULTI supervisor:

```text
hacking/automulti-controller.js
/data/automulti-controller-state.txt
model: AUTOMULTI_CONTROLLER_V1
run hacking/automulti-controller.js [money|balanced|xp] [validate|no-validate]
```

State flow:

```text
ASSESS -> RUN -> OBSERVE -> ADAPT
                    |
                    +-> VALIDATE_PENDING -> STANDBY/drain -> VALIDATING -> ASSESS
```

It sends normal Port 13 requests to the existing main controller; it does not own Port 14 or launch H/G/W directly. It respects MULTI safety stops and does not take over HGW/BATCH/PIPELINE.

## Same-target overlap foundation

New focused policy:

```text
lib/multi-overlap-policy.js
model: MULTI_TARGET_OVERLAP_POLICY_V1
```

This deliberately treats global distinct-target proof and same-target overlap proof as different safety dimensions.

Current real overlap policy:

```text
no usable real history / latest unhealthy -> depth 1
>=2 consecutive clean real pipeline samples -> eligible for depth 2
real MULTI promotion hard ceiling for now -> depth 2
```

Important: Port 19's older `recommendedDepth` ladder can report 4/8 after many clean samples, but that is not accepted as proof that real MULTI may safely overlap 4/8 batches on the same target. The new policy caps real overlap at 2 until dedicated overlap validation proves higher depths.

Read-only overlap advisor:

```text
diagnostics/multi-overlap-advisor.js
run diagnostics/multi-overlap-advisor.js [money|balanced|xp] [hackFraction] [targetCount]
```

It reports current shared ranking source, prepared targets, per-batch RAM, and which targets have enough real pipeline evidence to be depth-2 overlap candidates. It does not launch workers or alter controller mode.

The existing planning-only `hacking/multi-target-sim.js` already models repeated per-target admissions using Port 19 caps and a shared host/time calendar. Its historical cap logic is more permissive than the new real-overlap policy and should be reconciled next so simulation, diagnostics, and the future real executor use one explicit overlap policy.

### Safe overlap rollout plan

Do not simply remove the runner's `batches.some(target)` uniqueness guard. Same-target batches must be scheduled as one coordinated landing stream so H/W/G/W from adjacent batches cannot cross or corrupt money/security assumptions.

Next sequence:

```text
1. wire multi-target-sim.js to lib/multi-overlap-policy.js and shared ranking helper
2. add a dedicated finite same-target overlap validator (start at depth 2)
3. persist same-target overlap evidence separately from global distinct-target evidence
4. extend the real MULTI planner to admit repeated target batches only up to per-target proven depth
5. maintain one global host/time calendar and global landing-gap guard
6. add target-local landing cadence so adjacent batches preserve H->W1->G->W2 ordering
7. expose global distinct depth and per-target overlap depth separately to AUTOMULTI
8. only then let AUTOMULTI exploit repeated high-value targets for throughput
```

The initial production goal is depth 2 on independently proven targets, not aggressive 4/8 overlap.

## Distributed prepper

```text
hacking/prepper.js
hacking/prepper-allocation.js
model: DISTRIBUTED_TARGET_PREPPER_V3_ADAPTIVE_FOCUS
Port 18
```

Adaptive money-first prep, 12.5% remote RAM reserve by default, bounded 64-1024 GB, ready >=99.5% money and <=min+0.05 security. Multiple reserved hosts may work one target in the same prep wave.

## Dashboard architecture

```text
ui/dashboard.js
ui/state.js
ui/actions.js
ui/styles.js
ui/components/format.js
ui/components/layout.js
ui/views/{overview,targets,economy,batch,network,diagnostics}.js
```

Single mounted React tree; async Netscript bridge. Batch currently has manual MULTI controls. AUTOMULTI button/status still follows backend runtime validation.

## Multi-target runtime contracts

```text
hacking/multi-target-runner.js
model: MULTI_TARGET_EXECUTOR_V2_CONFIGURABLE_FINITE
```

Current real MULTI remains finite, global configurable 2-12, and per-target depth 1. Controller repeats finite waves and drains safely on transitions.

Ports:

```text
12 serialized batch
14 worker timing queue; exactly one real coordinator owns it
15 latest completed batch
16 single-target pipeline
17 multi-target scheduler/executor
18 adaptive prepper
19 rolling per-target batch history
20 global distinct-target stress test
```

## Immediate validation

After pulling this pass:

```text
1. run gitpull.js
2. rerun: run diagnostics/automulti-advisor.js money
3. run: run diagnostics/multi-overlap-advisor.js money 0.10 12
4. send the overlap-advisor output back for review
5. real MULTI behavior should otherwise remain unchanged: per-target depth is still 1
```

The overlap advisor is safe to run while production MULTI is active because it is read-only.

For AUTOMULTI supervisor validation, continue to test `no-validate` before autonomous validation. Do not run two AUTOMULTI coordinators simultaneously.

## Priority sequence

```text
DONE global stress evidence + prep-aware resume
DONE pure AUTOMULTI decision + shared ranking/live adapter
DONE AUTOMULTI supervisor state machine
DONE runner ranking cleanup
DONE conservative real-overlap policy + read-only overlap advisor
NEXT reconcile persistent simulator with shared overlap policy
NEXT build dedicated same-target finite overlap validator + durable overlap evidence
NEXT extend real MULTI scheduler to proven per-target depth 2
THEN feed overlap capacity into AUTOMULTI and GUI
LATER failed-global-depth validation cooldown/lockout, UI refinements, watchdog
```

AUTOMULTI must never treat more RAM, more prepared targets, or a high Port 19 sample count as permission to exceed the separately proven safety ceiling for the relevant concurrency dimension. XP scoring remains a proxy rather than exact Formula-based hacking XP.
