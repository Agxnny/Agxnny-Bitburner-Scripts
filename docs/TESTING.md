# Testing and Validation Guide

This project changes live automation behavior, so validate incrementally rather than assuming a successful launch means the math is correct.

## General progression

```text
syntax/load check
  ↓
one-shot dry run
  ↓
persistent non-executing simulation
  ↓
automatic single-cycle live test
  ↓
repeated-cycle stability
  ↓
throughput optimization
```

Do not enable overlapping live HWGW until the serialized path and depth-2 simulation are understood.

## After pulling code

```text
run gitpull.js
run startup.js
run diagnostics/mem-audit.js
```

## Core smoke checks

```text
run diagnostics/economy-targets.js
run diagnostics/income.js
run diagnostics/progression.js
run network/inspect.js
run network/root.js
```

## Active-worker ETA validation

During normal/prep H/G/W work, Overview should show active jobs/threads, current ETA, and worker rows with host, threads, elapsed time, and remaining estimate.

`LATE` is diagnostic only and must not kill workers.

## Execution-mode transition validation

Switch HGW ↔ BATCH while workers are active. Expected behavior:

- both mode buttons disable during transition;
- GUI shows `SWITCHING → <mode>`;
- no new target-side work is scheduled;
- existing H/G/W/batch work finishes naturally;
- the requested mode applies at the safe boundary.

## Serialized batch correctness

A healthy completed batch should satisfy:

- correct H → W1 → G → W2 order;
- `landing.missingJobs === 0`;
- money returns to intended baseline;
- security returns to approximately +0.00–0.05;
- no standalone correction work is normally required;
- predicted-vs-actual recovery error remains small/understood.

The Batch tab should expose planned/actual stage timing, minimum spacing, maximum drift, allocation spread, and recovery comparison.

Do not reduce the 200 ms stage gap from one sample.

## Pipeline scheduler one-shot validation

Run:

```text
run hacking/batch-scheduler.js phantasy 0.10 200
```

Verify:

- no workers are launched;
- Port 16/state reports `PIPELINE_DRY_RUN_V2_HOST_WINDOWS`;
- requested timing-only interval and RAM-sustainable interval are distinct when capacity requires it;
- burst depth stops at the first host-window reservation failure;
- blocked output names the batch/stage when possible;
- current live serialized work lowers reported available RAM rather than being assumed free later.

A previous `phantasy` sample found roughly 800 ms timing-only versus 6280 ms sustainable, with burst depth 16 and batch 17 blocked at HACK. Treat this as a point-in-time reference only.

## Depth-2 admission simulation validation

Run alongside serialized production:

```text
run hacking/batch-scheduler.js phantasy 0.10 200 admission
```

This must remain non-executing. Confirm the log/state explicitly says dry run and `launchesWorkers: false`.

Expected state progression when the initial target is prepared and RAM permits:

```text
ADMITTED (virtual batch 1)
  ↓
INTERVAL_WAIT
  ↓
ADMITTED (virtual batch 2)
  ↓
DEPTH_CAP
  ↓
DRAIN (oldest reaches planned W2)
  ↓
next virtual admission may occur
```

Acceptance checks:

- `admission.maxDepth === 2` always;
- `admission.inFlight` never exceeds 2;
- no H/G/W PID is created by the simulator;
- initial admission waits at `WAITING_PREP` if money/security are not prepared;
- after the virtual pipeline opens, temporary raw target money/security changes do not incorrectly gate every new batch;
- current remote RAM is rechecked before each virtual admission;
- insufficient host-window capacity produces `RAM_BLOCKED` instead of admission;
- the second virtual admission respects the tuned sustainable interval;
- virtual batches leave the in-flight set only at planned final W2 landing.

## Admission safety-stop validation

Admission mode watches new matching Port 15 completed batches. A healthy new completed batch should not stop admissions.

A safety stop is expected if a newly observed matching completion has any of:

- bad landing order;
- missing timing events;
- money recovery error > 0.5 percentage points;
- security recovery error > 0.05;
- final money < 99.5%;
- final security > +0.05.

When stopped:

```text
admission.safetyStopped === true
admission.decision.status === SAFETY_STOP
```

No new virtual batch may be admitted, while already-admitted virtual batches continue to drain. Restart the simulator to clear the stop; automatic recovery/reset is intentionally not implemented yet.

## Before live depth-2 execution

Do not launch overlapping real batches until all of the following are complete:

- repeated serialized timing/recovery samples are stable;
- rolling timing history exists;
- Port 14 clearing is removed and one multi-batch-safe consumer routes events by `batchId`;
- host-window reservations are reused as actual launch allocations;
- partial launch rollback is atomic;
- strategic review becomes pipeline-aware;
- depth-2 admission/safety behavior has been exercised in simulation.

## Regression checklist

At minimum verify:

- startup launches GUI + stack;
- all six GUI tabs remain responsive;
- normal HGW and serialized BATCH modes still work;
- mode transitions remain safe;
- Active Workers/ETA state appears and clears correctly;
- manual target/prep/money-goal controls still work;
- Port 14 does not interfere with Port 4 strategic HACK telemetry;
- Port 15 retains latest completed batch;
- Port 16 reflects scheduler snapshot or admission simulation state;
- admission simulation creates no real worker processes;
- docs reflect the current architecture.
