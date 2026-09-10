# Data Collection System — Design

## Authority

This document refines the root repository `DESIGN.md` for the Data Collection subsystem. The root `DESIGN.md` remains authoritative if the two conflict.

Implementation-specific schemas, transports, and refresh algorithms remain intentionally deferred until their consumers are defined.

## Purpose

> Collect, normalize, timestamp, and expose game-state data so other systems can make decisions from a consistent view of the world instead of independently re-querying and re-deriving the same information.

## Ownership Boundary

Data Collection owns acquisition and normalization of shared state.

Consuming systems own decisions made from that state.

Examples:

- Data Collection reports faction reputation and augmentation information; Progression decides what to do.
- Data Collection reports market state and positions; Stock System decides how to trade.
- Data Collection reports server/RAM state; Hacking and Scheduler decide how to use it.

Major systems should not duplicate expensive acquisition when equivalent valid shared data already exists unless they have an explicit latency/correctness requirement that justifies bypassing shared state.

## State Domains

The system may include modules for:

- player state;
- server/network state;
- RAM/resource state;
- progression state;
- faction/company state;
- augmentation state;
- stock state;
- purchased-server state;
- world clock;
- repository/update state.

Modules should remain separate where their acquisition cost, freshness requirements, failure modes, or consumers differ materially.

## Freshness

Shared state must allow consumers to determine whether data is:

- fresh;
- stale but potentially usable;
- invalid;
- unavailable.

Records should eventually carry enough metadata to establish source, timestamp/age, validity, and schema/version where useful.

Different data classes may use different refresh cadences. Exact cadences are centrally configurable and intentionally deferred until implementation.

## Operating Modes

### Low-RAM

Low-RAM Mode should collect only what is useful enough to justify its RAM/API cost.

It may use slower cadences, on-demand collection, and fewer persistent collectors while maintaining compatible conceptual state contracts.

### Full Stack

Full Stack may support broader persistent collection, faster refresh, stronger invalidation, richer telemetry, and historical sampling where those capabilities provide measurable value.

## State Transport

Scheduler control ports are not the primary shared-state store.

The system should expose standardized shared-state interfaces, likely using files and/or dedicated state mechanisms, while ports may be used for lightweight notifications such as:

- `DATA_UPDATED`;
- `DATA_STALE`;
- `COLLECTOR_FAILED`;
- `STATE_INVALIDATED`.

Exact transport and schema are deferred until system consumers are specified.

## World Clock

The world clock is expected to be a small persistent shared service that provides a consistent stack time reference for scheduling, state timestamps, and telemetry.

It should survive normal mode transitions and repository updates where compatible. If an update makes the running clock incompatible, the authorized updater may restart it.

## Repository Update Subsystem

Data Collection contains a Repository Update subsystem with two separate roles.

### Update Watcher

May automatically detect whether the local stack is behind the approved repository revision and expose that state to the player/dashboards.

It must never install an update automatically.

### Revision Puller

May replace the local stack only after explicit player authorization and must follow the root controlled-update lifecycle.

Update detection and update installation remain separate responsibilities.

## Failure Isolation

Failure of one collector should not unnecessarily terminate unrelated collectors.

Consumers should observe the affected state as stale, invalid, or unavailable and react according to their own requirements.

## Telemetry

Potential Data Collection telemetry includes:

- collector health;
- last successful refresh;
- refresh duration;
- stale-state count;
- failed reads;
- state/schema version;
- RAM cost by collector;
- relevant invalidation events.

## Deferred Implementation Details

Intentionally deferred:

- exact file/port/state transport;
- exact schemas;
- exact refresh cadences;
- cache/invalidation algorithms;
- persistence format;
- collector retry policy;
- historical retention policy.
