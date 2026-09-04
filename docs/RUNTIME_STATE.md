# Runtime State and Command Contract

The project uses Netscript ports as lightweight shared transport between persistent and short-lived services.

`lib/runtime-state.js` is the implementation source of truth. This document explains intended semantics.

## Port map

| Port | Name | Semantics |
| --- | --- | --- |
| 1 | Controller state | Latest-value snapshot |
| 2 | Planner state | Latest-value snapshot |
| 3 | Tactical plan state | Latest-value snapshot |
| 4 | Hack event queue | Event queue |
| 5 | Income telemetry | Latest-value snapshot |
| 6 | Diagnostic request queue | Event queue |
| 7 | Economy/progression state | Latest-value snapshot |
| 8 | Economic target state | Latest-value snapshot |
| 9 | Root/tool state | Latest-value snapshot |
| 10 | Cloud capacity action state | Latest-value snapshot |
| 11 | Manual money-goal state | Latest-value snapshot |
| 12 | Current batch state | Latest-value snapshot |
| 13 | Controller requests | Event queue |
| 14 | Batch timing events | Event queue |
| 15 | Latest completed batch | Latest-value snapshot |
| 16 | Batch scheduler analysis | Latest-value snapshot |

Snapshot writers replace the prior value. Ports 13 and 14 are intentionally consumed as queues.

## Port 1 — controller state

Published by `hacking/controller.js`.

Important top-level concepts include current target hostname, target phase/action, observed money/security, current strategy values, tactical status, execution-pool summary, prep state, manual target state, and execution mode state.

### `executionMode`

Current fields include concepts equivalent to:

```text
mode: HGW | BATCH
pending: requested mode change, if any
transitioning: whether a safe-boundary mode handoff is in progress
transitionTarget: pending target mode
batchGapMs: current synchronized landing gap
batchRunning: whether batch coordinator is active
batchRunnerHost: remote coordinator host
awaitingReview: strict post-batch review barrier
batchCompletedAt: completed batch timestamp used by barrier
lastBatchId: latest completed batch id
lastMessage: user-facing controller explanation
```

### `execution.activeWorkers`

Standalone/distributed H/G/W allocations launched by the controller are published for GUI observability while they remain active.

Each entry includes:

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

The estimate is captured when the tactical action is dispatched. It is observational data, not a watchdog contract.

### `execution.currentAction`

When standalone H/G/W allocations are active, the controller also publishes an aggregate summary:

```text
action
target
startedAt
expectedDurationMs
expectedFinishAt
```

The GUI uses this for a simple current-action ETA. When no standalone workers are active this field is `null`.

The current GUI may label a worker `LATE` after its estimate plus an observation margin of `max(5s, 15%)`. This is presentation-only: **no worker is automatically killed yet**.

## Ports 2–11

- Port 2: planner state, rankings, execution hosts, and economic selection.
- Port 3: tactical plan state.
- Port 4: HACK completion events used by income/strategic telemetry.
- Port 5: income telemetry snapshot.
- Port 6: diagnostic request queue.
- Port 7: economy/progression state.
- Port 8: economic target state and post-batch review freshness timestamp.
- Port 9: root/tool state.
- Port 10: cloud-capacity action state.
- Port 11: manual money-goal / spending-lock state.

Batch-associated HACK completion must not trigger standalone strategic review; the system waits for the full Port 12 batch completion boundary.

## Port 12 — current batch state

Published by `hacking/batch-runner.js`.

Typical lifecycle:

```text
PLANNING → BLOCKED

or

READY → RUNNING → COMPLETE
```

`LAUNCH_FAILED` is used if startup fails after reservation; already launched jobs are cancelled.

Current batch-state schema version is `3` with model `SINGLE_HWGW_ADDITIONAL_MSEC_V3`.

Core fields include batch id, target, status/reason, requested/actual hack fraction, gap, H/W1/G/W2 thread counts, stage allocations, planned landing timestamps, total RAM, recovery telemetry, final money/security, and landing telemetry.

### Planned timing fields

The current batch state includes planned timing values used by the Batch GUI:

```text
timing.firstLandingAt
timing.lastLandingAt
timing.landingWindowMs
stages[].landingAt
launchStartedAt
```

