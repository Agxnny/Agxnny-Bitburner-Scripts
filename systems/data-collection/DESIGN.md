# Data Collection System — Design

## Authority

This document refines the root repository `DESIGN.md` for the Data Collection subsystem. The root `DESIGN.md` remains authoritative if the two conflict.

Implementation-specific transport filenames, exact serialized schemas, refresh intervals, and retry algorithms remain intentionally deferred until their consumers are implemented and validated.

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

## Shared State Architecture

Shared operational state is published as domain-oriented snapshots rather than one monolithic global object.

A snapshot should conceptually carry:

```text
domain
schemaVersion
generatedAt
valid
freshness
source
data
```

Exact serialized field names remain deferred.

The architectural default is durable, JSON-compatible domain snapshots/files, while ports are reserved for lightweight update/invalidation notifications rather than primary state storage. If implementation reveals a lower-RAM equivalent with the same durability, inspectability, and isolation properties, the transport may be deliberately revised without changing the state contract.

### Publication Semantics

A new snapshot replaces the current snapshot only after acquisition, normalization, and validation succeed.

Readers must not observe half-written or partially replaced snapshots. Publication should therefore be atomic from the consumer's perspective even if implementation uses a temporary file or equivalent replacement mechanism.

If refresh fails, the last known valid snapshot remains available and ages according to freshness policy.

> Collection failure must not destroy the last known valid state unless that state is explicitly known to be invalid.

If current knowledge proves previous state incorrect or unsafe to consume, the state may be explicitly invalidated.

Failure of one collector should not unnecessarily terminate or invalidate unrelated domains.

### Schema Compatibility

Snapshots carry a schema version. Consumers must not silently interpret an incompatible schema as valid. Incompatible state is treated as invalid/unavailable for that consumer until a compatible snapshot exists.

## Freshness Model

Consumers must be able to distinguish at least:

```text
FRESH
STALE
INVALID
UNAVAILABLE
```

`STALE` means previously valid state may still be usable depending on the consumer. It is not equivalent to `INVALID` or `UNAVAILABLE`.

Freshness requirements belong to consumer contracts rather than one universal timeout. Data Collection publishes age/freshness metadata; each consumer defines whether stale data is acceptable for a specific operation.

Broad classes are:

- **Fast** — volatile server money/security, current free RAM/resource availability, stock state.
- **Medium** — player money/stats/current work, faction/company reputation, purchased-server state.
- **Slow** — augmentation/static progression metadata, repository revision, relatively static capability data.

Exact cadences must be centrally configurable and remain deferred until implementation.

## State Transport and Notifications

Scheduler control ports are not the primary shared-state store.

Ports may carry lightweight notifications such as:

- `DATA_UPDATED`;
- `DATA_STALE`;
- `COLLECTOR_FAILED`;
- `STATE_INVALIDATED`.

Ports remain live coordination/event channels rather than durable truth. A consumer that misses a notification must still be able to recover by reading the current snapshot.

## State History

Shared state primarily represents current decision truth. Large or indefinite history does not belong in the shared-state layer.

Limited history may be retained where a specific consumer needs it, but long-running trend/history requirements should normally be handled as telemetry rather than by bloating authoritative state.

## Telemetry Architecture

State and telemetry are separate contracts.

> State exists so systems can make decisions. Telemetry exists so humans and validation systems can understand, prove, and diagnose those decisions.

A system must not require scraping logs or telemetry to reconstruct authoritative operational state.

### Current Telemetry Summary

Each major system should expose a compact current telemetry/health summary containing relevant items such as:

```text
health
mode
current activity
last successful action
last failure
resource usage
key counters
last decision
```

The exact schema remains deferred, but summaries should be readable without consuming production control-plane messages.

### Telemetry Events

Important operational events may be emitted separately from current summaries, for example batch starts/failures, trades, allocation changes, authority changes, collector failures, objective changes, or update availability.

Routine loop iterations and high-volume worker noise should not automatically become telemetry events.

A common event envelope should conceptually include:

```text
type
source
timestamp
severity
correlationId
payload
```

Common severity levels should remain small and conventional, such as `DEBUG`, `INFO`, `WARN`, and `ERROR`.

Severity is distinct from the global system-health vocabulary. One error event does not automatically mean overall system health is `FAIL`.

### Correlation

Related cross-system operations should be traceable through a shared correlation identifier where practical. This allows a higher-level objective, resource request, approval, execution, state refresh, and result to be diagnosed as one operation without tightly coupling implementations.

### Retention

Telemetry history must be bounded. The system should retain only enough history to support recent diagnosis and validation. Exact counts/time windows remain configurable and deferred.

Telemetry failure should normally not stop production logic. Shared-state failure may block or degrade consumers when they can no longer make safe decisions.

> Dashboards observe the system; they are not part of the production control path.

Telemetry and dashboards must not materially distort the RAM usage or timing behavior they measure.

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

Persistent collection and telemetry history should be minimized.

### Full Stack

Full Stack may support broader persistent coverage, faster refresh of volatile domains, invalidation events, richer health metadata, correlated event telemetry, and limited history where those capabilities provide measurable value.

Both modes preserve compatible conceptual state and telemetry contracts.

## Validation Expectations

Validation should prove that:

- consumers can distinguish fresh, stale, invalid, and unavailable state;
- failed refresh does not erase last known valid state;
- readers do not observe partial snapshot publication;
- incompatible schemas are rejected rather than silently misread;
- one collector failure remains isolated where dependencies permit;
- normalized state matches observed game state;
- duplicate expensive acquisition is not introduced without explicit justification;
- Low-RAM and Full-Stack collection behavior respects their resource goals;
- control ports are not used as the sole durable state store;
- missed update notifications do not prevent snapshot recovery;
- telemetry failure does not unnecessarily stop production behavior;
- telemetry history remains bounded;
- dashboards do not become production dependencies.

## Deferred Implementation Details

Intentionally deferred:

- exact filenames and directories for state snapshots;
- exact serialized schemas and field names;
- exact atomic-publication implementation;
- exact refresh cadences;
- cache/invalidation algorithms;
- collector retry/backoff intervals;
- telemetry storage/event transport details;
- telemetry history limits;
- exact process grouping of collectors.
