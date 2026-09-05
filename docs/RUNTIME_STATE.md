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
| 20 | Progressive multi-target stress test | Latest-value snapshot |

## Port 1 — controller state

Current execution modes:

```text
STANDBY | HGW | BATCH | PIPELINE | MULTI
```

Startup initializes the production controller in `STANDBY`. The background prepper is independent of production mode, so STANDBY may still show grow/weaken maintenance on the dedicated reserved prep host.

`MULTI` is controller-managed repeated finite multi-target waves. It does not enable same-target overlap; per-target depth remains 1.

Controller `executionMode` also publishes:

```text
multiRunning
multiRunnerHost
multiSafetyStopped
multiConfig { profile, targetCount, globalDepth, hackFraction, stageGapMs }
```

## Port 13 — controller requests

```text
PREP_TARGET
RESUME_AUTO
SET_MANUAL_TARGET
CLEAR_MANUAL_TARGET
SET_EXECUTION_MODE STANDBY|HGW|BATCH|PIPELINE|MULTI
START_MULTI { profile, targetCount, globalDepth, hackPercent, stageGapMs }
```

`START_MULTI` validates and stores the requested multi-target configuration, then transitions the controller to MULTI at the next safe boundary. If MULTI is already active, the new configuration applies to the next wave.

Mode changes wait for a safe boundary. A pending transition stops new admissions. If a multi-target wave is active, the controller waits for that finite wave to finish rather than killing it.

`RESUME_AUTO` clears a MULTI safety stop as well as the existing pipeline/prep hold states.

## Port 14 — batch timing event queue

Workers emit `BATCH_STAGE_COMPLETE` events with batch/stage/job identity, threads, planned landing, finish time, and landing error.

Exactly one real coordinator may own Port 14 at a time. Current real consumers are:

```text
hacking/batch-runner.js
hacking/pipeline-runner.js
hacking/multi-target-runner.js
```

The real multi-target executor routes Port 14 events by unique `batchId` to independent target batches. Planning-only multi-target scripts, the prepper, batch-history collector, and stress-test coordinator do not consume Port 14.

## Port 15 — latest completed batch

Port 15 accepts compatible serialized, single-target pipeline, and real multi-target completion payloads. It remains latest-only. `hacking/batch-history.js` watches this snapshot and folds genuinely new completed batches into Port 19.

Multi-target executor V2 generates a unique run ID on every invocation and unique batch IDs inside that run, preventing legitimate repeated waves from being discarded as duplicate history samples.

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

Current real finite executor:

```text
MULTI_TARGET_EXECUTOR_V2_CONFIGURABLE_FINITE
```

The same finite executor is used for manual/GUI tests, controller-managed MULTI waves, and the progressive stress-test harness. Manual/stress-runner child waves require controller STANDBY; controller-owned runs carry `--controller` and require controller mode MULTI.

Real execution remains deliberately conservative:

```text
globalLiveDepthCap: configurable 2-12
perTargetLiveDepthCap: 1
prepared targets only
one batch per distinct target
one shared host/time RAM reservation calendar
JIT stage dispatch
one Port 14 consumer/router
Port 15 completion publication
unique runId + batchId
```

Important V2 state fields include:

```text
controllerOwned
runId
profile
status
reason
globalLiveDepthCap
perTargetLiveDepthCap
admittedTargets[]
inFlight[]
completed[]
updatedAt
```

Controller behavior after a wave exits:

```text
COMPLETE    -> admit another wave after re-evaluation/retry delay
BLOCKED     -> retry later (for example while targets are still being prepped)
SAFETY_STOP -> halt new MULTI admissions until Resume
unexpected  -> halt admissions for review
```

Each completion's landing summary includes aggregate `expectedJobs`, `reportedJobs`, `missingJobs`, and `totalMissingJobs`, plus per-stage order, drift, spacing, and allocation spread.

## Port 18 — dedicated prepper / reserved-host state

Published by `hacking/prepper.js` with model:

```text
DEDICATED_TARGET_PREPPER_V1
```

`lib/execution.js` treats a Port 18 reservation as active only while its heartbeat is fresh. A fresh reserved host is excluded from normal production capacity.

The dedicated prepper is especially important in MULTI mode and stress testing because a BLOCKED wave caused by too few prepared top-ranked targets can be retried later without weakening the prepared-target gate.

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

The persistent simulator may use these recommendations, but controller MULTI still ignores higher same-target recommendations and remains hard-capped at one live batch per target.

## Port 20 — progressive multi-target stress test

Published by `diagnostics/multi-target-stress.js` with model:

```text
MULTI_TARGET_STRESS_V1
```

The stress coordinator itself never consumes Port 14 and never launches workers directly. It starts exactly one finite `hacking/multi-target-runner.js` child at a time, waits for that child to exit, then reads the final Port 17 executor state before deciding whether to advance concurrency.

Important fields:

```text
status
reason
config { profileMode, maxDepth, wavesPerDepth, targetCount, hackFraction, stageGapMs, prepWaitMinutes }
startedAt
finishedAt
currentDepth
currentWave
currentProfile
runnerPid
waveStatus
highestCleanDepth
depthCleanWaves
totalCleanWaves
blockedRetries
maxObservedDriftMs
minObservedSpacingMs
uniqueTargets[]
results[]
updatedAt
```

Stress states include:

```text
RUNNING
WAITING_PREP
PASS
BLOCKED
BLOCKED_TIMEOUT
SAFETY_STOP
FAILED
ABORTED
```

The test begins at distinct-target depth 2 and only increments after every requested wave at the current depth is clean. `mixed` mode rotates MONEY, BALANCED, and XP profiles to broaden target coverage. Any safety failure stops escalation. BLOCKED child waves may be retried while the prepper catches up, up to the configured timeout.

Port 20 is advisory/test telemetry only. A high clean stress depth does not automatically alter controller MULTI configuration or same-target depth caps.

## GUI rule

React callbacks only update local/plain-JS request state. Netscript port/file/process I/O stays in the asynchronous dashboard loop.

The Batch tab exposes both a one-shot **Finite wave** button and a **Start controller / Update controller** button using the same profile/target/depth/hack/gap fields. Quick Controls also includes a Multi button using those current fields.

All content/hero cards remain collapsible with React-local collapse state.

The progressive stress test is currently terminal-driven while its backend behavior is validated. Port 20 exists specifically so a compact GUI stress card can be added without changing the test contract later.
