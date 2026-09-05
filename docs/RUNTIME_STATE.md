# Runtime State and Command Contract

The project uses Netscript ports as lightweight shared transport between persistent and short-lived services. `lib/runtime-state.js` is the implementation source of truth.

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
| 16 | Pipeline scheduler/admission state | Latest-value snapshot |

Snapshot writers replace the prior value. Ports 13 and 14 are queues.

## Port 1 — controller state

Published by `hacking/controller.js`. Important concepts include current target, money/security, tactical state, execution-pool summary, prep state, target control, execution mode, and standalone worker observability.

### `executionMode`

```text
mode: HGW | BATCH
pending
transitioning
transitionTarget
batchGapMs
batchRunning
batchRunnerHost
awaitingReview
batchCompletedAt
lastBatchId
lastMessage
```

### `execution.activeWorkers`

Standalone/prep H/G/W allocations include:

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

`execution.currentAction` contains the aggregate action/target/start/expected-finish summary used for ETA display. GUI `LATE` status is observational only; no automatic worker killing is enabled.

## Ports 2–11

- Port 2: planner/rankings/execution hosts.
- Port 3: tactical plan.
- Port 4: HACK completion queue used by strategic/income telemetry.
- Port 5: income telemetry.
- Port 6: diagnostic requests.
- Port 7: economy/progression.
- Port 8: economic target/review freshness.
- Port 9: rooting/tool state.
- Port 10: cloud-capacity actions.
- Port 11: manual money-goal/spending lock.

## Port 12 — current serialized batch

Published by `hacking/batch-runner.js` using schema version 3 / model `SINGLE_HWGW_ADDITIONAL_MSEC_V3`.

Lifecycle is typically:

```text
PLANNING → BLOCKED
or
READY → RUNNING → COMPLETE
```

`LAUNCH_FAILED` is used when partial startup must be cancelled.

Important fields include batch id, target, thread counts, stage allocations, planned timings, recovery model, final state, comparison errors, and landing telemetry.

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

For split stages, `actualLandingAt` is the last allocation completion and `allocationSpreadMs` is the earliest-to-latest completion spread.

## Port 13 — controller requests

Current commands:

```text
PREP_TARGET
RESUME_AUTO
SET_MANUAL_TARGET
CLEAR_MANUAL_TARGET
SET_EXECUTION_MODE HGW|BATCH
```

## Port 14 — batch timing event queue

Batch H/G/W workers publish `BATCH_STAGE_COMPLETE` events containing batch/stage/job identity, threads, planned landing, and actual finish timing.

The current serialized runner drains this queue and clears it before each real batch. That clearing rule is **not compatible with overlapping batches** and must be removed before live pipelining.

## Port 15 — latest completed batch

Every serialized `COMPLETE` payload is copied here so the GUI and scheduler can inspect the most recent recovery/timing result after Port 12 advances.

Port 15 is a one-item snapshot, not a rolling history.

## Port 16 — pipeline scheduler / admission simulation

Published by `hacking/batch-scheduler.js`.

### Snapshot planning mode

One-shot planning currently uses model `PIPELINE_DRY_RUN_V2_HOST_WINDOWS` and includes:

```text
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

Key timing fields:

```text
timing.requestedStageGapMs
timing.tunedStageGapMs
timing.requestedBatchIntervalMs
timing.tunedBatchIntervalMs
timing.firstLandingDelayMs
timing.batchLandingWindowMs
timing.tuningMode
timing.telemetry
timing.steadyState
```

Key RAM fields include currently free remote RAM, host count, single-batch RAM, burst depth, depth-search status, and per-depth simulations.

### Persistent admission simulation mode

When run with the fourth argument `admission`, Port 16 uses model:

```text
PIPELINE_ADMISSION_SIM_V3_DEPTH2
```

Additional fields:

```text
simulation: true
admission.enabled: true
admission.launchesWorkers: false
admission.maxDepth: 2
admission.pipelineOpened
admission.safetyStopped
admission.safetyReason
admission.inFlight
admission.nextAdmissionAt
admission.decision
admission.batches[]
admission.events[]
```

`admission.decision.status` may include:

```text
WAITING
BLOCKED
WAITING_PREP
INTERVAL_WAIT
ADMITTED
DEPTH_CAP
RAM_BLOCKED
SAFETY_STOP
```

Each virtual batch records its first/final landing time and planned H/W1/G/W2 stage windows. No PID or live worker is created.

New matching Port 15 completed-batch telemetry can trigger `SAFETY_STOP` when order, timing-event completeness, or recovery is outside the simulator tolerances. A stop blocks further virtual admissions but leaves existing virtual batches to drain.

Port 16 remains advisory/non-executing. No controller currently consumes it to launch overlapping work.

## Queue design rule

GUI React callbacks should only mutate plain-JS request/presentation state. Netscript port/file I/O remains in the asynchronous dashboard loop.
