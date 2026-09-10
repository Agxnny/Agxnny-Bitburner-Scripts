# Data Collection System — Design

## Authority

This document refines the root repository `DESIGN.md` for the Data Collection subsystem. The root `DESIGN.md` remains authoritative if the two conflict.

Implementation-specific transport formats, exact schemas, refresh intervals, and retry algorithms remain intentionally deferred until their consumers are implemented and validated.

## Purpose

> Collect, normalize, timestamp, validate, and expose shared game-state data so other systems can make decisions from a consistent view of reality instead of independently re-querying or re-deriving the same information.

## Ownership Boundary

Data Collection owns acquisition and normalization of shared state.

Consuming systems own decisions made from that state.

Examples:

- Data Collection reports faction reputation and augmentation information; Progression decides what to do.
- Data Collection reports market state and positions; Stock decides how to trade.
- Data Collection reports server/RAM state; Hacking and Scheduler decide how to use it.
- Data Collection reports purchased-server state; Fleet owns lifecycle decisions.

> No major system should duplicate expensive acquisition when equivalent valid shared data already exists unless an explicit latency or correctness requirement justifies bypassing shared state.

## State Domains

The system should support the following logical domains:

```text
Data Collection System
├── Player State Collector
├── Server / Network State Collector
├── RAM / Resource State Collector
├── Progression State Collector
├── Faction / Company State Collector
├── Augmentation State Collector
├── Stock State Collector
├── Purchased Server State Collector
├── World Clock
├── Repository / Update State
└── Shared State Publisher / Validation
```

Logical modularity does not require one persistent process per collector. Collectors may share a process when doing so materially reduces RAM without creating unclear ownership or coupling.

## Collector Responsibilities

### Player State

Own normalized player-level state such as money, skills/stats, city, current work/activity, jobs, faction membership, and relevant unlock/capability information.

### Server / Network State

Own network discovery and normalized server state such as reachability, root access, hacking requirements, money/security, RAM capacity, and other broadly shared server facts.

### RAM / Resource State

Own the current runtime resource picture: total, used, free, allocatable, reserved, draining, or maintenance RAM/hosts where those concepts are implemented.

This is distinct from RAM Audit:

> RAM Audit answers "what does the software cost?"; Resource State answers "what RAM exists right now?"

### Progression State

Own broad progression facts that do not belong more naturally to a specialized collector, such as major unlocks, reset-related state, installed augmentation summary, and capability milestones. It should remain thin enough to avoid duplicating specialized faction/company and augmentation domains.

### Faction / Company State

Own memberships, invitations, reputation, favor where useful, employment, roles, company reputation, and related organization state.

### Augmentation State

Own augmentation availability/acquisition facts including owned/installed state, faction sources, prices, reputation requirements, prerequisites, and availability.

### Stock State

Own normalized market observations and portfolio state, including symbols, prices, positions, and capability-dependent market information that is currently available.

### Purchased Server State

Own observed fleet facts such as purchased-server identities, RAM, usage, availability, and relevant limits. Fleet retains lifecycle authority.

### Repository / Update State

Own observed local/available revision and release-version state used by the Update Watcher. Observation must remain separate from installation.

## Shared State Contract

Each published domain snapshot should carry a small common metadata contract conceptually containing:

```text
domain
schemaVersion
generatedAt
valid
freshness
source
data
```

Exact field names and serialization are deferred.

State should be domain-oriented rather than one monolithic global state object so that failure, freshness, loading, and schema evolution can remain isolated.

## Freshness Model

Consumers must be able to distinguish at least:

```text
FRESH
STALE
INVALID
UNAVAILABLE
```

`STALE` means previously valid state may still be usable depending on the consumer. It is not equivalent to `INVALID` or `UNAVAILABLE`.

Freshness requirements are domain-specific.

Broad classes are:

- **Fast** — volatile server money/security, current free RAM/resource availability, stock state.
- **Medium** — player money/stats/current work, faction/company reputation, purchased-server state.
- **Slow** — augmentation/static progression metadata, repository revision, relatively static capability data.

Exact cadences must be centrally configurable and remain deferred until implementation.

## Publication and Failure Semantics

A collector should publish a new valid snapshot only after a successful acquisition/normalization cycle.

If refresh fails, the system should normally preserve the last known valid snapshot and allow it to age into `STALE` rather than replacing it with empty or misleading data.

> Collection failure must not destroy the last known valid state unless that state is explicitly known to be invalid.

If current knowledge proves previous state incorrect or unsafe to consume, the state may be explicitly invalidated.

Failure of one collector should not unnecessarily terminate or invalidate unrelated domains.

## State Transport

Scheduler control ports are not the primary shared-state store.

The system should expose standardized shared-state interfaces, likely using domain files and/or dedicated state mechanisms. Ports may carry lightweight notifications such as:

- `DATA_UPDATED`;
- `DATA_STALE`;
- `COLLECTOR_FAILED`;
- `STATE_INVALIDATED`.

Ports remain live coordination/event channels rather than durable truth.

Exact shared-state transport and persistence format are deferred.

## World Clock

The world clock should be deliberately tiny and persistent, providing a consistent stack time reference for state timestamps, scheduler timing, durations, and telemetry.

It should survive normal mode transitions and repository updates where compatible. If a revision makes it unsafe to preserve, the authorized updater may restart it.

## Repository Update Subsystem

Data Collection contains a Repository Update subsystem with two separate roles.

### Update Watcher

May automatically detect whether the local stack is behind the approved repository revision and expose that state to the player/dashboards.

It must never install an update automatically.

### Revision Puller

May replace the local stack only after explicit player authorization and must follow the root controlled-update lifecycle.

Update detection and update installation remain separate responsibilities.

## Operating Modes

### Low-RAM

Low-RAM should collect only data valuable enough to justify its RAM/API cost. Player, server/network, and resource state are expected to form the essential core, while other collectors may be slower or on-demand depending on active systems.

Persistent collection should be minimized.

### Full Stack

Full Stack may support broader persistent coverage, faster refresh of volatile domains, invalidation events, richer health metadata, and limited history where those capabilities provide measurable value.

Both modes should preserve compatible conceptual state contracts.

## Telemetry

Potential telemetry includes:

- collector health;
- last successful refresh;
- refresh duration;
- refresh failures;
- stale record/domain count;
- invalid record/domain count;
- schema/version;
- RAM cost by collector;
- last invalidation;
- consumer-visible freshness.

## Validation Expectations

Validation should prove that:

- consumers can distinguish fresh, stale, invalid, and unavailable state;
- failed refresh does not erase last known valid state;
- one collector failure remains isolated where dependencies permit;
- normalized state matches observed game state;
- duplicate expensive acquisition is not introduced without explicit justification;
- Low-RAM and Full-Stack collection behavior respects their resource goals;
- control ports are not used as the sole durable state store.

## Deferred Implementation Details

Intentionally deferred:

- exact file/state transport;
- exact serialized schemas and field names;
- exact refresh cadences;
- cache/invalidation algorithms;
- persistence format;
- collector retry/backoff policy;
- historical retention policy;
- exact process grouping of collectors.
