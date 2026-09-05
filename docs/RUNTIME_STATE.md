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
| 17 | Global multi-target planner/simulator | Latest-value snapshot |
| 18 | Dedicated prepper / reserved-host state | Latest-value snapshot |

## Port 1 — controller state

Current execution modes:

```text
STANDBY | HGW | BATCH | PIPELINE
```

Startup initializes the production controller in `STANDBY`. The background prepper is independent of production mode, so STANDBY may still show grow/weaken maintenance on the dedicated reserved prep host.

## Port 13 — controller requests

```text
PREP_TARGET
RESUME_AUTO
SET_MANUAL_TARGET
CLEAR_MANUAL_TARGET
SET_EXECUTION_MODE STANDBY|HGW|BATCH|PIPELINE
```

Mode changes wait for a safe boundary. For PIPELINE, later wave admission stops and already-admitted work drains before the controller applies the new mode.

## Port 14 — batch timing event queue

Workers emit `BATCH_STAGE_COMPLETE` events with batch/stage/job identity, threads, planned landing, finish time, and landing error. Serialized BATCH and real PIPELINE remain mutually exclusive. The real pipeline coordinator owns and routes Port 14 by `batchId` while active.

Neither multi-target planning script nor the prepper consumes Port 14.

## Port 15 — latest completed batch

Port 15 accepts compatible serialized and pipeline completion payloads. It remains latest-only, not rolling history.

## Port 16 — single-target pipeline state

Known models:

```text
PIPELINE_DRY_RUN_V2_HOST_WINDOWS
PIPELINE_ADMISSION_SIM_V3_DEPTH2
PIPELINE_EXECUTOR_DEPTH2_V2
```

## Port 17 — global multi-target planner / simulator

Two planning-only writers currently use Port 17.

One-shot allocator, `hacking/multi-target-scheduler.js`:

```text
MULTI_TARGET_ALLOCATOR_DRY_RUN_V2_SHARED
```

Persistent simulator, `hacking/multi-target-sim.js`:

```text
MULTI_TARGET_ADMISSION_SIM_V2_PERSISTENT
```

Both launch no workers. The one-shot allocator produces a static global reservation snapshot. The persistent simulator continuously expires virtual reservations, refreshes target readiness and live remote capacity, and re-admits new virtual work.

Persistent-state fields include:

```text
persistent: true
dryRun: true
launchesWorkers: false
consumesBatchTimingPort: false
profile
status
reason
runtimeMs
capacity.hostCount
capacity.availableRam
capacity.maxInFlight
capacity.inFlight
capacity.totalAdmitted
capacity.totalCompleted
capacity.blockedTicks
capacity.poolResets
objective
prepper
targets[]
inFlight[]
recentCompletions[]
hostPeak[]
updatedAt
```

Each persistent `targets[]` entry includes current preparation state, `schedulerState` (`WAITING_PREP`, `READY`, or `RUNNING`), current virtual depth, recent 60-second completion count, lifetime admission/completion counters, objective score, batch template, and next first-landing time.

Only targets at >=99.5% money and <=+0.05 security receive persistent production admissions. Other candidates remain `WAITING_PREP` while the Port 18 prepper works independently.

Running the one-shot allocator while the persistent simulator is active will replace the latest Port 17 snapshot, and the persistent simulator will overwrite it again on its next loop. This is expected latest-value behavior, not a queue.

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

`lib/execution.js` treats a Port 18 reservation as active only while the heartbeat is fresh (currently 5 seconds). A fresh `reservedHost` is excluded from the normal remote execution pool. If the prepper stops and Port 18 becomes stale, the host automatically returns to production capacity.

## GUI rule

React callbacks only update local/plain-JS request state. Netscript port/file I/O stays in the asynchronous dashboard loop.
