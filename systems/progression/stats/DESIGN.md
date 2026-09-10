# Stat Growth Subsystem — Design

## Authority

This document refines `systems/progression/DESIGN.md` and the root `DESIGN.md`. Higher-level design documents remain authoritative if conflicts exist.

## Purpose

> Determine when player stats block an approved progression objective, define the required stat targets, and request appropriate growth activity without duplicating activity execution.

## Responsibilities

- consume current player stats and explicit progression requirements;
- identify unmet stat thresholds and gaps;
- publish stat-growth objectives tied to approved progression goals;
- request growth activity through Work / Activity;
- confirm objective completion from observed player state;
- expose telemetry and validation data.

## Boundary

Stat Growth decides what stat needs to improve and by how much. Work / Activity owns how the player performs the activity.

Stat growth should be objective-driven rather than unconstrained stat farming unless an explicit progression strategy authorizes general training.

The Progression Coordinator chooses priority when multiple stat or non-stat objectives compete.

## Modes

Low-RAM should use simple requirement comparison and on-demand requests.

Full Stack may support multiple pending requirements, time-to-target estimates, efficiency comparisons, combined prerequisite planning, and dynamic reprioritization where justified.

## Failure Behavior

Unavailable training methods or missing prerequisites should normally block the objective rather than fail the subsystem. Completion must never be inferred only from elapsed time.

## Telemetry

Useful telemetry includes current value, required value, gap, source objective, growth status, requested activity, elapsed time, estimated completion where available, and blocked reason.

## Validation

Validation should prove requirement resolution, correct gap reporting, Work-subsystem delegation, observed-state completion, and correct blocked/degraded/fail classification.

## Deferred

Exact training method selection, efficiency formulas, overshoot margins, general-training policy, and prioritization formulas remain deferred.
