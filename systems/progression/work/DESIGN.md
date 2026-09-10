# Work / Activity Subsystem — Design

## Authority

This document refines `systems/progression/DESIGN.md` and the root `DESIGN.md`. Higher-level design documents remain authoritative if conflicts exist.

## Purpose

> Execute approved player activities in a controlled, observable way while respecting Progression priorities and global authority over the player's active work slot.

## Responsibilities

- receive activity/outcome requests from Progression subsystems;
- validate activity eligibility;
- start, maintain, stop, and transition player activities;
- reconcile observed player state before and after transitions;
- handle interruption, handoff, completion, and external/manual changes;
- expose activity telemetry and validation state.

## Non-Responsibilities

This subsystem does not choose the overall progression strategy, faction priority, stat priority, or augmentation plan.

Other Progression subsystems request outcomes; Work owns activity execution mechanics.

## Authority

`PLAYER_ACTIVITY` is a globally ownable resource. Only one controller may hold autonomous decision authority over it at a time.

Authority transfers must use the Scheduler/global authority mechanism rather than competing activity calls.

## Interruption and Handoff

A transition should conceptually:

```text
request stop/transfer
→ record final observed state
→ stop or transition activity
→ refresh player state
→ confirm new state
→ begin next approved activity
```

Manual player intervention is not inherently a system failure. The subsystem must reconcile reality and report the changed state upward.

## Modes

Low-RAM should favor event/on-demand supervision and minimal persistent overhead.

Full Stack may support richer continuous supervision, automatic handoffs, objective progress telemetry, and faster change detection where justified.

## Failure Behavior

Missing prerequisites should normally produce `BLOCKED`; impaired but usable execution may be `DEGRADED`; implementation malfunction is `FAIL`.

Failed activity starts must refresh/reconcile rather than enter blind retry loops.

## Validation

Validation should prove eligibility checking, authority compliance, transition reconciliation, manual-intervention handling, completion detection, and mode-appropriate RAM behavior.

## Deferred

Exact activity-selection logic, manual-priority policy, transition timing, retry/backoff rules, and message schemas remain deferred.
