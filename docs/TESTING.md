# Testing and Validation Guide

This project changes live automation behavior, so each major subsystem should be validated incrementally rather than assuming a successful launch means the math is correct.

## General test philosophy

Prefer this progression:

```text
syntax/load check
  ↓
manual one-shot test
  ↓
automatic single-cycle test
  ↓
repeated-cycle stability
  ↓
throughput optimization
```

Do not introduce overlapping/pipelined HWGW until the single-batch path is mathematically and operationally stable.

## After pulling code

```text
run gitpull.js
run startup.js
```

This matters because workers/support scripts execute remotely and stale copies can otherwise survive on execution hosts.

## RAM audit

After significant changes to persistent or frequently launched scripts:

```text
run diagnostics/mem-audit.js
```

Pay particular attention to worker RAM after timing instrumentation because GROW/WEAKEN now write one tiny batch-only Port 14 completion event.

## Core smoke checks

```text
run diagnostics/economy-targets.js
run diagnostics/income.js
run diagnostics/progression.js
run network/inspect.js
run network/root.js
```

## Batch security compensation validation

The original live failure on `sigma-cosmetics` used:

```text
25H / 1W / 298G / 1W
final money: 100%
final security: +1.13
```

The corrected calculation uses:

```text
ns.growthAnalyzeSecurity(growThreads)
```

Corrected live cycles used `25H / 1W / 298G / 24W` and later `25H / 1W / 299G / 24W`, returning to the expected money/security baseline without standalone correction weaken.

## Recovery-model telemetry

Port 12 retains `initial`, `predicted`, `final`, and `comparison` data while a completed batch remains current. On every `COMPLETE`, the same payload is copied to **Port 15**, which remains available after the next batch begins.

## Current highest-priority batch test: landing drift

After pulling/restarting, let at least one new automatic batch complete, then open the **Batch** tab.

The tab combines:

```text
Port 12 → current batch
Port 15 → latest completed batch
```

The retained completed result should show:

```text
landing.orderCorrect
landing.actualOrder
landing.missingJobs
landing.minimumSpacingMs
landing.maxAbsLandingErrorMs
```

Each stage should also show:

```text
plannedLandingAt
actualLandingAt
allocationSpreadMs
landingErrorMs
reportedJobs / expectedJobs
```

The planned-vs-actual timeline plots one row each for H, W1, G, and W2. Planned and actual markers should remain close. Actual to the right of planned means the stage landed late; actual to the left means early.

Interpretation:

- `orderCorrect` should be true.
- `missingJobs` should be zero.
- `actualOrder` should remain `HACK → WEAKEN_HACK → GROW → WEAKEN_GROW`.
- `minimumSpacingMs` should remain comfortably positive relative to the configured 200 ms gap.
- `maxAbsLandingErrorMs` shows the worst stage drift.
- `allocationSpreadMs` shows how widely a stage split across hosts completed.

Do not tune the 200 ms gap from a single sample. Collect several cycles and compare the worst observed drift, spread, and minimum spacing.

## Batch correctness acceptance criteria

Before starting pipelined/overlapping batches, aim for several consecutive automatic batches satisfying all of these:

- target starts at intended money baseline;
- security starts near minimum;
- H/W1/G/W2 all land in correct order;
- all expected worker timing events are reported;
- money returns to intended baseline after W2;
- security returns to approximately `+0.00–0.05`;
- no standalone correction weaken/grow is required between normal batches;
- predicted-vs-actual recovery error is understood and consistently small;
- measured minimum stage spacing leaves a reasonable margin against observed drift/spread;
- post-batch strategic review completes once per full batch;
- batch-associated HACK does not independently trigger strategic review;
- no partial batch is left alive after launch failure.

## Timing validation before pipelining

The current fixed gap is 200 ms. Compare over repeated retained completed batches:

```text
configured gap
minimum observed adjacent spacing
maximum absolute landing error
maximum within-stage allocation spread
```

If order remains correct and the worst measured timing variation leaves substantial positive spacing, keep the gap unchanged. If spacing becomes narrow or negative, investigate launch overhead, host split, and scheduler drift before adapting the gap.

## Pipelining readiness test

Only proceed after single-batch correctness and timing are stable. A pipelined scheduler will need additional validation for global RAM reservation, stage collision prevention, target-state assumptions, safe batch depth, batch-id telemetry, cancellation/recovery, and strategic-review cadence.

Important: Port 14 is currently cleared before each serialized batch. That behavior is safe only while one batch is in flight and must be redesigned before overlapping batches.

## Regression checklist after major changes

At minimum verify:

- `run startup.js` starts GUI + stack;
- all six tabs switch responsively, including the new Batch tab;
- normal HGW mode still works;
- GUI can switch to BATCH and back to HGW;
- manual target override still works;
- manual prep/hold still works;
- manual money goal still blocks automated spending;
- cloud purchase and cloud upgrade automation still execute;
- batch-associated HACK does not trigger premature planner review;
- Port 14 timing events do not affect Port 4 strategic HACK telemetry;
- Port 15 retains the latest complete result while Port 12 moves to the next batch;
- README/docs reflect the current architecture.
