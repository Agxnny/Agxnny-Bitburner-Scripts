# Batch Scheduler Design

## Current status

`hacking/batch-scheduler.js` is a **dry-run planner only**. It does not launch workers and does not replace the current serialized `hacking/batch-runner.js` path.

The purpose of this stage is to design and validate a global pipeline calendar before any overlapping batches are allowed to execute.

## Two independent timing controls

The scheduler treats timing as two separate knobs:

1. **Stage gap** — spacing inside one HWGW batch:

```text
H → W1 → G → W2
```

2. **Batch interval** — spacing between the H landing of batch N and the H landing of batch N+1.

These must be tuned independently. Safe H/W1/G/W2 spacing inside one batch does not automatically imply safe spacing between adjacent batches.

## Dry-run command

```text
run hacking/batch-scheduler.js <target> [hackFraction] [stageGapMs]
```

Example:

```text
run hacking/batch-scheduler.js phantasy 0.10 200
```

The script publishes its latest analysis to **Port 16**.

## Current model

The planner calculates:

- H/W1/G/W2 thread counts using the same core analysis rules as the single-batch runner;
- action durations for H/G/W;
- per-stage RAM footprint;
- a global landing calendar;
- a conservative tuned stage gap;
- a conservative tuned batch interval;
- time-aware aggregate RAM occupancy for depths 1 through 12;
- the largest simulated depth that fits current aggregate remote usable RAM.

The simulation models each stage as occupying RAM from its planned start until its planned landing. It then sweeps all start/finish events to estimate peak concurrent RAM.

## Timing tuning

If Port 15 contains a completed batch for the same target, the planner uses the retained timing measurements as a provisional safety signal:

```text
maxAbsLandingErrorMs
max allocationSpreadMs across stages
minimumSpacingMs
orderCorrect
```

The current tuning rule is intentionally conservative:

```text
stageGap >= requested gap
stageGap >= observed drift + observed spread + 25 ms
```

The batch interval is at least four stage gaps and also leaves room for observed drift/spread.

Only one retained completed batch is currently available, so this is **telemetry-assisted**, not statistically adaptive. Aggressive automatic reduction of gaps must wait for a rolling timing history.

## Important limitations

The current dry-run planner does **not**:

- launch any H/G/W workers;
- perform host-by-host future reservation;
- consume Port 14 timing events;
- manage multiple live batch IDs;
- change the controller review barrier;
- recover from a failed/partial pipelined batch;
- automatically reduce the configured 200 ms single-batch gap.

The RAM model is aggregate and time-aware. The future executable scheduler must add host-specific reservations because a globally sufficient amount of RAM can still fail when fragmented across hosts.

## Required milestones before live pipelining

1. Collect repeated single-batch landing telemetry and establish realistic drift/spread bounds.
2. Add rolling timing history rather than tuning from only Port 15.
3. Validate the dry-run scheduler's RAM/calendar predictions against observed single-batch execution.
4. Add host-by-host time-window reservation.
5. Replace Port 14 clearing with one shared multi-batch event consumer routed by `batchId`.
6. Introduce a maximum live depth of 2 for the first executable test.
7. Stop new admissions immediately on bad landing order, missing timing events, or recovery error.
8. Let safe in-flight work drain, force target prep/review, then restart the pipeline.
9. Only raise pipeline depth after repeated depth-2 validation.

## Intended future landing calendar

With a 200 ms stage gap and an 800 ms batch interval, the nominal landing train is:

```text
H1  W1-1  G1  W2-1  H2  W1-2  G2  W2-2  H3 ...
|----200----200----200----200----200----200----200----|
```

The exact batch interval should ultimately be selected from measured timing margin and RAM availability, not assumed to remain 800 ms.
