# Testing and Validation Guide

Validate incrementally. Maximum live pipeline depth remains 2.

## After pulling

```text
run gitpull.js
run startup.js
run diagnostics/mem-audit.js
```

### Startup acceptance

After `startup.js`, the GUI/controller should settle in:

```text
execution mode: STANDBY
controller active workers: 0
serialized batch running: false
pipeline running: false
```

Planner/economy/UI/controller services remain online. STANDBY means no target-side execution, not zero control-plane processes.

## Execution controls

Quick Controls should expose:

```text
Standby | HGW | Batch | Pipeline | Prep + hold | Resume
```

Mode changes must wait for safe boundaries. React clicks/tabs must remain responsive.

## Controller-managed PIPELINE test

Use the currently validated full-money target path for initial integrated testing.

1. Start in STANDBY.
2. Select/confirm the intended target.
3. Click **Pipeline**.
4. Observe controller prep if required.
5. Wait for Port 16 to report the real continuous executor.

Expected Port 1 concepts:

```text
executionMode.mode == PIPELINE
executionMode.pipelineRunning == true
executionMode.pipelineMaxDepth == 2
```

Expected Port 16 concepts:

```text
model == PIPELINE_EXECUTOR_DEPTH2_V2
execution == true
continuous == true
controllerManaged == true
maxDepth == 2
status == RUNNING
```

The Batch tab should show cadence, in-flight count, total completed batches, recent events, and safety state.

### Healthy integrated wave

Every completion should satisfy:

```text
landing.orderCorrect == true
landing.missingJobs == 0
final.moneyPercent >= 0.995
final.securityDelta <= 0.05
```

Continue recording minimum spacing, max absolute drift, allocation spread, and recovery. Keep the 200 ms stage gap unchanged.

## Pipeline mode-switch drain test

While a depth-2 wave is active, click **Standby**.

Expected behavior:

```text
controller pending mode -> STANDBY
pipeline status -> DRAINING_FOR_MODE_SWITCH
no later wave admitted
current admitted H/W1/G/W2 work finishes
pipeline status -> DRAINED_FOR_MODE_SWITCH
controller mode -> STANDBY
```

No admitted batch may be abandoned halfway through its four stages.

Repeat PIPELINE → HGW and PIPELINE → BATCH after the STANDBY drain test succeeds.

## Pipeline safety-stop test expectations

A launch failure, bad landing order, missing event, money below 99.5%, excessive security, or bad post-wave baseline must stop later admissions.

Expected controller behavior after executor exit:

```text
executionMode.pipelineSafetyStopped == true
controller starts recovery/prep if required
controller reaches PREPARED HOLD
pipeline does not silently restart
```

After inspection, **Resume** clears the reviewed pipeline stop and allows PIPELINE mode to start again.

## Manual finite regression test

The previous finite harness remains available:

```text
run hacking/pipeline-runner.js phantasy 0.10 200 2
```

Use it only while the controller is parked at PREPARED HOLD. It must still never exceed depth 2.

## Serialized regression

BATCH mode must still produce correct H → W1 → G → W2 order, zero missing timing events, and expected recovery. BATCH and PIPELINE must not run concurrently.

## Active worker observability

Normal/prep workers should appear only while active. `LATE` remains diagnostic and must not terminate workers automatically.

## Regression checklist

- startup settles in STANDBY with no target-side work;
- all six GUI tabs remain responsive;
- HGW works;
- serialized BATCH works;
- PIPELINE auto-preps and runs continuous depth-2 waves;
- PIPELINE never exceeds depth 2;
- PIPELINE mode changes drain safely;
- pipeline safety stop holds for review instead of silently resuming;
- Prep + hold and Resume work;
- manual target and money-goal controls still work;
- Port 15 shows latest serialized/pipeline completion;
- Port 16 shows planner/simulation/real executor state correctly;
- planned-vs-actual graph still renders;
- Port 14 timing events remain separate from Port 4 strategic hack telemetry;
- watchdog termination remains disabled.
