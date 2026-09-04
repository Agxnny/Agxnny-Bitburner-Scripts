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

`ui/dashboard.js` mounts its React tree once. Runtime snapshots are refreshed by the asynchronous Netscript loop and exposed through plain-JS cached state. Tab selection is React-local.

React callbacks never call Netscript APIs directly. Command callbacks assign plain-JS request state; the dashboard loop later writes Port 13 or files.

The GUI now has a dedicated **Batch** tab. Overview remains focused on current control-plane status, while the Batch tab owns synchronized-HWGW observability: current batch state, latest completed recovery, landing-order measurements, per-stage errors/spread, and a planned-vs-actual landing timeline.

## Execution modes

### Normal HGW

Sequential tactical weaken/grow/hack execution.

### Automatic synchronized HWGW

Current batching is intentionally **one complete batch at a time**.

The controller prepares the target, launches `hacking/batch-runner.js` remotely, waits for the full batch, then enforces a post-batch strategic-review barrier before another batch can launch.

Landing plan:

```text
HACK              t0
WEAKEN_HACK       t0 + gap
GROW              t0 + 2 × gap
WEAKEN_GROW       t0 + 3 × gap
```

Default gap: 200 ms.

The batch runner reserves the full remote worker footprint before launch. If the whole batch does not fit, no stage starts.

## Batch recovery model

The original W2 security-compensation defect was caused by using host-aware `growthAnalyzeSecurity` while the target was already prepared. The runner now uses uncapped `ns.growthAnalyzeSecurity(growThreads)` and live corrected batches recover to the expected baseline.

Port 12 records initial state, predicted recovery, final state, and predicted-vs-actual recovery errors.

## Batch landing telemetry

Workers receive the planned landing timestamp as a batch-only argument.

After completing their operation, batch-associated HACK/GROW/WEAKEN workers emit one lightweight completion event to **Port 14**:

```text
batchId
stage
jobId
threads
plannedLandingAt
finishedAt
landingErrorMs
```

Port 14 is separate from Port 4 so GROW/WEAKEN timing events cannot affect strategic HACK-completion handling.

The batch runner drains Port 14 while jobs are active and aggregates worker events by stage. Because a stage may be split across remote hosts:

```text
firstCompletionAt = earliest allocation completion
actualLandingAt   = latest allocation completion
allocationSpread  = actualLandingAt - firstCompletionAt
```

A stage is not considered fully landed until its last allocation finishes.

Port 12 schema version 3 publishes:

```text
landing.expectedOrder
landing.actualOrder
landing.orderCorrect
landing.minimumSpacingMs
landing.maxAbsLandingErrorMs
landing.missingJobs
landing.adjacentSpacing[]
landing.stages[]
```

When a batch reaches `COMPLETE`, the same completed snapshot is also copied to **Port 15**. Port 12 is free to advance immediately to the next current batch, while Port 15 remains stable for GUI inspection.

The Batch tab renders `landing.stages[]` as a planned-vs-actual timeline. Each H/W1/G/W2 row plots planned and actual completion on the same horizontal axis, making systematic early/late landing visually obvious while preserving exact numeric errors and allocation spread below.

### Current serialization assumption

The batch runner clears Port 14 immediately before launching a new batch. This is safe only because one batch is allowed in flight. Overlapping/pipelined batches must replace this with a multi-batch-safe event-consumption strategy.

## Strict post-batch strategic-review boundary

Batch-associated HACK events are ignored as standalone strategic checkpoints. `hacking/refresh.js` waits for Port 12 to report the entire batch `COMPLETE`. The controller then waits for a fresh economic-target snapshot before launching the next batch.

## Remote-only worker policy

`lib/execution.js` excludes home from worker capacity. If remote capacity is unavailable, automation waits instead of consuming control/UI RAM.

## Manual controls

- Port 13 carries prep/resume/manual-target/execution-mode commands.
- Manual target changes apply only at safe idle boundaries.
- Manual money goal on Port 11 is a hard automatic-spending lock.
- Prep-and-hold grows to full money, weakens to minimum, then holds.

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

See `docs/RUNTIME_STATE.md` for the detailed state contract.

## Current development stage

Stage 4 synchronized batching currently includes:

- timing-capable workers;
- full-batch RAM reservation;
- automatic single-batch controller handoff;
- strict strategic-review barrier;
- corrected W2 security compensation;
- predicted-vs-actual recovery telemetry;
- actual landing drift/order telemetry;
- retained latest-completed batch state and dedicated Batch GUI workspace;
- **current: repeated timing-margin measurement**.

Stage 5 pipelining begins only after repeated timing measurements show understood and adequate landing margin.
