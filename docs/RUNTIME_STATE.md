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

Mode changes wait for a safe boundary. For PIPELINE, later wave admission stops and already-admitted work drains before the controller applies the new mode.

## Port 14 — batch timing event queue

Workers emit `BATCH_STAGE_COMPLETE` events with batch/stage/job identity, threads, planned landing, finish time, and landing error. Serialized BATCH and real PIPELINE remain mutually exclusive. The real pipeline coordinator owns and routes Port 14 by `batchId` while active.

Neither multi-target planning script, the prepper, nor the batch-history collector consumes Port 14.

## Port 15 — latest completed batch

Port 15 accepts compatible serialized and pipeline completion payloads. It remains latest-only. `hacking/batch-history.js` watches this snapshot and folds genuinely new completed batches into Port 19.

The collector treats the Port 15 snapshot already present at collector startup as stale/observed, requires a completion timestamp at or after collector startup, and keeps a set of previously seen batch IDs. This prevents restarts or replayed latest-value snapshots from manufacturing extra safety evidence.

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

Only targets at >=99.5% money and <=+0.05 security receive persistent production admissions. Other candidates remain `WAITING_PREP` while the Port 18 prepper works independently.

## Port 18 — dedicated prepper / reserved-host state

Published by `hacking/prepper.js` with model:

```text
DEDICATED_TARGET_PREPPER_V1
```

`lib/execution.js` treats a Port 18 reservation as active only while the heartbeat is fresh (currently 5 seconds). A fresh `reservedHost` is excluded from the normal remote execution pool. If the prepper stops and Port 18 becomes stale, the host automatically returns to production capacity.

## Port 19 — rolling real batch safety history

Published by `hacking/batch-history.js` with model:

```text
ROLLING_BATCH_HISTORY_V2_PIPELINE_EVIDENCE
```

The collector watches Port 15 for fresh `COMPLETE` batch IDs and keeps up to 16 real samples per target. Each sample records whether it came from a real pipeline completion, source model, order correctness, missing timing jobs, final money/security recovery, maximum landing drift, minimum spacing, allocation spread, gap, and batch interval.

Per-target summary fields include:

```text
sampleCount
pipelineSampleCount
cleanSamples
cleanPipelineSamples
consecutiveClean
recommendedDepth
confidence
latestHealthy
lastFinishedAt
maxAbsLandingErrorMs
minSpacingMs
maxRecoveryMoneyError
maxSecurityDelta
samples[]
```

A clean sample currently requires correct stage order, zero missing timing jobs, >=99.5% money recovery, <=+0.05 security, <=150 ms maximum absolute landing error, and >=75 ms minimum observed spacing.

Higher depth recommendations now require consecutive clean **pipeline** samples. Serialized single-batch completions may remain in history for diagnostics but cannot promote the target above depth 1.

```text
0-1 consecutive clean pipeline samples -> depth 1 / UNPROVEN
2-3 consecutive clean pipeline samples -> depth 2 / LOW
4-7 consecutive clean pipeline samples -> depth 4 / MEDIUM
8+ consecutive clean pipeline samples  -> depth 8 / HIGH
```

This is advisory only for now. The persistent simulator has not yet been wired to enforce the recommendation; that remains the next safety step before real multi-target execution.

## GUI rule

React callbacks only update local/plain-JS request state. Netscript port/file I/O stays in the asynchronous dashboard loop.
