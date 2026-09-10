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
- global RAM and capital coordination;
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

Low-RAM resource policy should remain deliberately simple: reserve required control RAM and safety capacity, satisfy immediately required approved workloads, and allow remaining productive capacity to flow primarily to Hacking.

Exact viability thresholds and cycle logic are deferred until RAM Audit and runtime requirements are measured.

## Full-Stack Scheduler

Purpose:

> Coordinate major systems, enforce global priorities/resource policy, and keep the full stack operating efficiently without duplicating domain-specific logic.

Responsibilities include:

- consume RAM Audit output and current resource state;
- enforce the protected hacking baseline;
- allocate RAM/resource budgets and execution permissions;
- coordinate capital reservations and spending permission;
- coordinate global priorities when systems compete;
- supervise system lifecycle and dependencies;
- consume subsystem health/telemetry;
- arbitrate global authority claims;
- perform controlled recovery where allowed;
- expose scheduler state to dashboards;
- support controlled fallback to Low-RAM when Full Stack is no longer viable.

The Full-Stack Scheduler must not make domain decisions such as target scoring, stock strategy, augmentation selection, or purchased-server upgrade formulas.

## Runtime Priority

Hacking income is the highest baseline productive priority.

> The stack must protect a productive hacking-income baseline before allocating discretionary resources to secondary systems.

Critical lifecycle/recovery operations may temporarily outrank that baseline when required for stack correctness or recoverability.

Boot dependency order is not the same as runtime priority. A supporting service may need to start before Hacking without receiving higher productive-resource priority.

## Global RAM Allocation

The Scheduler is the global RAM-allocation authority. Domain systems decide how to use RAM that has been granted to them; they must not assume that globally free RAM belongs to them.

Conceptual RAM classes are:

```text
TOTAL RAM
  ↓
SAFETY RESERVE
  ↓
SYSTEM / CONTROL-PLANE RAM
  ↓
PROTECTED PRODUCTIVE RAM
  ↓
NORMAL ALLOCATIONS
  ↓
BURST / DISCRETIONARY CAPACITY
```

Normal subsystem allocations are hard ceilings rather than consumption targets. A system may use less than its grant but must not knowingly exceed it.

Subsystem demand should be expressible conceptually as minimum useful, preferred, and maximum useful capacity. The Scheduler decides the grant; the subsystem decides what workload fits inside it.

Hacking has a protected baseline plus discretionary capacity. Otherwise-idle allocatable RAM should normally flow toward productive Hacking unless another approved workload has a stronger current claim.

Normal reclamation should be cooperative: stop scheduling new work into capacity being reclaimed, allow short-lived work to drain where practical, report released capacity, then reallocate it. Forced termination is reserved for recovery, transitions, updates, emergency pressure, or workloads that cannot drain safely.

Observed Bitburner RAM state is authoritative if scheduler accounting disagrees with reality. Accounting must be reconciled rather than blindly trusted.

Exact host-placement algorithms, grant sizes, reserves, and reclamation timing remain deferred.

## Global Capital Coordination

The Scheduler owns global spending permission and reservation accounting; domain systems retain purchasing/investment strategy.

> Domain systems decide what is worth buying; the global capital allocator decides whether money is available to commit.

Meaningful spending should use explicit reservations so multiple systems cannot count the same cash as available. A reservation should identify an owner, amount, purpose, and lifecycle. Exact schema and expiry rules are deferred.

Conceptually:

```text
PLAYER MONEY
  ↓
PROTECTED CASH RESERVE
  ↓
EXISTING CAPITAL RESERVATIONS
  ↓
AVAILABLE CAPITAL
```

Stock capital is committed capital rather than ordinary spend. The Scheduler may request that Stock free capital for a higher-priority objective, but Stock retains responsibility for deciding how to unwind positions safely within granted policy.

Expensive or irreversible actions require both current domain validation and current capital authorization. Approval for one purpose must not become open-ended authority to spend later on another purpose.

Exact arbitration priorities, reserve amounts, expiry mechanics, and reservation schema remain deferred until competing consumers exist.

## Scheduler Communication

Scheduler/system control communication uses centrally assigned ports.

Where port availability permits, each major system should have:

- Scheduler → System channel;
- System → Scheduler channel.

Port numbers must be centrally declared. Systems must not reuse another system's assigned control port.

### Message Envelope

Control messages should use a standard envelope conceptually containing:

```text
type
source
target
timestamp
requestId
correlationId
payload
```

`requestId` identifies a request that may require a response. `correlationId` ties related operations across systems together. Exact serialized field names remain deferred.

Global message families should remain small and broad, such as resource, authority, lifecycle, health, state-notification, action, and result messages. Domain-specific variants may refine these later.

### Delivery Semantics

Ports are live coordination channels, not durable truth. Systems and schedulers must be able to reconstruct after restart without relying on old port contents.

Dashboards must not compete with control-plane ports for messages.

A failed control-plane write must be observable and handled. Critical commands must not silently disappear.

Not every message requires an acknowledgement. Commands whose correctness depends on confirmed receipt or completion require an explicit acknowledgement/result; informational notifications may be fire-and-forget.

Exact retry, queue, backpressure, and acknowledgement mechanics remain deferred.

## Global Authority / Ownership Registry

The Scheduler owns arbitration and recording of system-level decision authority.

> Anything whose autonomous control can conflict must have one clear decision authority at a time.

The registry distinguishes:

- **control/decision authority** — who may make autonomous strategic/lifecycle decisions;
- **usage allocation** — who may consume some portion of a resource.

At most one autonomous decision authority may exist for a controllable entity at a time.

A domain has a normal/default owner. Another approved subsystem may temporarily claim authority over a narrowly scoped entity or decision domain. Claims should be entity-scoped wherever practical so unrelated work can continue.

Conceptual states are:

```text
DEFAULT
EXCLUSIVE
DIRECTED
RELEASING
```

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

Authority acquisition is explicit and conflict-aware. A subsystem must not infer authority merely because the normal owner appears inactive.

A valid existing claim is normally denied/deferred to a competing requester rather than automatically preempted. Explicit preemption may be added later for higher-priority recovery or lifecycle cases.

Temporary claims must be recoverable after controller failure. Lease/heartbeat or equivalent stale-owner detection should be used, with exact timeouts deferred.

When authority is released or reclaimed, the returning default owner must reconcile current observed state before resuming autonomous decisions.

The same model may apply to hacking targets, stock symbols, purchased-server lifecycle operations, player work, testing/recovery controllers, and other conflicting decision surfaces.

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

Detailed global retry/backoff standards are defined by the root design and may be refined here during implementation.

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
- capital reservations and available spendable capital;
- active systems;
- dependency health;
- system priorities;
- authority claims;
- recovery/restart events;
- mode viability and transition state;
- scheduler cycle duration;
- control-plane delivery failures.

## Deferred Implementation Details

Intentionally deferred until implementation/testing:

- exact port numbers;
- exact serialized message schema;
- exact authority claim/lease schema;
- heartbeat/timeouts;
- exact RAM allocation and host-placement algorithm;
- exact capital reservation/arbitration algorithm;
- exact safety/cash reserves;
- exact mode thresholds/hysteresis;
- scheduler tick rates;
- retry/backoff intervals;
- detailed recovery thresholds.