These support a planned total-duration estimate, per-stage landing countdowns, and a countdown to final W2 landing while the batch is active.

### Recovery-model telemetry

`initial` records the target state used for planning. `predicted` records expected money/security recovery. On completion, `final` contains the observed state and `comparison` contains predicted-vs-actual errors.

### Landing telemetry

On `COMPLETE`, `landing` contains:

```text
expectedOrder
actualOrder
orderCorrect
expectedJobs
reportedJobs
missingJobs
minimumSpacingMs
maxAbsLandingErrorMs
adjacentSpacing[]
stages[]
```

Each `landing.stages[]` entry contains:

```text
name
plannedLandingAt
expectedJobs
reportedJobs
missingJobs
firstCompletionAt
actualLandingAt
allocationSpreadMs
landingErrorMs
complete
```

A stage may be allocated across several hosts. Its `actualLandingAt` is the latest completion timestamp among all allocations for that stage; `firstCompletionAt` and `allocationSpreadMs` expose how widely split allocations completed.

Port 12 is intentionally the **current/latest batch** slot. Once another batch begins it may replace the just-completed state. The Overview GUI therefore does not treat a stale `COMPLETE` payload as an active batch.

## Port 13 — controller command queue

Used by the GUI and other lightweight control surfaces. Current commands are:

```text
PREP_TARGET
RESUME_AUTO
SET_MANUAL_TARGET
CLEAR_MANUAL_TARGET
SET_EXECUTION_MODE HGW|BATCH
```

Mode/target changes wait for safe controller boundaries.

## Port 14 — batch timing event queue

Batch workers write one completion event after a batch-associated HACK/GROW/WEAKEN operation finishes.

Conceptual event fields:

```text
type: BATCH_STAGE_COMPLETE
batchId
stage
jobId
threads
plannedLandingAt
finishedAt
landingErrorMs
```

The batch runner drains this queue while its worker jobs are active and aggregates per-job events into the Port 12 `landing` object.

Port 14 is deliberately separate from Port 4 so timing events from GROW/WEAKEN cannot interfere with strategic HACK completion handling.

Because batching is currently serialized, the runner clears stale Port 14 events immediately before launching a new batch. This queue-handling rule must change before overlapping/pipelined batches are allowed.

## Port 15 — latest completed batch state

Whenever a synchronized batch reaches `COMPLETE`, `hacking/batch-runner.js` copies the complete Port 12 payload to Port 15.

Port 15 is not a historical log. It retains exactly one completed batch so the GUI can continue displaying recovery and landing measurements after Port 12 advances to the next planning/running batch.

The dedicated Batch tab reads Port 12 for **current batch** status and Port 15 for **last completed batch** telemetry. The same `landing.stages[]` data is used for the planned-vs-actual visual timeline.

## Port 16 — batch scheduler analysis

Published by `hacking/batch-scheduler.js`.

Current schema:

```text
version: 1
model: PIPELINE_DRY_RUN_V1
dryRun: true
status: PLANNING | READY | BLOCKED
target
requestedHackFraction
requestedStageGapMs
actualHackFraction
threads
timing
ram
stageTemplate
calendarPreview
notes
```

Important timing fields include:

```text
timing.requestedStageGapMs
timing.tunedStageGapMs
timing.tunedBatchIntervalMs
timing.firstLandingDelayMs
timing.batchLandingWindowMs
timing.tuningMode
timing.telemetry
```

The scheduler intentionally distinguishes **stage gap** from **batch interval**. The first controls H→W1→G→W2 spacing inside one batch; the second controls H(N)→H(N+1) spacing across successive batches.

Current RAM fields include current aggregate remote usable RAM, modeled single-batch RAM, simulated pipeline depths, peak RAM per depth, and `safeDepth`.

Port 16 is advisory only. No controller or batch runner currently consumes it to launch overlapping work.

## Queue design rule

GUI React callbacks should only construct/assign plain-JS request data. The dashboard main loop writes that data to Port 13. Do not call Netscript APIs directly inside React event callbacks.

## Freshness and strategic events

Heavy analysis is event-driven where possible. Important events currently include startup, standalone HACK completion, full batch completion, root/execution-pool expansion, successful cloud-capacity change, and manual money-goal change.
