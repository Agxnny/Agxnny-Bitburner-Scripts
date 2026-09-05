# Architecture

## Source of truth

GitHub `main` is the source of truth. Read `docs/HANDOFF.md` first for current work, then fetch current files before editing.

## Core principle

Home is the **control/UI plane**. Rooted and cloud servers are the **execution plane**. H/G/W workers, tactical analysis, and timed batch execution run remotely whenever possible.

The GUI consumes structured runtime state and sends lightweight commands; it does not own target analysis or worker scheduling.

## Startup

```text
startup.js
    starts /ui/dashboard.js on home
        ↓
    spawns /kickstart.js --quiet
        ↓
planner → deploy/sync → economy/target → controller
```

## GUI architecture

`ui/dashboard.js` mounts its React tree once. Runtime snapshots are refreshed by the asynchronous Netscript loop and exposed through plain-JS cached state. Tab selection is React-local and callbacks remain Netscript-free.

The Batch tab owns synchronized-HWGW observability. Overview also shows controller-published standalone worker ETA and active-worker timing without scanning remote process lists from React callbacks.

## Live execution modes

### Normal HGW

Sequential tactical weaken/grow/hack execution.

### Serialized synchronized HWGW

The **live** batching path remains one complete batch at a time:

```text
HACK              t0
WEAKEN_HACK       t0 + gap
GROW              t0 + 2 × gap
WEAKEN_GROW       t0 + 3 × gap
```

Default stage gap: 200 ms.

The current `batch-runner.js` reserves the complete batch footprint, launches H/W1/G/W2, waits for all work, publishes recovery/timing telemetry, and then the controller enforces a strategic-review barrier before another live batch.

## Pipeline scheduler architecture

`hacking/batch-scheduler.js` is the Stage 5 scheduler prototype. It remains **non-executing**.

It separates two timing dimensions:

```text
stage gap      = spacing H → W1 → G → W2 within a batch
batch interval = spacing H(N) → H(N+1) between batches
```

### Host-window reservation model

Every planned stage has:

```text
startAt   = landingAt - actionDuration
landingAt = planned completion
ram       = threads × worker RAM
```

The scheduler reserves these windows host-by-host. Stages may be split across hosts. This catches fragmentation that an aggregate-RAM-only model cannot detect.

The scheduler reports both:

- **burst depth** — how many batches can be admitted quickly before reservations fail;
- **sustainable interval** — the smallest batch cadence that can be maintained across a full steady-state residence window.

A short timing-safe interval is not necessarily RAM-sustainable.

### Depth-2 admission simulation

Passing `admission` starts a persistent virtual scheduler:

```text
run hacking/batch-scheduler.js phantasy 0.10 200 admission
```

No H/G/W worker is launched. The simulator keeps at most two virtual batches in flight and applies the intended first executable admission rules:

1. Initial pipeline opening requires a prepared target baseline.
2. Batch 2 waits for the tuned sustainable interval.
3. Live remote RAM is re-evaluated host-by-host before admission.
4. Depth 2 blocks new admissions until the oldest virtual batch reaches planned W2.
5. New matching Port 15 completions are evaluated for timing/recovery safety.
6. Bad order, missing events, or material recovery error causes `SAFETY_STOP`.
7. Safety stop blocks new admissions while existing virtual work drains.

Once a pipeline has opened, raw target money/security is deliberately not used as a per-batch gate because an active HWGW pipeline intentionally leaves the target temporarily hacked/grown between stage landings.

## Batch recovery and timing telemetry

Port 12 stores current serialized-batch state. Port 14 carries batch worker completion events. Port 15 retains the latest completed batch. Port 16 stores the latest scheduler/admission-simulation state.

For split stages:

```text
firstCompletionAt = earliest allocation completion
actualLandingAt   = latest allocation completion
allocationSpread  = actualLandingAt - firstCompletionAt
```

The Batch GUI plots planned vs actual H/W1/G/W2 timing and exposes order, minimum spacing, maximum drift, allocation spread, and missing events.

## Important pipeline boundary: Port 14

The serialized runner currently clears Port 14 before each live batch. This is safe only because one real batch is in flight.

Before live pipelining, Port 14 ownership must move to one multi-batch-safe scheduler/consumer that routes events by `batchId` and never clears another batch's events.

## Strategic-review boundary

The current controller treats full serialized-batch completion as a strategic checkpoint. A steady pipeline cannot stop admissions after every batch, so the review barrier must become pipeline-aware before real overlap is enabled.

The intended behavior is to stop **new admissions** on meaningful timing/recovery/strategy changes, let already-safe in-flight work drain, then repair/review/restart.

## Standalone worker observability

Normal/prep H/G/W allocations include:

```text
pid
hostname
threads
action
target
startedAt
expectedDurationMs
expectedFinishAt
```

The GUI may label a worker `LATE` after an observational grace margin. No automatic worker killing is enabled yet.

## Safe execution-mode transitions

A pending HGW/BATCH mode change pauses new work and waits for existing target-side execution to reach a safe boundary before applying the new mode.

## Remote-only worker policy

`lib/execution.js` excludes home from H/G/W capacity. If remote capacity is unavailable, automation waits instead of consuming control/UI RAM.

## Runtime ports

| Port | Purpose |
| --- | --- |
| 1 | controller snapshot |
| 2 | planner / selected strategy |
| 3 | tactical plan |
| 4 | hack completion event queue |
| 5 | income telemetry |
| 6 | diagnostic request queue |
| 7 | progression/economy state |
| 8 | economic target state |
| 9 | root/tool state |
| 10 | cloud capacity automation state |
| 11 | manual money goal / spending lock |
| 12 | current synchronized batch state |
| 13 | controller command queue |
| 14 | batch landing-timing event queue |
| 15 | latest completed batch state |
| 16 | pipeline scheduler / admission simulation |

## Current development stage

Stage 4 serialized batching is live and instrumented. Stage 5 currently includes:

- independent stage-gap and batch-interval modeling;
- host-by-host future RAM reservation;
- burst-depth versus sustainable-cadence analysis;
- persistent depth-2 virtual admission simulation;
- simulated safety-stop evaluation from completed-batch telemetry.

Live overlapping batches remain disabled until Port 14 is multi-batch-safe, reservations can drive atomic launches/rollback, review behavior is pipeline-aware, and the depth-2 executable path is validated.
