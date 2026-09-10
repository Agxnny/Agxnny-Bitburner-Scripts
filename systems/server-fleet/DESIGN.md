# Purchased Server Fleet System — Design

## Authority

This document refines the root repository `DESIGN.md` for the Purchased Server Fleet System. The root `DESIGN.md` remains authoritative if the two conflict.

Exact upgrade economics, RAM tiers, reinvestment formulas, and replacement heuristics remain intentionally deferred until implementation and validation.

## Purpose

> Maintain the best practical purchased-server fleet for the current stage of the run while respecting global capital policy and exposing stable compute capacity to the rest of the stack.

## Ownership Boundary

The Fleet System exclusively owns purchased-server lifecycle decisions.

It owns:

- fleet discovery and lifecycle state;
- purchase planning;
- upgrade/replacement planning;
- naming policy;
- purchase/delete/replace execution;
- maintenance/drain coordination;
- publication of fleet capacity and health.

Other systems may consume purchased-server RAM when the Scheduler allocates it, but they must not independently buy, delete, replace, rename, or upgrade purchased servers.

Lifecycle authority and RAM usage allocation are separate concerns.

## Internal Structure

The system should be decomposed approximately as:

```text
Purchased Server Fleet System
├── Fleet Discovery
├── Capacity Evaluator
├── Purchase Planner
├── Upgrade / Replacement Planner
├── Naming Policy
├── Fleet Executor
├── Capacity Publisher
└── Telemetry / Validation
```

## Capital Contract

Fleet decides what purchase or upgrade is desirable. The Scheduler decides whether globally managed capital is available.

Conceptually:

```text
Fleet → proposed action / capital request
Scheduler → approve / deny / defer
Fleet → execute approved action
```

The Scheduler must not absorb Fleet strategy by deciding which server or RAM tier should be purchased.

## Maintenance and Replacement

Replacement must not unexpectedly destroy active workloads.

Conceptually:

```text
Fleet proposes replacement
→ request maintenance/drain authority
→ Scheduler prevents new allocations to server
→ work drains or is intentionally terminated
→ Fleet obtains exclusive lifecycle authority
→ replace server
→ publish new capacity
→ return server to allocatable pool
```

> Fleet must never delete or replace a server merely because an upgrade is desirable; required capital and lifecycle authority must be obtained first.

## Naming

Purchased-server naming policy belongs to Fleet and should be centralized. Other systems must not infer undocumented strategic meaning from server names.

## Operating Modes

### Low-RAM

Fleet behavior should be lightweight and conservative. Planning should be infrequent or on-demand, favor obvious high-value capacity improvements, and avoid persistent planning overhead that competes with hacking income.

### Full Stack

Full Stack may support richer upgrade-efficiency analysis, staged replacements, reserve-aware spending, opportunity-cost comparisons, and detailed capacity telemetry where those features justify their cost.

## Failure Behavior

Purchases or upgrades that fail because money, limits, names, or observed fleet state changed must refresh state and re-plan rather than blindly retry.

A replacement that fails after destructive action leaves the Fleet System degraded and must be reported clearly.

Fleet must reconcile observed purchased-server state after lifecycle actions instead of assuming requested operations succeeded.

## Telemetry

Potential telemetry includes:

- server count;
- total purchased RAM;
- usable purchased RAM;
- allocated RAM;
- largest/smallest server;
- next proposed action;
- estimated action cost;
- requested/approved capital;
- draining or maintenance servers;
- last lifecycle action;
- fleet health.

## Validation Expectations

Validation should prove that:

- only Fleet performs purchased-server lifecycle mutations;
- capital authorization is respected;
- active workload drain/maintenance rules are honored;
- capacity publication matches observed servers;
- failed actions cause refresh/re-plan rather than blind retry;
- Low-RAM and Full-Stack behavior respect their resource goals.

## Deferred Implementation Details

Intentionally deferred:

- exact ROI formula;
- RAM purchase tiers;
- fill-slots-versus-save policy;
- replacement order;
- minimum upgrade ratio;
- reinvestment aggressiveness;
- exact maintenance message schema;
- exact capital reservation mechanics.
