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
| 12 | Batch state | Latest-value snapshot |
| 13 | Controller requests | Event queue |
| 14 | Batch timing events | Event queue |

Snapshot writers replace the prior value. Ports 13 and 14 are intentionally consumed as queues.

## Port 1 — controller state

Published by `hacking/controller.js`.

Important top-level concepts include current target hostname, target phase/action, observed money/security, current strategy values, tactical status, execution-pool summary, prep state, manual target state, and execution mode state.

### `executionMode`

Current fields include concepts equivalent to:

```text
mode: HGW | BATCH
pending: requested mode change, if any
batchGapMs: current synchronized landing gap
batchRunning: whether batch coordinator is active
batchRunnerHost: remote coordinator host
awaitingReview: strict post-batch review barrier
batchCompletedAt: completed batch timestamp used by barrier
lastBatchId: latest completed batch id
lastMessage: user-facing controller explanation
```

## Port 2 — planner state

Published by the network/target planner and augmented by economic selection. Important data includes analyzed/ranked targets, selected target, execution hosts, worker RAM information, network/root capability summary, and `economicSelection`.

## Port 3 — tactical plan

Published by `hacking/tactical-planner.js`. Includes target hostname, controller request id, requested action, calculated threads, timing/security/money analysis, planner host, and optional forced tactical mode.

## Ports 4 and 5 — hack events and income telemetry

Hack workers/telemetry attach batch metadata where applicable.

```text
standalone HGW HACK completion
    → may trigger strategic review

batch-associated HACK completion
    → must NOT trigger strategic review yet
    → wait for Port 12 full batch COMPLETE
```

## Ports 7–11

- Port 7: economy/progression state.
- Port 8: economic target state and post-batch review freshness timestamp.
- Port 9: root/tool state.
- Port 10: cloud-capacity action state.
- Port 11: manual money-goal / spending-lock state.

## Port 12 — batch state

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

A stage may be allocated across several hosts. Its `actualLandingAt` is therefore the latest completion timestamp among all allocations for that stage; `firstCompletionAt` and `allocationSpreadMs` expose how widely split allocations completed.

Port 12 remains a latest-value snapshot, not a historical batch log.

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

## Queue design rule

GUI React callbacks should only construct/assign plain-JS request data. The dashboard main loop writes that data to Port 13. Do not call Netscript APIs directly inside React event callbacks.

## Freshness and strategic events

Heavy analysis is event-driven where possible. Important events currently include startup, standalone HACK completion, full batch completion, root/execution-pool expansion, successful cloud-capacity change, and manual money-goal change.
