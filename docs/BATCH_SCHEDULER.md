# Batch Scheduler Design

## Current Stage 5 layers

```text
batch-scheduler.js snapshot   → one-shot capacity/cadence analysis
batch-scheduler.js admission  → virtual depth-2 admission simulation
pipeline-runner.js            → real depth-2 executor
controller PIPELINE mode      → continuous managed real execution
```

All planner/simulation/executor state is published to Port 16.

## Timing controls

The system keeps these separate:

```text
stage gap      = H → W1 → G → W2 spacing inside one batch
batch interval = H(N) → H(N+1) spacing across batches
```

The 200 ms stage gap remains the requested baseline. Host-window RAM capacity may force a much larger sustainable batch interval.

## Real executor

`hacking/pipeline-runner.js` remains hard-capped at:

```text
MAX_DEPTH = 2
```

Finite test:

```text
run hacking/pipeline-runner.js phantasy 0.10 200 2
```

Controller mode runs the same executor with:

```text
continuous --quiet
```

In continuous mode, each depth-2 wave is planned from current target timing and current remote RAM. A later wave is admitted only after the current wave drains and safety checks remain healthy.

## Host-window reservation

Reservations are host-specific and cover the full live process lifetime, including the dispatch lead before the action start. Exact host/thread allocations are attached to each batch stage before a wave is admitted.

Stages are launched just in time rather than all at wave admission.

## Port 14 routing

One real pipeline coordinator owns Port 14 while PIPELINE is active. It routes `BATCH_STAGE_COMPLETE` events by `batchId` into the correct overlapping batch.

The serialized BATCH runner and PIPELINE executor remain mutually exclusive because the serialized runner still has its legacy queue-clear behavior.

## Controller integration

The controller now supports:

```text
STANDBY | HGW | BATCH | PIPELINE
```

PIPELINE mode prepares the target, waits for a settled idle control snapshot, then launches the continuous executor.

During a requested execution-mode change:

```text
stop admitting later waves
finish the already-admitted H/W1/G/W2 work
drain executor
apply new controller mode
```

A pipeline safety stop does not auto-resume. The controller starts recovery/prep as needed and holds the target for review; Resume clears the reviewed stop.

## Validated baseline

Two manual depth-2 runs on `phantasy` completed four overlapping batches total with:

```text
money 100.00%
security +0.000
order H → W1 → G → W2
cadence ~6262 ms under that RAM state
```

This supports controller integration at depth 2 only. It does not justify higher depth or a lower stage gap.

## Safety stop conditions

New admissions stop on:

- launch failure;
- incorrect H/W1/G/W2 landing order;
- missing timing events;
- final money below 99.5%;
- final security above +0.05;
- target outside prepared tolerance after a wave.

Healthy admitted work is allowed to drain. Merely late workers are not killed automatically.

## Remaining priorities

1. Validate startup in STANDBY.
2. Validate controller-managed PIPELINE auto-prep/start.
3. Validate PIPELINE → STANDBY safe drain during a live wave.
4. Repeat integrated depth-2 waves and collect timing/recovery data.
5. Add rolling timing history instead of relying on Port 15 alone.
6. Only then consider adaptive gap reduction or live depth > 2.
