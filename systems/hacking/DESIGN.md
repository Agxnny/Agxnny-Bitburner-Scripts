# Hacking System — Design

## Authority

This document refines the root repository `DESIGN.md` for the Hacking subsystem. The root `DESIGN.md` remains authoritative if the two conflict.

Detailed strategy logic is intentionally deferred until Hacking becomes the active implementation feature.

## Purpose

> Convert available compute resources into reliable hacking income as efficiently as practical, while maintaining targets in appropriate money/security states and respecting scheduler resource allocations.

Hacking is the stack's highest baseline productive priority.

## Responsibilities

The Hacking System owns:

- target eligibility/discovery through shared state;
- target selection;
- target tuning;
- server preparation;
- hack/grow/weaken planning;
- thread/RAM calculation within its allocation;
- execution scheduling;
- hacking workers;
- hacking-specific telemetry and validation;
- recovery from actual target state after failures.

## Non-Responsibilities

The Hacking System does not own:

- global RAM allocation between major systems;
- purchased-server lifecycle decisions;
- stock trading decisions;
- progression decisions;
- repository updates;
- duplicate network/data acquisition when valid shared state already exists.

## Internal Structure

Conceptually:

```text
Hacking System
├── Target Discovery / Eligibility
├── Target Selection
├── Target Tuning
├── Preparation Manager
├── Execution Scheduler
├── RAM / Thread Calculator
└── Workers
    ├── hack
    ├── grow
    └── weaken
```

Exact module names and file layout may change during implementation if responsibility boundaries are preserved.

## Target Selection vs Target Tuning

These are separate responsibilities.

Target Selection answers:

> Which server or servers should be attacked?

Target Tuning answers:

> How should each selected target be attacked?

Scoring formulas, target counts, hack percentage, preparation tolerances, and tuning algorithms remain deferred until implementation/testing.

## Preparation

The Preparation Manager is responsible for bringing a target into a suitable starting state before normal income execution.

Conceptually, it reacts to actual target money/security state rather than assuming previous operations succeeded.

Exact thresholds and preparation algorithm remain deferred.

## Execution Workers

Workers should remain small and deterministic.

Conceptually:

```text
hack worker   → perform supplied hack operation
grow worker   → perform supplied grow operation
weaken worker → perform supplied weaken operation
```

Workers must not independently select targets, scan the network, recalculate global strategy, or make scheduler resource-policy decisions.

## Scheduler Relationship

The active scheduler supplies Hacking with an approved compute/resource boundary.

Hacking decides how to use its allocation for domain work.

The scheduler should not issue low-level strategy such as which server to hack or exact worker thread counts.

Hacking should report summarized state/health/resource demand through the standard scheduler communication contract.

## Authority / Target Ownership

The Hacking System normally owns autonomous hacking decisions for targets under its management.

The global scheduler authority mechanism may temporarily transfer decision authority for a target to another approved subsystem, such as a future stock-manipulation controller.

While another subsystem holds authority for a target, normal Hacking logic must not autonomously schedule conflicting operations against that target.

The authority holder may issue explicit directed hacking operations through Hacking so that existing execution machinery can be reused without returning autonomous authority.

When control returns to Hacking, it must re-read/reconcile the actual target state before resuming autonomous behavior.

Exact claim, directed-command, and coordination protocols remain deferred.

## Low-RAM Behavior

Low-RAM hacking should favor productive income, reliability, and minimal control overhead over sophisticated scheduling.

It may use simpler target selection/execution, fewer targets, and less expensive calculations while retaining the same architectural boundaries and worker model where practical.

## Full-Stack Behavior

Full Stack may justify more sophisticated scheduling, tighter timing, richer target tuning, multiple concurrent targets, or HWGW-style execution when those mechanisms can be observed, tested, and shown to provide value.

Complexity must not be introduced merely because the resources exist.

## Failure / Recovery

The Hacking System must recover from actual target state rather than assuming scheduled operations succeeded.

Conceptually:

```text
operation/batch failure
        ↓
re-read actual target state
        ↓
RECOVERING / PREPARING as required
        ↓
restore suitable state
        ↓
resume income operation
```

A mistimed or failed worker should not automatically collapse unrelated parts of the Hacking System.

## Telemetry

Potential telemetry includes:

- current target(s);
- state such as PREPARING / RUNNING / RECOVERING;
- allocated and used RAM;
- requested RAM;
- thread counts;
- expected vs actual action timing;
- expected vs actual money/security changes;
- income and income/sec;
- active operations/batches;
- drift/collisions;
- worker failures;
- recovery events.

## Deferred Implementation Details

Intentionally deferred until implementation and validation:

- target scoring formula;
- single vs multi-target policy;
- preparation tolerances;
- hack percentage/tuning formula;
- HWGW/batch timing algorithm;
- thread mathematics and rounding policy;
- worker launch distribution;
- scheduling offsets/drift correction;
- income optimization algorithm.
