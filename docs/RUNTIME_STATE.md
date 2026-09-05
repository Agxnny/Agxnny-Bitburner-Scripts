# Runtime State and Command Contract

`lib/runtime-state.js` remains the transport implementation source of truth.

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
| 12 | Current serialized batch state | Latest-value snapshot |
| 13 | Controller requests | Event queue |
| 14 | Batch timing events | Event queue |
| 15 | Latest completed batch | Latest-value snapshot |
| 16 | Pipeline planner/simulation/executor | Latest-value snapshot |

## Port 1 — controller state

### `executionMode`

Current mode values are:

```text
STANDBY | HGW | BATCH | PIPELINE
```

Important fields include:

```text
mode
pending
transitioning
transitionTarget
batchGapMs
batchRunning
batchRunnerHost
pipelineRunning
pipelineRunnerHost
pipelineMaxDepth
pipelineSafetyStopped
awaitingReview
batchCompletedAt
lastBatchId
lastMessage
```

Startup initializes the controller in `STANDBY`.

`pipelineRunning` means the controller owns a continuous depth-2 pipeline coordinator. `pipelineSafetyStopped` means automatic pipeline admission has been blocked and the target is being/has been prepared for review.

### `execution.activeWorkers`

Standalone/prep H/G/W allocations continue to publish PID, host, threads, action, target, start time, expected duration, and expected finish time. `LATE` remains presentation-only; no watchdog kill is enabled.

## Port 13 — controller requests

Current commands:

```text
PREP_TARGET
RESUME_AUTO
SET_MANUAL_TARGET
CLEAR_MANUAL_TARGET
SET_EXECUTION_MODE STANDBY|HGW|BATCH|PIPELINE
```

Mode changes wait for a safe boundary. For PIPELINE, the executor stops admitting later waves and drains the already-admitted wave before the controller applies the new mode.

## Port 14 — batch timing event queue

Batch workers emit `BATCH_STAGE_COMPLETE` events with batch/stage/job identity, threads, planned landing, finish time, and landing error.

Serialized BATCH and PIPELINE remain mutually exclusive under controller scheduling. A real pipeline coordinator clears stale Port 14 data once at startup, then routes all subsequent events by `batchId` for the duration of the pipeline session.

## Port 15 — latest completed batch

Port 15 accepts compatible serialized and pipeline completion payloads. Pipeline completions use the `PIPELINE_HWGW_DEPTH2_V1` model and include `pipeline: true`, `maxDepth: 2`, `batchIntervalMs`, final target state, and landing telemetry.

Port 15 is still latest-only, not rolling history.

## Port 16 — pipeline state

### Planner

```text
PIPELINE_DRY_RUN_V2_HOST_WINDOWS
```

### Admission simulation

```text
PIPELINE_ADMISSION_SIM_V3_DEPTH2
```

### Real executor

Current executor model:

```text
PIPELINE_EXECUTOR_DEPTH2_V2
```

Key executor fields:

```text
version: 5
dryRun: false
simulation: false
execution: true
maxDepth: 2
continuous
controllerManaged
target
status
reason
requestedBatches
completedBatches
stageGapMs
batchIntervalMs
inFlight[]
completedRecent[]
events[]
safetyStopped
safetyReason
drainRequested
updatedAt
```

Important statuses include:

```text
BLOCKED
RUNNING
DRAINING_AFTER_STOP
DRAINING_FOR_MODE_SWITCH
SAFETY_STOP
DRAINED_FOR_MODE_SWITCH
COMPLETE
```

In controller-managed mode, `continuous: true` and `requestedBatches: 0` mean the executor continues depth-2 waves until a safety stop or controller drain request.

## GUI rule

React callbacks only update local/plain-JS request state. Netscript port/file I/O stays in the asynchronous dashboard loop.
