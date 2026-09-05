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

## Validated global concurrency evidence

Historical real distinct-target stress validation completed cleanly through global depth 5:

```text
depth 2: 2/2 clean
depth 3: 2/2 clean
depth 4: 2/2 clean
depth 5: 2/2 clean
worst max drift: 129 ms
worst minimum spacing: 151 ms
```

Depth 6 was prep-limited rather than failed. Historical results predate durable stress evidence and are intentionally not silently seeded.

Global distinct-target proof and same-target overlap proof are separate dimensions.

## Durable global stress evidence

```text
lib/multi-stress-evidence.js
/data/multi-stress-evidence.txt
model: MULTI_STRESS_EVIDENCE_V1
```

Stress tester:

```text
diagnostics/multi-target-stress.js
model: MULTI_TARGET_STRESS_V2_PREP_AWARE_RESUME
run diagnostics/multi-target-stress.js [profile] [maxDepth] [wavesPerDepth] [targetCount] [hackFraction] [stageGapMs] [prepWaitMinutes] [startDepth|resume]
```

BLOCKED waves enter WAITING_PREP and observe fresh Port 18 readiness instead of relaunching blindly.

## AUTOMULTI decision/controller

Pure decision engine:

```text
lib/automulti-decision.js
model: AUTOMULTI_DECISION_V1
```

It separates Possible / Proven / Effective global distinct-target depth. Shared live selection is in:

```text
lib/multi-target-ranking.js
lib/automulti-live.js
```

Candidate-source policy is literally shared by advisor and real runner:

```text
XP             planner baseline rankings
MONEY/BALANCED economic rankings when >=2 rows
               planner fallback otherwise
```

Read-only advisor:

```text
diagnostics/automulti-advisor.js
```

Supervisor:

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

It sends normal Port 13 requests; main controller and finite MULTI remain the execution plane.

## Same-target overlap rollout

### Durable overlap evidence

```text
lib/multi-overlap-evidence.js
/data/multi-overlap-evidence.txt
model: MULTI_TARGET_OVERLAP_EVIDENCE_V1
```

Evidence is per target and independent from global stress proof. It records validation waves, clean/fail counts, consecutive clean waves, max drift, min spacing, latest result, and proven depth. Two consecutive clean dedicated depth-2 validation waves promote historical `provenDepth` to 2. A later failed dedicated validation marks `latestHealthy=false`, so active production policy demotes that target back to depth 1 even though historical proof remains recorded.

### Shared overlap policy V2

```text
lib/multi-overlap-policy.js
model: MULTI_TARGET_OVERLAP_POLICY_V2_SEPARATE_PROOF
```

The policy now separates two concepts:

```text
candidateDepth   what is worth validating/simulating
provenDepth      what real MULTI production may actually use
```

Rules:

```text
no useful history / latest pipeline unhealthy -> candidate 1, proven 1
>=2 consecutive clean real pipeline samples   -> candidate 2, proven 1
>=2 consecutive clean dedicated overlap waves -> candidate 2, proven 2
latest dedicated validation failed            -> production proven 1 until revalidated
```

Port 19's historical 4/8 recommendation ladder is never treated as real MULTI overlap proof.

### Overlap advisor

```text
diagnostics/multi-overlap-advisor.js
run diagnostics/multi-overlap-advisor.js [money|balanced|xp] [hackFraction] [targetCount]
```

Output now distinguishes:

```text
VALIDATE2  pipeline evidence says a dedicated depth-2 test is justified
PROVEN2    dedicated overlap evidence permits real production depth 2
DEPTH1     not yet qualified
PREP       not currently prepared
```

### Persistent simulator V4

```text
hacking/multi-target-sim.js
model: MULTI_TARGET_ADMISSION_SIM_V4_SHARED_OVERLAP_POLICY
```

The simulator now uses both `multiTargetRankings()` and `targetOverlapPolicy()`. It no longer reads Port 19 `recommendedDepth` directly and no longer has its own ranking helper.

Simulation deliberately uses `candidateDepth` so we can estimate the capacity benefit of depth 2 before granting production permission. Its state also publishes `productionProvenDepth` separately. Future real MULTI must use `provenDepth`, never the simulator candidate cap.

### Dedicated real depth-2 validator

```text
diagnostics/multi-overlap-validate.js
run diagnostics/multi-overlap-validate.js [target|auto] [waves] [hackFraction] [stageGapMs]
```

Defaults:

```text
target auto
waves 2
hackFraction 0.10
stageGapMs 200
```

