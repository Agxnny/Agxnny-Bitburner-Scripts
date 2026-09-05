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

The dashboard was compacted so repeated controller/economy/batch information is no longer shown in several separate cards. Overview combines execution/prep controls and hides Active Workers when empty. The Batch tab consumes Port 12, Port 15, and Port 16 in one compact workspace with collapsible stage diagnostics.

## Controller-integrated execution modes

### Normal HGW

Sequential tactical weaken/grow/hack execution.

### Serialized synchronized HWGW

The automatic controller path remains one complete batch at a time:

```text
HACK              t0
WEAKEN_HACK       t0 + gap
GROW              t0 + 2 × gap
WEAKEN_GROW       t0 + 3 × gap
```

Default stage gap: 200 ms.

`hacking/batch-runner.js` reserves a full serialized batch, launches all H/W1/G/W2 workers with timed delays, waits for completion, publishes Port 12/15 telemetry, then the controller enforces a strategic-review barrier.

## Pipeline planner and simulator

`hacking/batch-scheduler.js` remains the non-executing planning layer.

It separates:

```text
stage gap      = H → W1 → G → W2 spacing within a batch
batch interval = H(N) → H(N+1) spacing between batches
```

It models future stage execution windows host-by-host, catches RAM fragmentation, distinguishes burst depth from sustainable cadence, and can run a persistent virtual depth-2 admission simulation. Planner/simulation state is published to Port 16.

## First real depth-2 executor

`hacking/pipeline-runner.js` is the first **real overlapping** HWGW test harness.

It is intentionally standalone rather than a controller mode. Before it starts, it requires:

```text
controller target == pipeline target
controller PREPARED HOLD == true
controller active standalone jobs == 0
serialized batch runner == idle
target money >= 99.5%
target security <= minimum + 0.05
```

The controller must remain parked for the duration of the test.

### Depth rule

Real overlap is hard-capped at:

```text
MAX_DEPTH = 2
```

The first recommended run asks for exactly two total batches. Larger requested counts are executed as later **waves** of at most two batches only after the current wave drains and the target is still prepared.

### Host-window reservations

Each stage is modeled as:

```text
startAt   = landingAt - actionDuration
landingAt = planned completion
ram       = threads × worker RAM
```

The executor computes a conservative RAM-sustainable batch interval, reserves every stage host-by-host, and records exact host/thread allocations before launching the wave.

### Just-in-time dispatch

Unlike the serialized runner, the real pipeline executor does not start every script immediately and hold RAM during a long `additionalMsec` delay. Each stage is dispatched shortly before its calculated `startAt`, with a small dispatch lead and any remaining timing correction passed as `additionalMsec`.

This makes live RAM behavior match the host-window reservation model much more closely.

### Port 14 ownership

At preflight, the executor verifies serialized batching is parked. It then clears stale Port 14 data **once** and becomes the only timing-event consumer for the test.

All new events are routed by:

```text
batchId → matching in-flight batch → stage telemetry
```

This is the first real multi-batch-safe Port 14 consumer. It is not yet safe to run simultaneously with the serialized batch runner because that runner still assumes it may clear Port 14.

### Completion and safety stop

Each real pipeline batch produces the same landing summary concepts used by serialized batches:

```text
actualOrder
orderCorrect
missingJobs
minimumSpacingMs
maxAbsLandingErrorMs
landing.stages[]
```

A completed pipeline batch is copied to Port 15, allowing the existing Batch-tab timing graph to display it.

New waves stop on:

- any worker launch failure;
- incorrect H/W1/G/W2 order;
- missing timing events;
- final money below 99.5%;
- final security above minimum +0.05;
- target outside prepared tolerance after a wave.

Already-launched work is allowed to drain. The runner does not automatically kill healthy in-flight workers just because admission has stopped.

## Runtime state

- Port 12: current serialized batch.
- Port 14: batch timing event queue.
- Port 15: latest completed serialized or pipeline batch.
- Port 16: latest planner, admission simulation, or real pipeline-executor state.

The Batch GUI detects Port 16 model/mode and shows planner, virtual, or real depth-2 status without requiring terminal tailing.

## Strategic-review boundary

The automatic controller still performs review after each serialized batch. The standalone pipeline test bypasses that automatic admission loop by requiring PREPARED HOLD and managing its own finite wave.

A future controller-integrated pipeline must replace the per-batch review barrier with:

```text
healthy completion → continue admissions
safety/strategy failure → stop admissions → drain → prep/review → restart
```

## Standalone worker observability

Normal/prep H/G/W allocations include PID, host, threads, action, target, start time, expected duration, and expected finish time. The GUI may label a worker `LATE` after an observational grace margin. No automatic worker killing is enabled yet.

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
| 12 | current serialized batch state |
| 13 | controller command queue |
| 14 | batch landing-timing event queue |
| 15 | latest completed batch state |
| 16 | pipeline planner / simulation / executor state |

## Current development stage

Stage 4 serialized batching remains the automatic production path. Stage 5 now includes:

- stage-gap and batch-interval modeling;
- host-by-host future RAM reservation;
- burst-depth versus sustainable-cadence analysis;
- persistent virtual depth-2 admission simulation;
- **opt-in real depth-2 overlapping execution**;
- central per-`batchId` timing routing for that standalone real test;
- safety-stop logic and finite depth-2 waves.

Next work is live validation of the first real pair, rolling timing history, then controller integration of shared queue ownership/admission/review behavior. Maximum live depth must remain 2 until repeated results are healthy.
