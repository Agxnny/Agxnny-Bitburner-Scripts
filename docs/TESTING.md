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

Recommended update/restart flow:

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

Pay particular attention to:

- `hacking/controller.js`
- `ui/dashboard.js`
- `hacking/refresh.js`
- `network/cloud-buy.js`
- `hacking/batch-runner.js`
- `hacking/tactical-planner.js`

Do not use historical RAM values after code changes; remeasure.

## Core smoke checks

Useful commands:

```text
run diagnostics/economy-targets.js
run diagnostics/income.js
run diagnostics/progression.js
run network/inspect.js
run network/root.js
```

The main GUI Diagnostics tab also exposes lightweight repeatable tests through the remote diagnostic launcher.

## Cloud purchase/upgrade validation

If cloud automation appears ready but does not act:

1. Check Economy tab selected goal and manual spending lock.
2. Confirm `network/cloud-buy.js` parses by running it manually if necessary.
3. Inspect Port 10 status/reason in the GUI.
4. Verify remote deployment is current.
5. Verify some remote host has enough contiguous free RAM to launch the spender.

Known historical issue: `network/cloud-buy.js` once contained a parser-invalid mixed `??`/`||` expression. That was fixed; if a future action silently fails to launch, check syntax/RAM calculation early rather than assuming the advisor is wrong.

## Manual batch-runner validation

Before automatic batch integration, the single-run command was validated with:

```text
run hacking/batch-runner.js n00dles 0.10 200 1
```

Expected safety behavior on an unprepared target:

```text
[BATCH] BLOCKED: Target security is ...; batch requires prepared security
```

Expected successful behavior on a prepared target now includes predicted-vs-actual output:

```text
[BATCH] COMPLETE <target> | ...
[BATCH] Predicted money ... | security ...
[BATCH] Actual    money ... | security ...
[BATCH] Error     money ... | security ...
```

## Automatic batch-mode validation

From the GUI:

```text
Overview
  → Execution mode
  → Use batched HWGW
```

Expected controller statuses over time:

```text
BATCH_GROW / BATCH_WEAKEN preparation as required
        ↓
BATCH_READY
        ↓
BATCH_RUNNING
        ↓
BATCH_REVIEW
        ↓
BATCH_READY or correction prep
```

The controller should never launch the next batch while `awaitingReview` is true.

## Batch security compensation validation

The original live failure on `sigma-cosmetics` used:

```text
25H / 1W / 298G / 1W
final money: 100%
final security: +1.13
```

The cause was `growthAnalyzeSecurity(growThreads, target, 1)` being capped by the target's current prepared state. The corrected calculation uses:

```text
ns.growthAnalyzeSecurity(growThreads)
```

The first corrected live cycle used:

```text
25H / 1W / 298G / 24W
final money: 100%
final security: 3.00 / 3.00
standalone correction weaken: not required
```

A following automatic cycle continued to size W2 at 24 threads with 299 grow threads. The sizing defect is considered sufficiently validated to continue instrumentation, but continued observation should still flag any return to one-thread W2 or recurring repair prep.

## Current highest-priority batch test: recovery-model telemetry

After pulling the latest `main`, restart:

```text
run gitpull.js
run startup.js
```

Let several automatic batches complete. Port 12 batch state version 2 now records `initial`, `predicted`, `final`, and `comparison` recovery data.

For each completed batch, validate:

```text
predicted.finalMoneyPercent
final.moneyPercent
comparison.moneyPercentError

predicted.finalSecurityDelta
final.securityDelta
comparison.securityDeltaError
```

Also inspect the component security effects:

```text
predicted.hackSecurityIncrease
predicted.growSecurityIncrease
predicted.weakenHackEffect
predicted.weakenGrowEffect
```

Expected behavior is small, stable predicted-vs-actual error. A large money error suggests growth/recovery modeling or landing-order problems. A large security error suggests stage ordering, missing/effective thread mismatch, or security-effect assumptions.

Do not tune the 200 ms landing gap solely because one recovery error appears. First collect multiple cycles and separate math error from timing error.

## Batch correctness acceptance criteria

Before starting pipelined/overlapping batches, aim for several consecutive automatic batches satisfying all of these:

- target starts at intended money baseline;
- security starts near minimum;
- H/W1/G/W2 all land in correct order;
- money returns to intended baseline after W2;
- security returns to approximately `+0.00–0.05`;
- no standalone correction weaken/grow is required between normal batches;
- predicted-vs-actual recovery error is understood and consistently small;
- post-batch strategic review completes once per full batch;
- batch-associated HACK does not independently trigger strategic review;
- no partial batch is left alive after launch failure.

## Timing validation before pipelining

Once recovery telemetry is stable, add actual stage completion timing.

Record for each stage:

```text
planned landing timestamp
actual completion timestamp
landing error
stage ordering
```

Then decide whether the fixed 200 ms gap is sufficiently robust or should be adaptive.

Do not reduce the gap aggressively until measured drift is available.

## Pipelining readiness test

Only proceed after single-batch correctness is stable.

A pipelined scheduler will need additional validation for:

- total reserved RAM across all in-flight batches;
- stage collision prevention;
- target state assumptions while multiple batches are in flight;
- safe maximum concurrent batch depth;
- batch id/stage telemetry;
- cancellation and recovery after partial failure;
- strategic review cadence that does not run after every individual in-flight hack.

## Regression checklist after major changes

At minimum verify:

- `run startup.js` starts GUI + stack;
- normal HGW mode still works;
- GUI can switch to BATCH and back to HGW;
- manual target override still works;
- manual prep/hold still works;
- manual money goal still blocks automated spending;
- cloud purchase and cloud upgrade automation still execute;
- new port tools are detected and newly rootable servers join the pool;
- batch-associated HACK does not trigger premature planner review;
- README/docs reflect the current architecture.
