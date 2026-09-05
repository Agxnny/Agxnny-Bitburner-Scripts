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
| 16 | Single-target pipeline planner/simulation/executor | Latest-value snapshot |
| 17 | Global multi-target allocation planner | Latest-value snapshot |
| 18 | Dedicated prepper / reserved-host state | Latest-value snapshot |

## Port 1 — controller state

Current execution modes:

```text
STANDBY | HGW | BATCH | PIPELINE
```

Important `executionMode` fields include mode/pending/transition state, serialized and pipeline runner state, pipeline max depth/safety stop, review state, and `lastMessage`. Startup initializes the production controller in `STANDBY`.

The background prepper is independent of the production mode. Therefore STANDBY may still show grow/weaken work on the dedicated reserved prep host.

## Port 13 — controller requests

```text
PREP_TARGET
RESUME_AUTO
SET_MANUAL_TARGET
CLEAR_MANUAL_TARGET
SET_EXECUTION_MODE STANDBY|HGW|BATCH|PIPELINE
```

Mode changes wait for a safe boundary. For PIPELINE, later wave admission stops and the already-admitted wave drains before the controller applies the new mode.

## Port 14 — batch timing event queue

Workers emit `BATCH_STAGE_COMPLETE` events with batch/stage/job identity, threads, planned landing, finish time, and landing error. Serialized BATCH and live PIPELINE remain mutually exclusive. The real pipeline coordinator owns and routes Port 14 by `batchId` while active.

Neither the Port 17 multi-target dry-run allocator nor the Port 18 prepper consumes Port 14. Prepper workers are launched without batch timing arguments.

## Port 15 — latest completed batch

Port 15 accepts compatible serialized and pipeline completion payloads. It remains latest-only, not rolling history.

## Port 16 — single-target pipeline state

Known models:

```text
PIPELINE_DRY_RUN_V2_HOST_WINDOWS
PIPELINE_ADMISSION_SIM_V3_DEPTH2
PIPELINE_EXECUTOR_DEPTH2_V2
```

## Port 17 — global multi-target allocation planner

Published by `hacking/multi-target-scheduler.js` with model:

```text
MULTI_TARGET_ALLOCATOR_DRY_RUN_V1
```

It is planning-only and reports dynamic per-target batch allocation, profile scoring, shared host/time reservations, and host peak use.

## Port 18 — dedicated prepper / reserved-host state

Published by `hacking/prepper.js` with model:

```text
DEDICATED_TARGET_PREPPER_V1
```

Important fields:

```text
enabled
reservedHost
status
reason
targetCount
preparedCount
completedWaves
currentTarget
currentAction
requestedThreads
launchedThreads
pid
startedAt
updatedAt
```

`lib/execution.js` treats a Port 18 reservation as active only while the heartbeat is fresh (currently 5 seconds). A fresh `reservedHost` is excluded from the normal remote execution pool so production HGW/BATCH/PIPELINE/multi-target planning cannot allocate new work to it. If the prepper stops and Port 18 becomes stale, the host automatically returns to the production pool.

## GUI rule

React callbacks only update local/plain-JS request state. Netscript port/file I/O stays in the asynchronous dashboard loop.
