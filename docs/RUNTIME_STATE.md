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

## Port 1 — controller state

Current execution modes:

```text
STANDBY | HGW | BATCH | PIPELINE
```

Important `executionMode` fields include mode/pending/transition state, serialized and pipeline runner state, pipeline max depth/safety stop, review state, and `lastMessage`. Startup initializes the controller in `STANDBY`.

Standalone/prep H/G/W allocations continue to publish PID, host, threads, action, target, start time, expected duration, and expected finish time. GUI `LATE` labels remain presentation-only.

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

Workers emit `BATCH_STAGE_COMPLETE` events with batch/stage/job identity, threads, planned landing, finish time, and landing error. Serialized BATCH and live PIPELINE remain mutually exclusive. The current real pipeline coordinator owns and routes Port 14 by `batchId` while active.

The multi-target allocator on Port 17 is dry-run only and does **not** consume Port 14.

## Port 15 — latest completed batch

Port 15 accepts compatible serialized and pipeline completion payloads. It remains latest-only, not rolling history.

## Port 16 — single-target pipeline state

Known models:

```text
PIPELINE_DRY_RUN_V2_HOST_WINDOWS
PIPELINE_ADMISSION_SIM_V3_DEPTH2
PIPELINE_EXECUTOR_DEPTH2_V2
```

The real executor publishes continuous/controller-managed flags, target, status/reason, completed and in-flight batches, stage gap, batch interval, recent events, safety state, and drain state.

## Port 17 — global multi-target allocation planner

Published by `hacking/multi-target-scheduler.js` with model:

```text
MULTI_TARGET_ALLOCATOR_DRY_RUN_V1
```

Key fields:

```text
version: 1
dryRun: true
launchesWorkers: false
profile: money | balanced | xp
targetCount
requestedHackFraction
stageGapMs
globalLandingGapMs
status
reason
capacity
objective
targets[]
allocations[]
hostPeak[]
updatedAt
```

Each `targets[]` entry reports its HWGW thread template, batch RAM/RAM-time, expected cash, money efficiency, XP-proxy efficiency, base score, assigned virtual batch count, allocation share, and whether the target is currently prepared.

`assignedBatches` is intentionally dynamic rather than a fixed per-target depth. `allocations[]` records the virtual global admission order and exact host/stage/thread reservations for inspection.

The current XP metric is explicitly a proxy (`ACTION_THREAD_DIFFICULTY_PROXY_PER_RAM_SECOND`) and must not be treated as exact Bitburner XP.

## GUI rule

React callbacks only update local/plain-JS request state. Netscript port/file I/O stays in the asynchronous dashboard loop.
