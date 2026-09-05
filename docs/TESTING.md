# Testing and Validation Guide

Validate incrementally. Maximum live single-target pipeline depth remains 2; multi-target work is currently dry-run only.

## After pulling

```text
run gitpull.js
run startup.js
run diagnostics/mem-audit.js
```

Startup should settle in STANDBY with zero target-side workers/coordinators while planner/economy/UI/controller remain online.

## Controller-managed PIPELINE

Select a validated full-money target and click Pipeline. Port 16 should report `PIPELINE_EXECUTOR_DEPTH2_V2`, `continuous: true`, `controllerManaged: true`, and `maxDepth: 2`.

Healthy completions require correct H → W1 → G → W2 order, zero missing events, money >=99.5%, and security <=+0.05. Keep the 200 ms stage gap unchanged.

### Safe drain

While a wave is active, switch to Standby. The executor should stop later wave admission, drain the current admitted work, publish `DRAINED_FOR_MODE_SWITCH`, then allow the controller to enter STANDBY.

## Multi-target allocator dry-run

Run all three profiles after pulling:

```text
run hacking/multi-target-scheduler.js money 4 0.10 200 64
run hacking/multi-target-scheduler.js balanced 4 0.10 200 64
run hacking/multi-target-scheduler.js xp 4 0.10 200 64
```

Acceptance checks:

- the script explicitly reports `workers launched: NO`;
- no H/G/W PID appears as a result of the run;
- Port 17 model is `MULTI_TARGET_ALLOCATOR_DRY_RUN_V1`;
- at least two eligible targets are considered when available;
- `assignedBatches` is not forcibly equal across targets;
- the highest-value MONEY target may receive greater depth;
- secondary viable targets should normally receive some allocations when capacity permits because of the fairness penalty;
- BALANCED should shift allocation relative to MONEY when XP-proxy rankings differ;
- XP output is labelled as a proxy, not exact XP;
- total reservations never exceed a host's usable RAM in overlapping time windows;
- virtual batches from different targets obey the global landing-spacing floor;
- Port 17 updates must not disturb live Port 16 single-target pipeline state.

Useful output to capture for tuning:

```text
profile
target / assigned depth / allocation share
base score
$/RAM-second
XPproxy/RAM-second
prepared vs needs prep
remote RAM / host count
admitted virtual batch count
```

If one target receives 100% of allocations while several others have reasonable scores and reservations, inspect the fairness penalty. If allocation is too uniform despite a large value gap, reduce fairness pressure.

## Manual finite pipeline regression

```text
run hacking/pipeline-runner.js phantasy 0.10 200 2
```

Use only while the controller is parked at PREPARED HOLD. It must never exceed depth 2.

## Serialized regression

BATCH mode must still produce correct H → W1 → G → W2 order, zero missing timing events, and expected recovery. BATCH and PIPELINE must not run concurrently.

## Regression checklist

- startup settles in STANDBY with no target-side work;
- all six GUI tabs remain responsive;
- HGW works;
- serialized BATCH works;
- PIPELINE auto-preps and runs continuous depth-2 waves;
- PIPELINE mode changes drain safely;
- pipeline safety stop holds for review;
- Prep + hold and Resume work;
- manual target and money-goal controls still work;
- Port 15 shows latest serialized/pipeline completion;
- Port 16 shows single-target pipeline state;
- Port 17 shows multi-target dry-run allocation state;
- multi-target planner launches no workers;
- Port 14 timing remains separate from Port 4 strategic hack telemetry;
- watchdog termination remains disabled.
