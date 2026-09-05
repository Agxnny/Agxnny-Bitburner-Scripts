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

## Current model — V2 host windows

The planner now calculates:

- H/W1/G/W2 thread counts using the same core analysis rules as the single-batch runner;
- action durations for H/G/W;
- per-stage RAM footprint;
- a global landing calendar;
- a conservative tuned stage gap;
- an initial requested batch interval based on timing safety;
- **host-by-host RAM reservations over each stage execution window**;
- maximum tested burst depth before a host reservation fails;
- a separate **sustainable steady-state batch interval**.

A stage reserves RAM only for its planned execution window:

```text
startAt = landingAt - actionDuration
endAt   = landingAt
```

A stage may be split across multiple hosts. The reservation model checks each host's overlapping reservations over the entire stage window before assigning threads.

## Burst depth versus sustainable cadence

These are intentionally different metrics.

A short 800 ms landing cadence may allow many batches to be admitted as a burst while RAM is still available, but that does **not** mean the cadence can continue indefinitely. Long weaken/grow durations can leave many batches resident at once.

The scheduler therefore reports:

```text
burstDepth
requestedBatchIntervalMs
sustainable tunedBatchIntervalMs
steadyState.requiredDepth
steadyState.peakRam
```

The sustainable interval is searched separately. For a candidate interval, the planner simulates enough consecutive batches to cover the longest action duration plus the landing window, then checks host-by-host reservations. The selected interval is the smallest conservative value found to fit that steady-state window.

The depth search currently checks up to 64 batches. If all 64 fit, output is marked as search-capped rather than incorrectly claiming 64 is the true maximum.

## Timing tuning

If Port 15 contains a completed batch for the same target, the planner uses the retained timing measurements as a provisional safety signal:

```text
maxAbsLandingErrorMs
max allocationSpreadMs across stages
minimumSpacingMs
orderCorrect
```

The current stage-gap rule remains conservative:

```text
stageGap >= requested gap
stageGap >= observed drift + observed spread + 25 ms
```

The initial batch interval is at least four stage gaps and leaves room for observed drift/spread. RAM sustainability may then increase the interval further.

The scheduler prints why Port 15 telemetry was or was not accepted so `CONSERVATIVE_DEFAULT` can be diagnosed directly.

Only one retained completed batch is currently available, so this is **telemetry-assisted**, not statistically adaptive. Aggressive automatic reduction of gaps must wait for a rolling timing history.

## Current-free-RAM rule

The dry-run uses the execution pool's **currently free remote RAM** as its capacity baseline. RAM already consumed by an active serialized batch or unrelated process is therefore excluded and is not assumed to become available later. This is intentionally conservative while the scheduler remains non-executing.

## Important limitations

The current dry-run planner does **not**:

- launch any H/G/W workers;
- consume Port 14 timing events;
- manage multiple live batch IDs;
- change the controller review barrier;
- recover from a failed/partial pipelined batch;
- maintain rolling timing history;
- automatically reduce the configured 200 ms single-batch gap.

The V2 RAM planner is host-aware, but it is still a simulation. The eventual executable scheduler must make the same reservations atomically before launching live work and update them as jobs finish or fail.

## Required milestones before live pipelining

1. Collect repeated single-batch landing telemetry and establish realistic drift/spread bounds.
2. Add rolling timing history rather than tuning from only Port 15.
3. Validate V2 burst-depth and sustainable-interval predictions against observed execution capacity.
4. Reuse the host-window reservation model in an executable scheduler with atomic admission.
5. Replace Port 14 clearing with one shared multi-batch event consumer routed by `batchId`.
6. Introduce a maximum live depth of 2 for the first executable test.
7. Stop new admissions immediately on bad landing order, missing timing events, or recovery error.
8. Let safe in-flight work drain, force target prep/review, then restart the pipeline.
9. Only raise pipeline depth after repeated depth-2 validation.

## Intended future landing calendar

With a 200 ms stage gap, a timing-only minimum interval starts near 800 ms:

```text
H1  W1-1  G1  W2-1  H2  W1-2  G2  W2-2  H3 ...
|----200----200----200----200----200----200----200----|
```

However, V2 may recommend a larger sustainable interval when current RAM cannot support enough simultaneous long-running stages to maintain an 800 ms cadence. The scheduler should optimize for **sustainable throughput**, not a short burst that later stalls.
