# Augmentation Progression Subsystem — Design

## Authority

This document refines `systems/progression/DESIGN.md` and the root `DESIGN.md`. Higher-level design documents remain authoritative if conflicts exist.

This subsystem contains separate planning and purchase-execution responsibilities. They must remain logically distinct even if early implementation shares files for RAM efficiency.

## Purpose

> Determine which augmentations should be pursued, resolve their prerequisites and acquisition order, and execute only explicitly approved purchases after fresh validation and capital authorization.

## Planning Responsibilities

Augmentation Planning owns:

- candidate augmentation evaluation;
- strategic relevance/value assessment;
- prerequisite resolution;
- faction/reputation/money requirement publication;
- acquisition-path planning;
- purchase-order planning;
- readiness classification;
- planning telemetry and validation.

Planning decides what should be pursued and in what order. It does not directly perform irreversible purchases.

Plans must distinguish strategic desirability from present feasibility.

## Purchase Responsibilities

Augmentation Purchase owns:

- receiving an approved purchase sequence;
- revalidating availability, prerequisites, reputation, ownership, price, and capital authorization immediately before execution;
- preserving approved order unless replanning occurs;
- executing purchases;
- reconciling observed state after each purchase;
- reporting partial execution clearly;
- stopping and returning to planning when material conditions change.

> A previously valid purchase plan is not sufficient authority to buy; execution-time state and capital authorization must still be valid.

## Capital Boundary

Progression may request the money needed for an augmentation plan. The Scheduler owns global capital policy and may approve, deny, or defer that request.

Purchase execution must not exceed the granted capital boundary.

## Failure and Partial Execution

Changed price, lost availability, missing prerequisite, insufficient granted capital, or unexpected ownership state must trigger reconciliation/replanning rather than improvisation.

If part of a sequence succeeds and a later purchase fails, the subsystem must report the resulting partial state and rebuild the plan from observed reality.

Manual player purchases must be reconciled rather than treated as impossible or automatically repeated.

## Modes

Low-RAM planning should be periodic/on-demand and focus on meaningful current opportunities. Purchase execution should be short-lived/event-driven.

Full Stack may support deeper prerequisite graphs, multi-faction acquisition paths, purchase-order optimization, cost/time estimates, dynamic reprioritization, and richer telemetry where justified.

## Telemetry

Useful planning telemetry includes candidate augmentations, recommended targets, planned order, blockers, faction/rep/money needs, readiness, and last plan revision.

Useful purchase telemetry includes active plan/version, current purchase, expected/actual price, capital authorization, purchase result, remaining sequence, partial state, and last failure.

## Validation

Validation should prove that readiness reflects observed prerequisites, purchase order is preserved, execution cannot exceed capital authorization, changed conditions stop the sequence safely, partial execution reconciles correctly, and manual purchases are handled from observed state.

## Deferred

Exact augmentation valuation, prerequisite-graph representation, purchase-order optimization, readiness vocabulary, capital reservation mechanics, and automation thresholds remain deferred.
