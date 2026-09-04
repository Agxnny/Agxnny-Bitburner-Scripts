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

Expected successful behavior on a prepared target:

```text
[BATCH] COMPLETE <target> | ...
[BATCH] Final money 100.0% | security +0.000
```

This proved the timing/landing mechanism can work on a simple prepared target.

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

## Latest automatic batch observation

Live observation on 2026-09-05 before the security-calculation fix:

```text
target: sigma-cosmetics
batch status: COMPLETE
threads: 25H / 1W / 298G / 1W
final money: 100%
final security: +1.13 above minimum
```

After review, controller state showed:

```text
SECURITY_PREP / WEAKEN
1 active worker job
23 active weaken threads
```

Interpretation:

- automatic batch launch works;
- full batch completes;
- money recovery works;
- post-batch review barrier works;
- controller safety repair works;
- the original batch W2 security calculation was under-sized.

## Batch security compensation fix

Root cause was the batch runner calling:

```text
ns.growthAnalyzeSecurity(growThreads, target, 1)
```

Supplying `target` makes Bitburner cap the result to the grow threads currently needed to reach max money. The batch planner runs while the target is prepared at max money, so this incorrectly predicted effectively zero security from the future post-hack grow stage and produced a one-thread W2.

The corrected batch calculation is:

```text
ns.growthAnalyzeSecurity(growThreads)
```

This estimates the uncapped security increase from every planned grow thread, which is the quantity W2 must compensate.

## Current highest-priority batch test

Pull the latest `main`, restart the stack, and validate the corrected W2 calculation in live automatic batching:

```text
run gitpull.js
run startup.js
```

Then confirm:

```text
W2 thread count scales with G thread count
final money returns to intended baseline
final security is approximately +0.00–0.05
no standalone correction weaken is required
```

Run several consecutive batches before declaring the fix stable. If security still drifts, capture the H/W1/G/W2 thread counts and final security delta before changing timing or adding pipelining.

The next instrumentation step should record:

```text
predicted hack security increase
predicted grow security increase
weaken effect of W1
weaken effect of W2
predicted final security delta
actual final security delta
```

## Batch correctness acceptance criteria

Before starting pipelined/overlapping batches, aim for several consecutive automatic batches satisfying all of these:

- target starts at intended money baseline;
- security starts near minimum;
- H/W1/G/W2 all land in correct order;
- money returns to intended baseline after W2;
- security returns to approximately `+0.00–0.05`;
- no standalone correction weaken/grow is required between normal batches;
- post-batch strategic review completes once per full batch;
- batch-associated HACK does not independently trigger strategic review;
- no partial batch is left alive after launch failure.

## Timing validation before pipelining

Once security math is correct, measure timing drift.

Record for each stage:

```text
planned landing timestamp
actual completion timestamp (if practical to capture)
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
