# Progression System — Design

## Authority

This document refines the root repository `DESIGN.md` for the Progression System. The root `DESIGN.md` remains authoritative if the two conflict.

The Progression System is an umbrella architecture. Major child domains may maintain their own local `DESIGN.md` files when implementation begins.

Exact progression scoring, route selection, training efficiency, faction priority, augmentation valuation, and automation thresholds remain intentionally deferred.

## Purpose

> Determine what should advance the player next, coordinate progression objectives and prerequisites, and either execute approved progression actions or explain them through advisory output.

## Ownership Boundary

Progression owns decisions about what advances the player.

It does not independently seize globally managed resources such as RAM, capital, purchased-server lifecycle control, stock-symbol authority, or hacking targets.

It may publish requirements such as:

- money needed;
- faction/company reputation needed;
- stat targets;
- activity needs;
- augmentation prerequisites.

Other domain systems retain ownership of their own responsibilities, while the Scheduler arbitrates globally constrained resources and authority.

## Umbrella Structure

```text
Progression System
├── Progression State Evaluator / Coordinator
├── Work / Activity Subsystem
├── Stat Growth Subsystem
├── Faction & Company Progression Subsystem
├── Augmentation Planning Subsystem
├── Augmentation Purchase Subsystem
└── Recommendation / Advisory Subsystem
```

## Progression Coordinator

The coordinator aggregates objectives and blockers, resolves dependencies, chooses the active progression objective, and routes approved work to the appropriate child subsystem.

It does not duplicate child-domain logic.

Progression should distinguish:

- strategic goal;
- current active objective;
- current executing activity/action.

When material conditions change, it must re-plan from observed state rather than blindly continue a stale plan.

## Work / Activity Subsystem

Purpose:

> Execute approved player activities in a controlled and observable way while respecting Progression priority and global authority over the active player-work slot.

Other progression subsystems request outcomes or activity intent; Work owns the mechanics of starting, maintaining, stopping, and changing player activities.

`PLAYER_ACTIVITY` should be treated as an ownable global resource. Only one controller may hold autonomous authority over it at a time.

Activity transitions must reconcile actual player state before and after handoff.

## Stat Growth Subsystem

Purpose:

> Determine when player stats block an approved progression objective, define required stat targets, and request suitable growth activity without duplicating activity execution.

Stat growth should normally be objective-driven rather than unconstrained stat farming unless an explicit strategy authorizes general training.

Objectives complete only when observed stats satisfy the requirement.

## Faction & Company Progression Subsystem

Purpose:

> Track faction/company progression opportunities, membership/employment state, reputation and promotion requirements, and publish organization-specific progression goals.

It owns organization-specific goal generation but does not directly seize player activity authority or globally managed capital.

The Progression Coordinator resolves global progression priority when several faction/company paths compete.

## Augmentation Planning Subsystem

Purpose:

> Evaluate available augmentations, determine strategically relevant targets, resolve prerequisites and acquisition paths, and publish an ordered augmentation plan.

Planning owns what should be pursued and in what order; it does not execute irreversible purchases.

Plans must distinguish desirability from current feasibility.

## Augmentation Purchase Subsystem

Purpose:

> Execute approved augmentation purchases safely, in the intended order, within granted capital limits, and only when current observed state confirms the purchase remains valid.

A previously valid plan is not sufficient authority to buy. Availability, prerequisites, reputation, current price, ownership, and capital authorization must be revalidated at execution time.

Changed conditions or partial execution must return to reconciliation/replanning rather than improvisation or blind retry.

## Recommendation / Advisory Subsystem

Purpose:

> Present actionable progression recommendations derived from the same authoritative plans and state used by automation, without independently changing game state.

Recommendations should explain what to do, why it matters, current progress, and blockers where practical.

Advisory and automated modes should share the same underlying planning information rather than maintaining separate strategic logic.

## Advisory vs Automated Operation

Progression should support conceptually separate operation modes:

```text
ADVISORY
→ recommend actions; player acts

AUTOMATED
→ request required authority/resources and execute approved actions
```

Recommendation output remains useful in automated operation because it explains what automation is doing and why.

## Scheduler and Authority Integration

The Scheduler controls global resource policy and authority arbitration.

Progression may request:

- capital;
- `PLAYER_ACTIVITY` authority;
- permission for consequential actions;
- scheduling opportunity.

A blocked global resource should leave a valid progression objective in a waiting/blocked state rather than causing the subsystem to violate policy.

## Operating Modes

### Low-RAM

Use small objective sets, limited planning depth, infrequent re-evaluation, and event/on-demand child subsystems where practical. Progression must not consume enough control-plane RAM to undermine the protected hacking baseline.

### Full Stack

May support larger dependency graphs, alternate progression paths, dynamic reprioritization, richer cost/time estimates, automated handoffs, and deeper advisory explanations where justified.

## Failure Behavior

Progression failures should be classified by cause:

- missing prerequisite or resource → `BLOCKED`;
- usable but impaired behavior → `DEGRADED`;
- implementation/system malfunction → `FAIL`.

Observed game state is authoritative after manual player intervention or failed actions.

## Telemetry

Potential telemetry includes:

- strategic goal;
- active objective;
- source subsystem;
- dependency chain;
- blockers;
- required money/reputation/stats;
- current activity;
- current authority owner;
- current executing subsystem;
- last re-plan reason;
- last completed objective;
- future objectives;
- recommendation/explanation state.

## Validation Expectations

Validation should prove that:

- child subsystems do not bypass ownership boundaries;
- objective completion is confirmed from observed state;
- stale/changed conditions trigger re-planning;
- global capital and authority policy are respected;
- advisory output agrees with authoritative planning state;
- irreversible purchases require explicit validation and authorization;
- Low-RAM and Full-Stack behavior remain appropriate to their resource regimes.

## Deferred Implementation Details

Intentionally deferred:

- exact objective priority formula;
- dependency graph representation;
- manual-player override policy;
- exact activity-selection logic;
- training method selection and efficiency formulas;
- faction/company priority formulas;
- augmentation valuation and purchase-order optimization;
- exact automation/advisory configuration;
- exact capital reservation and authority message schemas.
