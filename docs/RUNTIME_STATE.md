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
| 17 | Global multi-target planner/simulator/executor | Latest-value snapshot |
| 18 | Dedicated prepper / reserved-host state | Latest-value snapshot |
| 19 | Rolling real batch safety history | Latest-value snapshot |

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

Mode changes wait for a safe boundary. PIPELINE admission stops on a pending mode request and the already-admitted wave drains naturally before the controller completes the transition. This behavior is now runtime-validated for PIPELINE -> STANDBY.

## Port 14 — batch timing event queue

Workers emit `BATCH_STAGE_COMPLETE` events with batch/stage/job identity, threads, planned landing, finish time, and landing error.

Exactly one real coordinator may own Port 14 at a time. Current real consumers are:

```text
hacking/batch-runner.js
hacking/pipeline-runner.js
hacking/multi-target-runner.js
```

The first live multi-target prototype routes Port 14 events by `batchId` to independent target batches. Planning-only multi-target scripts, the prepper, and the batch-history collector do not consume Port 14.

## Port 15 — latest completed batch

Port 15 accepts compatible serialized, single-target pipeline, and conservative multi-target completion payloads. It remains latest-only. `hacking/batch-history.js` watches this snapshot and folds genuinely new completed batches into Port 19.

The collector treats the Port 15 snapshot already present at collector startup as stale/observed, requires a completion timestamp at or after collector startup, and deduplicates batch IDs.

## Port 16 — single-target pipeline state

Known models:

```text
PIPELINE_DRY_RUN_V2_HOST_WINDOWS
PIPELINE_ADMISSION_SIM_V3_DEPTH2
PIPELINE_EXECUTOR_DEPTH2_V2
```

## Port 17 — global multi-target state

One-shot allocator:

```text
MULTI_TARGET_ALLOCATOR_DRY_RUN_V2_SHARED
```

Persistent planning-only simulator:

```text
MULTI_TARGET_ADMISSION_SIM_V3_HISTORY_CAPPED
```

The persistent simulator enforces Port 19 `recommendedDepth` as a hard per-target virtual cap and continuously frees/replaces expired virtual reservations through one shared host/time RAM calendar.

First real multi-target prototype:

```text
MULTI_TARGET_EXECUTOR_V1_CONSERVATIVE
```

`hacking/multi-target-runner.js` is intentionally finite and conservative. It:

```text
global live depth: 2
per-target live depth: 1
prepared targets only
one batch per distinct target
one shared host/time RAM reservation calendar
JIT stage dispatch
one Port 14 consumer/router
Port 15 completion publication
no dynamic live depth promotion yet
```

The real prototype refuses to start while the single-target pipeline runner, serialized batch runner, or persistent multi-target simulator is active. It is not yet controller-integrated and is intended only for explicit terminal validation.

## Port 18 — dedicated prepper / reserved-host state

Published by `hacking/prepper.js` with model:

```text
DEDICATED_TARGET_PREPPER_V1
```

`lib/execution.js` treats a Port 18 reservation as active only while its heartbeat is fresh. A fresh reserved host is excluded from normal production capacity.

## Port 19 — rolling real batch safety history

Published by `hacking/batch-history.js` with model:

```text
ROLLING_BATCH_HISTORY_V2_PIPELINE_EVIDENCE
```

A clean sample requires correct stage order, zero missing timing jobs, >=99.5% money recovery, <=+0.05 security, <=150 ms maximum absolute landing error, and >=75 ms minimum observed spacing.

Higher depth recommendations require consecutive clean pipeline-style samples:

```text
0-1 consecutive clean -> depth 1 / UNPROVEN
2-3 consecutive clean -> depth 2 / LOW
4-7 consecutive clean -> depth 4 / MEDIUM
8+ consecutive clean  -> depth 8 / HIGH
```

The persistent simulator may use these recommendations, but the first real multi-target executor deliberately ignores higher recommendations and remains hard-capped at one live batch per target.

## GUI rule

React callbacks only update local/plain-JS request state. Netscript port/file I/O stays in the asynchronous dashboard loop.
