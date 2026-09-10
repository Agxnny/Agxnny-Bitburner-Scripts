# Scheduler System — Design

## Authority

This document refines the root repository `DESIGN.md` for the scheduling/orchestration subsystem. The root `DESIGN.md` remains authoritative if the two conflict.

Implementation-specific algorithms that have not yet been validated are intentionally deferred.

## Purpose

Coordinate the stack without absorbing domain-specific strategy.

The scheduling layer consists of:

- one-shot bootstrap/start script;
- Low-RAM Scheduler;
- Full-Stack Scheduler;
- shared scheduler communication contracts;
- global authority/ownership arbitration.

## Bootstrap

The bootstrap script is not persistent. It evaluates initial viability, honors the configured `auto` / `low` / `full` mode selection policy, launches the appropriate scheduler, and exits.

## Low-RAM Scheduler

Purpose:

> Run the core stack with the lowest practical control-plane RAM overhead while protecting hacking income and retaining a clean upgrade path into Full Stack.

Responsibilities include:

- launch/supervise only required Low-RAM processes;
- protect the hacking-income baseline;
- conservatively allocate RAM;
- keep persistent control overhead minimal;
- periodically determine whether Full Stack is viable;
- verify Full-Stack prerequisites before handoff;
- cleanly stop Low-RAM-owned processes during transition;
- preserve compatible persistent/shared services;
- launch Full Stack and confirm it is alive before exiting;
- recover/remain in Low-RAM if the handoff fails.

Exact viability thresholds and cycle logic are deferred until RAM Audit and runtime requirements are measured.

## Full-Stack Scheduler

Purpose:

> Coordinate major systems, enforce global priorities/resource policy, and keep the full stack operating efficiently without duplicating domain-specific logic.

Responsibilities include:

- consume RAM Audit output and current resource state;
- enforce the protected hacking baseline;
- allocate RAM/resource budgets and execution permissions;
- coordinate global priorities when systems compete;
- supervise system lifecycle and dependencies;
- consume subsystem health/telemetry;
- perform controlled recovery where allowed;
- expose scheduler state to dashboards;
- support controlled fallback to Low-RAM when Full Stack is no longer viable.

The Full-Stack Scheduler must not make domain decisions such as target scoring, stock strategy, augmentation selection, or purchased-server upgrade formulas.

## Runtime Priority

Hacking income is the highest baseline productive priority.

> The stack must protect a productive hacking-income baseline before allocating discretionary resources to secondary systems.

Critical lifecycle/recovery operations may temporarily outrank that baseline when required for stack correctness or recoverability.

Boot dependency order is not the same as runtime priority. A supporting service may need to start before Hacking without receiving higher productive-resource priority.

## Scheduler Communication

Scheduler/system control communication uses centrally assigned ports.

Where port availability permits, each major system should have:

- Scheduler → System channel;
- System → Scheduler channel.

Port numbers must be centrally declared. Systems must not reuse another system's assigned control port.

Control messages should eventually use a standard envelope containing at least message type, source, target, timestamp, correlation/request identity where relevant, and payload.

Ports are live coordination channels, not durable truth. Systems and schedulers must be able to reconstruct after restart without relying on old port contents.

Dashboards must not compete with control-plane ports for messages.

## Global Authority / Ownership Registry

The scheduler owns arbitration and recording of system-level decision authority.

> Anything whose autonomous control can conflict must have one clear decision authority at a time.

The registry distinguishes:

- **control/decision authority** — who may make autonomous strategic/lifecycle decisions;
- **usage allocation** — who may consume some portion of a resource.

A domain has a normal/default owner. Another approved subsystem may temporarily claim authority over a specific entity or decision domain.

While a temporary authority claim is active, the default owner must suppress conflicting autonomous decisions for that controlled entity.

The authority holder may still issue explicit directed actions through the normal domain system so execution machinery can be reused without returning autonomous authority.

Example:

```text
Stock System normally owns ECP trading
        ↓
Stock Manipulation claims ECP
        ↓
Stock System stops autonomous ECP decisions
        ↓
Manipulation explicitly requests BUY ECP
        ↓
Stock System executes requested trade
        ↓
Manipulation retains decision authority
```

The same model may later apply to hacking targets, stock symbols, purchased-server lifecycle operations, player work, capital domains, testing controllers, recovery controllers, and other conflicting decision surfaces.

When authority is released, the returning default owner must reconcile current state before resuming autonomous decisions.

Stale-claim handling, lease/heartbeat mechanics, exact claim schemas, and command protocol remain intentionally deferred until implementation.

## Recovery

Scheduler recovery should be dependency-aware and avoid infinite restart loops.

Conceptual recovery levels may include:

```text
RESTART_COMPONENT
RESTART_SYSTEM
MODE_FALLBACK
```

A component blocked by a missing dependency should not be repeatedly restarted as though the component itself is faulty.

Repeated failure should become observable as degraded/blocked state rather than silently looping forever.

## Mode Transition

Mode transition is distinct from repository update.

For Low → Full:

- verify Full Stack is viable and prerequisites exist;
- stop Low-RAM-owned processes;
- preserve compatible persistent/shared services;
- launch Full-Stack Scheduler;
- confirm successful handoff;
- Low-RAM Scheduler exits.

For eventual Full → Low fallback:

- detect sustained non-viability using a lower fallback threshold/hysteresis;
- stop Full-only processes;
- preserve compatible persistent/shared services;
- launch Low-RAM Scheduler;
- confirm handoff;
- Full-Stack Scheduler exits.

## Telemetry

Scheduler telemetry should eventually expose, where relevant:

- current mode;
- scheduler health;
- RAM available/reserved/allocated by system;
- protected hacking allocation;
- active systems;
- dependency health;
- system priorities;
- authority claims;
- recovery/restart events;
- mode viability and transition state;
- scheduler cycle duration.

## Deferred Implementation Details

Intentionally deferred until implementation/testing:

- exact port numbers;
- exact message schema;
- exact authority claim/lease schema;
- heartbeat/timeouts;
- exact RAM allocation algorithm;
- exact mode thresholds/hysteresis;
- scheduler tick rates;
- retry/backoff policy;
- detailed recovery thresholds.
