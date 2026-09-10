# Recommendation / Advisory Subsystem — Design

## Authority

This document refines `systems/progression/DESIGN.md` and the root `DESIGN.md`. Higher-level design documents remain authoritative if conflicts exist.

## Purpose

> Present actionable progression recommendations derived from the same authoritative plans and state used by automation, without independently changing game state.

## Responsibilities

- aggregate current progression recommendations and blockers;
- present the highest-priority recommendation and relevant next/blocked alternatives;
- explain why a recommendation exists and what prerequisite or strategic goal it serves;
- expose current progress, blockers, dependencies, and automation eligibility;
- remain consistent with authoritative Progression planning state;
- provide telemetry and validation data for advisory behavior.

## Boundary

The advisory layer does not own progression strategy and must not recreate an independent decision engine.

> Recommendations should be derived from authoritative subsystem plans and state wherever possible rather than independently reimplementing progression logic.

It never changes game state directly.

## Advisory and Automated Operation

In advisory operation, Progression plans are surfaced to the player for manual action.

In automated operation, the same planning information should explain what automation is doing, why it is doing it, and what remains blocked or next.

Manual player decisions that differ from recommendations are not inherently failures. State should refresh and Progression should re-plan from reality.

## Recommendation Content

A useful recommendation should expose, where practical:

- recommended action;
- source subsystem;
- strategic reason;
- current progress;
- required progress;
- blockers/dependencies;
- whether it is advisory-only or automatable;
- current execution/waiting state;
- last update time.

Exact presentation vocabulary remains deferred.

## Modes

Low-RAM should expose a concise current recommendation and major blockers with minimal processing overhead.

Full Stack may expose richer dependency context, alternative paths, cost/time estimates, automation state, and deeper explanations where justified.

## Failure Behavior

A recommendation must not claim an action is available when authoritative state shows required prerequisites are missing.

If advisory information cannot be reconciled with authoritative planning state, it should be degraded/blocked rather than inventing a separate answer.

## Validation

Validation should prove that the primary recommendation agrees with authoritative Progression priority, blockers match current state, manual intervention triggers re-planning, and the subsystem performs no game-state mutation.

## Deferred

Exact recommendation priority labels, UI presentation, explanation templates, alternative-path ranking, and automation-state vocabulary remain deferred.
