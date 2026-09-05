# Runtime State and Command Contract

`lib/runtime-state.js` is the transport implementation source of truth.

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
| 16 | Single-target pipeline state | Latest-value snapshot |
| 17 | Global multi-target state | Latest-value snapshot |
| 18 | Distributed prepper state | Latest-value snapshot |
| 19 | Rolling real batch safety history | Latest-value snapshot |
| 20 | Progressive multi-target stress test | Latest-value snapshot |

## Port 1 — controller state

Execution modes are:

```text
STANDBY | HGW | BATCH | PIPELINE | MULTI
```

Startup initializes production in `STANDBY`. The distributed background prepper is independent of production mode.

Important `executionMode` fields include:

```text
mode
pending
pipelineRunning
pipelineSafetyStopped
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

A pending mode transition is an admission barrier. Existing serialized/pipeline/MULTI work drains to its safe boundary before the transition is applied.

## Port 14 — batch timing event queue

Workers emit `BATCH_STAGE_COMPLETE` events with batch/stage/job identity, threads, planned landing, finish time, and landing error.

Exactly one real batch coordinator may consume Port 14 at a time:

```text
hacking/batch-runner.js
hacking/pipeline-runner.js
hacking/multi-target-runner.js
```

The prepper, history collector, simulators, and stress coordinator do not consume Port 14.

## Port 15 — latest completed batch

Compatible serialized, pipeline, and real multi-target completions are published here. `hacking/batch-history.js` folds new completions into Port 19.

## Port 16 — single-target pipeline state

Known state families include dry-run planning, admission simulation, and the real depth-2 executor. The dashboard freshness-gates stale Port 16 state unless the controller reports the pipeline as running.

## Port 17 — global multi-target state

Current real executor model:

```text
MULTI_TARGET_EXECUTOR_V2_CONFIGURABLE_FINITE
```

Key fields:

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

Real MULTI remains conservative: distinct prepared targets only, per-target live depth 1, shared host/time RAM calendar, JIT dispatch, one Port 14 consumer/router.

## Port 18 — distributed prepper state

Published by `hacking/prepper.js` with model:

```text
DISTRIBUTED_TARGET_PREPPER_V2
```

The prepper periodically scans the shared eligible-target universe and reserves a bounded set of remote hosts for preparation. `lib/execution.js` excludes every fresh `reservedHosts[]` entry from production capacity.

Important fields:

```text
status
reason
reserveRatio
minReserveGb
maxReserveGb
reservedRamGb
reservedHost                 compatibility alias for first reserved host
reservedHosts[]              { hostname, maxRam }
targetCount
preparedCount
needsPrepCount
activeCount
activeJobs[]                 { hostname, pid, target, action, threads, startedAt }
prepTargets[]                target-preparation telemetry
demandTargets[]
nextTargets[]
completedWaves
targetRefreshAt
updatedAt
```

Each `prepTargets[]` entry includes:

```text
hostname
rank
money
maxMoney
moneyRatio
securityDelta
action                      GROW or WEAKEN
active
host
etaMs
```

The dashboard Targets view uses this list for the "Servers below max money" card. `etaMs` is advisory and may change as target state, queue position, or reserved-host capacity changes.

A Port 18 reservation is trusted only while its heartbeat is fresh; stale reservation state must not permanently remove hosts from production.

## Port 19 — rolling real batch safety history

Current model:

```text
ROLLING_BATCH_HISTORY_V2_PIPELINE_EVIDENCE
```

Clean criteria are correct order, zero missing jobs, >=99.5% money recovery, <=+0.05 security, <=150 ms maximum absolute landing error, and >=75 ms minimum spacing.

Evidence ladder:

```text
0-1 consecutive clean -> depth 1 / UNPROVEN
2-3 consecutive clean -> depth 2 / LOW
4-7 consecutive clean -> depth 4 / MEDIUM
8+ consecutive clean  -> depth 8 / HIGH
```

This is per-target overlap evidence and is separate from global distinct-target stress evidence. Real MULTI still keeps same-target depth at 1.

## Port 20 — progressive global stress state

Published by `diagnostics/multi-target-stress.js` with model:

```text
MULTI_TARGET_STRESS_V1
```

The stress coordinator starts one finite real MULTI child at a time and reads final Port 17 state before advancing concurrency. It does not consume Port 14 itself.

Key evidence from the latest validated run: distinct-target depths 2 through 5 completed cleanly; depth 6 was prep-limited rather than a batching failure.
