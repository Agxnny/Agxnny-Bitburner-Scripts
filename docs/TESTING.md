# Testing and Validation Guide

Validate incrementally rather than assuming a successful launch means the timing and recovery math are correct.

## General progression

```text
syntax/load check
  ↓
one-shot dry run
  ↓
persistent non-executing simulation
  ↓
serialized live HWGW
  ↓
real depth-2 pair
  ↓
repeated depth-2 stability
  ↓
controller integration / throughput optimization
```

Maximum real depth stays at 2 until repeated timing/recovery results are healthy.

## After pulling code

```text
run gitpull.js
run startup.js
run diagnostics/mem-audit.js
```

The compact GUI should load with all six tabs responsive. Overview should contain fewer repeated panels than before, and the Batch tab should show Port 16 pipeline state when available.

## Core smoke checks

```text
run diagnostics/economy-targets.js
run diagnostics/income.js
run diagnostics/progression.js
run network/inspect.js
run network/root.js
```

## Active-worker ETA validation

During normal/prep H/G/W work, Overview should show the Active Workers card only while workers exist. Rows should show action/target, host, thread count, and ETA/status.

`LATE` remains diagnostic only and must not kill workers.

## Execution-mode and prep controls

Quick Controls combines HGW/BATCH selection with Prep + hold and Resume auto.

Verify:

- HGW ↔ BATCH still waits for a safe boundary;
- mode buttons disable while a transition is pending;
- Prep + hold reaches `PREPARED HOLD`;
- Resume auto returns to the selected controller mode;
- React tab/control clicks remain responsive and do not kill the dashboard script.

## Serialized batch correctness

A healthy serialized completion should satisfy:

- correct H → W1 → G → W2 order;
- `landing.missingJobs === 0`;
- money returns to intended baseline;
- security returns to approximately +0.00–0.05;
- no standalone correction work is normally required;
- predicted-vs-actual recovery error remains small/understood.

Keep the requested stage gap at 200 ms until repeated depth-2 evidence supports any reduction.

## Pipeline planner validation

```text
run hacking/batch-scheduler.js phantasy 0.10 200
```

Verify:

- no workers are launched;
- Port 16 model is `PIPELINE_DRY_RUN_V2_HOST_WINDOWS`;
- timing-only and RAM-sustainable intervals are both visible;
- host-window reservation failure reports the blocked batch/stage;
- live used RAM is treated conservatively.

## Virtual depth-2 admission validation

```text
run hacking/batch-scheduler.js phantasy 0.10 200 admission
```

Expected virtual progression:

```text
ADMITTED
INTERVAL_WAIT
ADMITTED
DEPTH_CAP
DRAIN
```

Acceptance checks:

- `admission.maxDepth === 2`;
- `admission.inFlight <= 2` always;
- no H/G/W PID is created;
- insufficient capacity produces `RAM_BLOCKED`;
- bad matching Port 15 telemetry produces `SAFETY_STOP`;
- Port 16 keeps updating even if the terminal is not visibly tailing.

Use the Batch GUI for live Port 16 observation rather than relying on automatic terminal scrolling.

## First real depth-2 pipeline test

### 1. Park the controller

Choose the intended target and click **Prep + hold** in Overview. Wait until:

```text
header badge: PREP HOLD
active workers: none
serialized batch: idle
money: >= 99.5%
security: <= min + 0.05
```

Do **not** click Resume auto while the pipeline runner is active.

### 2. Run exactly two batches

```text
run hacking/pipeline-runner.js phantasy 0.10 200 2
```

Preflight should either start the real test or clearly block with a reason. A blocked preflight must launch zero H/G/W workers.

### 3. Observe Port 16 in the Batch tab

Expected state:

```text
PIPELINE: REAL DEPTH-2
max depth: 2
in flight: 1 → 2 → 1 → 0
completed: 0/2 → 1/2 → 2/2
safety: OK
```

The runner uses a finite wave of at most two real batches. It may compute a batch interval larger than 800 ms from current RAM capacity.

### 4. Validate BOTH completed batches

For each completion, verify:

```text
landing.orderCorrect === true
landing.missingJobs === 0
landing.actualOrder === HACK → WEAKEN_HACK → GROW → WEAKEN_GROW
final.moneyPercent >= 0.995
final.securityDelta <= 0.05
```

Also record:

```text
landing.minimumSpacingMs
landing.maxAbsLandingErrorMs
landing.stages[].allocationSpreadMs
landing.stages[].landingErrorMs
```

The Batch tab's planned-vs-actual graph should continue to work because each pipeline completion is copied to Port 15.

### 5. Expected safety behavior

Any of the following must stop new waves:

- `ns.exec` launch failure;
- incorrect landing order;
- missing timing event;
- final money below 99.5%;
- final security above +0.05;
- target outside prepared tolerance after a wave.

Port 16 should end in `SAFETY_STOP` with a reason. Already-launched work is allowed to drain; merely late workers are not killed automatically.

## Repeated depth-2 testing

Only after the first pair is healthy, repeat several runs with `batchCount=2`.

Do not jump directly to higher live depth. Once repeated pairs are stable, a larger **total batch count** may be tested, but the runner still executes them in depth-2 waves.

Compare across runs:

```text
worst minimum spacing
worst absolute landing drift
worst allocation spread
money/security recovery
missing-event count
launch failures
```

## Port 14 ownership regression

The real pipeline runner may only be used while serialized batching is parked.

During a real test:

- Port 14 is consumed centrally by `pipeline-runner.js`;
- events are routed by `batchId`;
- the queue is not cleared between the two overlapping batches.

Do not run `hacking/batch-runner.js` concurrently because it still clears Port 14 before a serialized batch.

## Regression checklist

At minimum verify:

- startup launches compact GUI + stack;
- all six tabs remain responsive;
- normal HGW and serialized BATCH modes still work;
- Quick Controls still switch modes and prep/resume correctly;
- Active Workers appears only when useful and clears naturally;
- manual target and money-goal controls still work;
- Batch tab displays serialized, simulation, and real-pipeline Port 16 state correctly;
- Port 15 displays the latest serialized or pipeline completion;
- planned-vs-actual timing graph still renders;
- Port 14 does not interfere with Port 4 strategic HACK telemetry;
- real pipeline test never exceeds depth 2;
- watchdog termination remains disabled;
- docs reflect current architecture.
