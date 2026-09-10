# Faction & Company Progression Subsystem — Design

## Authority

This document refines `systems/progression/DESIGN.md` and the root `DESIGN.md`. Higher-level design documents remain authoritative if conflicts exist.

## Purpose

> Track faction and company progression opportunities, determine organization-specific requirements and goals, and publish those goals without duplicating activity, stat-growth, or augmentation logic.

## Responsibilities

- consume faction/company memberships, invitations, employment, roles, reputation, favor, and prerequisites;
- identify meaningful organization milestones and blockers;
- publish reputation, membership, employment, promotion, and prerequisite goals;
- hand stat requirements to Stat Growth and activity needs to Work / Activity through Progression coordination;
- expose telemetry and validation state.

## Boundary

This subsystem owns organization-specific goal generation. It does not own global progression priority, player activity execution, augmentation selection, or global capital policy.

The Progression Coordinator resolves competition among multiple organization paths.

## Joining and Employment Actions

Faction joining, company entry, promotion, and related actions may eventually be advisory or automated according to explicit policy. They must be validated against observed state before execution.

## Modes

Low-RAM should evaluate organization opportunities infrequently or on demand and publish only currently meaningful goals.

Full Stack may support richer prerequisite graphs, alternative organization paths, promotion analysis, time-to-reputation estimates, and dynamic reprioritization where justified.

## Failure Behavior

Missing prerequisites should produce blocked objectives rather than repeated failing actions. Organization state must be refreshed after manual player actions or attempted transitions.

## Telemetry

Useful telemetry includes memberships, invitations, employment/role, current and target reputation, next milestone, blockers, published objectives, promotion/join opportunities, and current organization priority as assigned by Progression.

## Validation

Validation should prove that organization state is interpreted correctly, objectives reflect observed prerequisites, child subsystems receive the right requirements, and completion is confirmed from actual faction/company state.

## Deferred

Exact faction/company priority formulas, invitation/join automation policy, promotion strategy, reputation-efficiency calculations, and organization path scoring remain deferred.