Safety behavior:

```text
- home only through normal deployment assumptions; controller must be fully STANDBY
- blocks if pipeline, real MULTI, AUTOMULTI supervisor, or serialized batch work is active
- target must already be prepared and pipeline-qualified for depth-2 validation
- exactly one validator owns Port 14 while running
- plans two same-target HWGW batches in one shared host/time calendar
- batch B first landing is offset by 4 * stageGap from batch A
- expected landing stream is A:H,W1,G,W2 then B:H,W1,G,W2
- validates every timing event, within-batch order, cross-batch order, min spacing, drift, final money, final security
- records every real validation wave to durable per-target overlap evidence
- stops immediately on the first failed wave
```

The initial validator intentionally uses non-crossing adjacent landing streams rather than a tighter A-H/B-H/A-W1/... interleave. Runtime actions still overlap heavily because hack/grow/weaken durations are much longer than the 800 ms landing-stream offset at the default 200 ms gap.

## Current overlap evidence opportunity

Latest user runtime output before this pass showed 32,588 GB production RAM across 68 hosts, 5/12 prepared targets, and all five prepared targets pipeline-qualified for depth-2 validation:

```text
phantasy          3 consecutive clean pipeline batches
silver-helix      4
omega-net         7
sigma-cosmetics   5
joesguns          8
```

These are validation candidates only until the new dedicated validator records clean overlap proof.

## Distributed prepper

```text
hacking/prepper.js
hacking/prepper-allocation.js
model: DISTRIBUTED_TARGET_PREPPER_V3_ADAPTIVE_FOCUS
Port 18
```

Adaptive money-first prep, 12.5% remote RAM reserve by default, bounded 64-1024 GB, ready >=99.5% money and <=min+0.05 security.

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

Single mounted React tree; async Netscript bridge. AUTOMULTI GUI work remains after backend validation.

## Multi-target runtime contracts

```text
hacking/multi-target-runner.js
model: MULTI_TARGET_EXECUTOR_V2_CONFIGURABLE_FINITE
```

Current real MULTI remains finite, global configurable 2-12, and per-target depth 1. Do not remove the uniqueness guard yet. Controller repeats finite waves and drains safely on transitions.

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

Overlap evidence is file-based rather than another runtime port.

## Immediate validation sequence

Pull first:

```text
run gitpull.js
```

Then confirm the read-only policy view:

```text
run diagnostics/multi-overlap-advisor.js money 0.10 12
```

The five previously-qualified targets should now show `VALIDATE2` rather than `PROVEN2` because dedicated evidence starts empty.

For the first real overlap validation, stop AUTOMULTI if running, put the main controller fully into STANDBY, and let all real MULTI/batch/pipeline work drain. Then run one of:

```text
# automatically pick the highest-ranked prepared target that still needs proof
run diagnostics/multi-overlap-validate.js auto 2 0.10 200

# or explicitly start with the strongest-history target
run diagnostics/multi-overlap-validate.js joesguns 2 0.10 200
```

After a clean two-wave result:

```text
cat /data/multi-overlap-evidence.txt
run diagnostics/multi-overlap-advisor.js money 0.10 12
```

That target should become `PROVEN2`. Send the validator output before real MULTI is modified to consume depth 2.

The persistent simulator is planning-only and can be run separately to inspect candidate-vs-proven capacity, but do not run it at the same time as real MULTI if you want Port 17 to remain an unambiguous production-state view.

## Priority sequence

```text
DONE global stress evidence + prep-aware resume
DONE pure AUTOMULTI decision + shared ranking/live adapter
DONE AUTOMULTI supervisor state machine
DONE runner ranking cleanup
DONE overlap candidate policy + read-only advisor
DONE simulator reconciled to shared overlap/ranking policy
DONE dedicated same-target depth-2 validator + durable overlap evidence
NEXT runtime validate depth 2 on multiple targets
NEXT extend real MULTI planner to use per-target dedicated provenDepth (initial max 2)
NEXT expose global in-flight cap separately from distinct-target count
NEXT feed overlap capacity into AUTOMULTI decision/controller and GUI
LATER test tighter target-local cadence only after non-crossing depth 2 is stable
LATER failed-global-depth validation cooldown/lockout, UI refinements, watchdog
```

AUTOMULTI must never treat more RAM, more prepared targets, high Port 19 sample count, or simulator candidate depth as permission to exceed the separately proven safety ceiling for the relevant concurrency dimension. XP scoring remains a proxy rather than exact Formula-based hacking XP.
