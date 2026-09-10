# Agxnny Bitburner Script Stack — Design Constitution

## 1. Authority and Purpose

This document is the architectural and implementation source of truth for this repository.

When implementation and `DESIGN.md` conflict, the implementation is considered incorrect unless this document is deliberately amended.

The purpose of this document is to prevent architectural drift, uncontrolled scope expansion, skipped implementation stages, untestable systems, conflicting ownership, and monolithic scripts as the stack grows.

Changes to these rules must be intentional. A convenient implementation shortcut is not sufficient reason to violate them.

### 1.1 Design-Document Hierarchy

The root `DESIGN.md` is the highest-level design authority for the project.

Each major system or subsystem should also maintain a local `DESIGN.md` in its own directory once that subsystem is established. A subsystem design document records the subsystem's purpose, responsibilities, non-responsibilities, interfaces, ownership rules, lifecycle, mode behavior, telemetry, failure behavior, acceptance criteria, and intentionally deferred implementation details.

Subsystem design documents may refine the root architecture but must not contradict it. If a subsystem requires a rule that conflicts with the root `DESIGN.md`, the root document must be deliberately amended first.

Implementation details that are not yet justified should remain explicitly deferred rather than being prematurely locked into design documents.

---

## 2. Core Engineering Philosophy

### 2.1 Complexity Must Earn Its Cost

Bitburner RAM is a first-class resource. Additional managers, services, APIs, abstractions, telemetry, and scheduling machinery must provide enough value to justify their runtime and implementation cost.

Correctness and reliability come before theoretical optimization.

### 2.2 One Responsibility, Clear Ownership

Each component must have a clear responsibility and ownership boundary. Decision-making belongs in managers/controllers; execution workers should remain small and deterministic wherever practical.

Two independent systems must not unknowingly own the same RAM, money, jobs, targets, decisions, or subsystem state.

### 2.3 Central Coordination, Distributed Execution

Higher-level components decide what work should occur. Lightweight workers execute that work. Workers should not independently recreate strategic decisions already owned by managers.

### 2.4 Explicit State and Deterministic Behavior

Prefer explicit arguments, defined state interfaces, telemetry contracts, ports/files where appropriate, and deterministic decisions. Hidden state and accidental coupling are architectural defects.

### 2.5 Automatic Recovery

The stack should recover cleanly from script termination, server changes, newly rooted hosts, restarts, and other expected runtime changes. Manual startup order should not be a normal requirement.

### 2.6 Central Configuration

Shared thresholds and policies should be defined centrally rather than duplicated throughout the codebase.

### 2.7 Intentional Logging

Normal operation should be quiet enough to remain useful. Managers may report meaningful state and failures; high-volume workers should suppress repetitive noise unless actively being debugged.

### 2.8 No Cleverness Without Measurable Benefit

Complex scheduling, RAM tricks, timing correction, predictive behavior, and other sophisticated mechanisms should only be introduced when they solve a demonstrated limitation.

---

## 3. Operating Modes

The stack has exactly two primary operating regimes.

### 3.1 Low-RAM Mode

Low-RAM Mode is a deliberate operating regime for early-game and resource-constrained conditions. It prioritizes:

- minimal RAM overhead;
- simple, reliable control logic;
- fewer persistent managers;
- lightweight modules and workers;
- productive use of available RAM over sophisticated optimization.

Low-RAM Mode is not an abandoned or crippled version of the full stack. It is intentionally optimized for a different resource environment.

### 3.2 Full Stack Mode

Full Stack Mode becomes available when sufficient resources exist to justify more sophisticated infrastructure. It prioritizes:

- throughput;
- coordination;
- richer state management;
- advanced scheduling;
- resource allocation;
- persistent telemetry;
- automation and optimization.

### 3.3 Shared Architecture

The two modes are modes of one architecture, not separate codebases. They should share modules, workers, interfaces, configuration, telemetry contracts, and conventions wherever doing so remains RAM-efficient.

Low-RAM Mode must not become an excuse for monolithic early-game scripts.

### 3.4 Bootstrap and Mode Selection

The initial start/bootstrap script is not a persistent scheduler. It evaluates the initial operating conditions, launches the appropriate scheduler, and exits.

The start path should support:

- `auto` — automatically determine the viable operating mode;
- `low` — force Low-RAM Mode for testing or operation;
- `full` — force Full Stack Mode for testing or operation.

Individual workers and unrelated modules must not independently decide the stack's operating mode.

### 3.5 Viability-Based Transition

The Low-RAM Scheduler remains responsible for periodically determining whether Full Stack has become viable and performing a clean handoff when appropriate.

Full Stack should eventually support controlled fallback to Low-RAM Mode when resources are no longer sufficient. Transition thresholds should use hysteresis or equivalent protection so the stack does not repeatedly oscillate between modes.

Conceptually:

```text
full-stack viable =
    available worker RAM
    >= control-plane RAM
     + minimum useful workload RAM
     + safety reserve
```

Exact viability calculations are intentionally deferred until the required systems and their measured RAM costs are known.

### 3.6 Lifecycle Separation

The architecture distinguishes:

1. **Initial boot** — bootstrap selects and launches the initial scheduler, then exits.
2. **Mode transition** — the active scheduler performs a controlled handoff to the other scheduler.
3. **Repository update** — a player-authorized update stops replaceable runtime code, installs and validates the approved revision, then restarts the stack.

These are separate lifecycle mechanisms and must not be conflated.

---

## 4. Module-First Architecture

### 4.1 Mandatory Modular Design

All major systems must use a module-based architecture.

Managers, schedulers, selectors, resource logic, configuration, utilities, telemetry, validation logic, UI components, and workers must be separated along clear responsibility boundaries wherever practical.

A script containing multiple independent responsibilities is an architectural violation and should be decomposed.

### 4.2 Modules Are Responsibility Boundaries

Modularity does not mean creating many arbitrary files. A module should have a clear purpose, defined inputs and outputs, and understandable ownership.

Artificial fragmentation that creates tightly coupled tiny files is not considered good modularity.

### 4.3 Interfaces Before Coupling

Systems should communicate through defined interfaces/contracts rather than reaching deeply into one another's implementation details.

### 4.4 Workers Remain Dumb

Execution workers should perform the operation requested by their caller and avoid strategic decisions, network discovery, target selection, resource policy, or other manager responsibilities unless the design for a specific feature explicitly requires otherwise.

---

## 5. Source File Size and Editability

Repository files must remain small enough to review, retrieve, reason about, and edit reliably through repository tooling.

### 5.1 Limits

- **Target maximum:** 400 lines per source file.
- **Hard maximum:** 500 lines per source file.
- At approximately 400 lines, decomposition must be actively considered.
- A source file exceeding 500 lines must be split unless a deliberate exception is documented in this design.

Generated data, documentation, static datasets, or other appropriate non-source artifacts may be exempt.

### 5.2 Decomposition Quality

Files must be split along responsibility boundaries, not arbitrarily to satisfy a line counter.

### 5.3 Readability Is Not Sacrificed

Code must not be compressed, converted into dense one-liners, or made less readable merely to remain below the line limit.

The line limit exists to enforce maintainability and clean editing, not code golf.

---

## 6. Implementation Discipline

### 6.1 One Active Feature

Only one roadmap feature may be the primary active implementation target at a time.

Once implementation of a feature begins, the project must not skip past it to unrelated later features.

### 6.2 Necessary Helpers Are the Only Normal Detour

Implementation may temporarily leave the active feature only to build a helper, module, interface, test facility, or prerequisite that is directly necessary to complete the active feature correctly.

Helper work is subordinate to the active feature. Once the required helper is complete, implementation returns immediately to the parent feature.

### 6.3 Minimal Helper Scope

A helper should implement what the current feature requires. It must not become an excuse to build speculative future systems.

### 6.4 No Jumping Ahead

Later-stage functionality must not be implemented unless it is directly required to complete the currently approved feature.

### 6.5 Dependencies Before Dependents

If an active feature reveals a required dependency, that dependency becomes temporary subordinate work and must be implemented and validated before dependent work proceeds.

### 6.6 No Placeholder Completion

Stubs, TODOs, fake data, hard-coded success values, bypasses, or incomplete branches do not count as feature completion unless an explicitly approved prototype stage requires them.

### 6.7 No Silent Scope Expansion

If implementation reveals a substantially larger architectural requirement, the design or implementation plan must be reviewed before scope expands.

### 6.8 Refactoring

Refactoring is permitted when required for correctness, maintainability, testing, or compliance with this document. Refactoring must not become a reason to abandon the active feature.

### 6.9 Authoritative Build Order

Once an implementation roadmap is established, its dependency/build order is authoritative until deliberately revised.

---

## 7. Feature Lifecycle

Features use the following lifecycle:

```text
PLANNED
   ↓
SPECIFIED
   ↓
ACTIVE
   ↓
IMPLEMENTED
   ↓
VALIDATING
   ↓
COMPLETE
```

Additional states such as `BLOCKED` or `FAILED` may be used when appropriate.

`IMPLEMENTED` means code exists. It does **not** mean the feature is finished.

A feature becomes `COMPLETE` only after satisfying its defined acceptance criteria and mandatory validation requirements.

If validation fails, the feature returns to active implementation. The project does not advance to the next unrelated roadmap feature.

---

## 8. Testing and Validation Constitution

### 8.1 Testing Is Part of the Feature

Testing is not optional follow-up work. Validation facilities, telemetry, and acceptance criteria are part of feature implementation.

> **No feature is COMPLETE until it has passed its defined validation suite and its behavior can be observed through the appropriate testing interface.**

### 8.2 Acceptance Criteria Before Implementation

Before substantive feature implementation begins, the feature must define:

- expected behavior;
- acceptance criteria;
- failure conditions;
- telemetry required to prove or disprove correct behavior;
- relevant test parameters;
- mode-specific expectations where Low-RAM and Full Stack behavior differ.

### 8.3 Validation Layers

Testing should include, where applicable:

1. **Module-level validation** — individual module behavior and deterministic logic.
2. **Integration validation** — interaction among the feature's managers, helpers, workers, state, and dependencies.
3. **Runtime validation** — behavior under real Bitburner runtime conditions, observed through the testing dashboard.

### 8.4 Helper Validation

Required helper modules must satisfy their own applicable validation requirements before the parent feature can pass validation.

### 8.5 Regression Discipline

When a bug is discovered, a regression check should be added where practical so the same failure class cannot silently return.

### 8.6 Mode-Specific Validation

Features that behave differently between Low-RAM and Full Stack modes must be validated in both relevant operating conditions.

### 8.7 Observable Before Optimized

Complex systems must be observable before they are optimized.

Timing-sensitive and scheduling systems should expose enough information to diagnose expected timing, actual timing, thread counts, resource consumption, state changes, drift, collisions, failures, and other relevant behavior before sophisticated optimization is attempted.

### 8.8 Instrumentation Must Not Become the System

The production runtime must not depend on a dashboard being open. Testing and dashboard code observe and control explicitly permitted test behavior; they must not become hidden production dependencies.

Instrumentation should avoid materially distorting the RAM usage or timing behavior being measured.

---

## 9. React Testing / Validation Suite

React dashboards are the standard UI technology for the project's testing/validation suite and, later, production dashboards.

Testing dashboards are functional engineering infrastructure, not cosmetic additions.

### 9.1 Dashboard Separation

Testing/validation UI and production operational dashboards must remain conceptually separate, although they may share reusable components and telemetry interfaces.

### 9.2 Data-Driven UI

Feature-specific behavior must not be unnecessarily hard-coded into React presentation components.

Features should expose standardized telemetry and validation contracts. The dashboard consumes and renders those contracts.

### 9.3 Ownership Rule

> **Features own their validation logic and telemetry definitions; the React validation suite owns presentation, test execution orchestration where appropriate, and aggregation.**

---

## 10. Validation Dashboard Tabs

The testing/validation suite has three primary functional tabs.

### 10.1 Active / In Development

The primary engineering surface for the current active feature and directly subordinate helper work. It should expose relevant live telemetry, state, test parameters, expected and actual values, acceptance criteria, individual test results, timing, resource usage, errors, warnings, and explicitly approved debug controls.

### 10.2 Completed / Validated

Validated features remain observable and should retain current health, regression status, latest validation result, last validation time where useful, and persistent telemetry relevant to continued correctness.

### 10.3 Overall Testing

The Overall Testing tab provides whole-stack health across all known systems, including incomplete, active, disabled, degraded, and blocked systems.

It should eventually detect disagreements between systems that feature-local tests cannot detect, including resource/authority ownership conflicts, inconsistent state, scheduler disagreements, and worker execution conflicts.

---

## 11. Standard Health Vocabulary

Initial standard states are:

```text
NOT_IMPLEMENTED
IN_DEVELOPMENT
UNTESTED
PASS
DEGRADED
FAIL
BLOCKED
DISABLED
```

Additional states may be introduced only when they express a genuinely distinct condition.

---

## 12. Main Scheduling and Orchestration Architecture

### 12.1 Bootstrap

The bootstrap/start script performs initial mode selection, launches the correct scheduler, and exits. It is not the long-running orchestrator.

### 12.2 Low-RAM Scheduler

Purpose:

> Run the core stack with the lowest practical control-plane RAM overhead while protecting hacking income and retaining a clean upgrade path into Full Stack.

The Low-RAM Scheduler should launch and supervise only required Low-RAM processes, conservatively allocate RAM, preserve the protected hacking baseline, periodically assess Full-Stack viability, and perform a clean handoff when Full Stack becomes viable.

### 12.3 Full-Stack Scheduler

Purpose:

> Coordinate major systems, enforce global priorities/resource policy, and keep the full stack operating efficiently without duplicating domain-specific logic.

The Full-Stack Scheduler coordinates systems through declared contracts. It should allocate resources, supervise lifecycle and health, coordinate dependencies, enforce global priority rules, and support controlled recovery and fallback.

It must not absorb domain-specific strategy such as target scoring, stock trading logic, augmentation selection, or purchased-server upgrade formulas.

### 12.4 Protected Hacking Baseline

Hacking income is the highest baseline productive priority.

> **The stack must protect a productive hacking-income baseline before allocating discretionary resources to secondary systems.**

Explicitly higher-priority lifecycle/recovery operations may temporarily outrank this baseline when necessary to preserve stack correctness or recoverability.

---

## 13. Scheduler Communication

### 13.1 Port-Based Control Plane

Scheduler-to-system and system-to-scheduler communication uses assigned ports as the standard live coordination mechanism.

Where port availability permits, each major system should have two dedicated directional channels:

- Scheduler → System
- System → Scheduler

Exact numeric port assignments must be centrally declared. Systems must not contain unrelated magic port numbers or steal another system's assigned ports.

### 13.2 Standard Message Envelope

Control-plane messages should use a standardized envelope containing enough information to identify at least message type, source, target, timestamp, request/correlation identity where applicable, and payload.

Exact schema details are deferred until implementation.

### 13.3 Ports Are Not Durable Truth

Ports carry live coordination state and events. They are not the sole durable source of system truth.

Schedulers and systems must be able to reconstruct correct operation after restart without relying on stale historical port messages.

Dashboards must not compete with scheduler control-plane ports for messages.

---

## 14. Global Authority and Ownership Model

### 14.1 Purpose

The scheduler maintains a global authority/ownership mechanism so that multiple systems do not independently make conflicting decisions about the same controllable entity or domain function.

The mechanism is architectural coordination, not domain strategy.

> **Anything whose autonomous control can conflict must have one clear decision authority at a time.**

### 14.2 Decision Authority vs Resource Usage

The architecture distinguishes:

- **Control/decision authority** — which system is allowed to make autonomous strategic or lifecycle decisions about an entity or function.
- **Usage allocation** — which systems may consume some portion of a resource under scheduler policy.

Control ownership does not necessarily imply exclusive physical use of the underlying resource.

For example, the Purchased Server Fleet System may own lifecycle authority for a purchased server while RAM on that server is allocated among other systems.

### 14.3 Default and Temporary Authority

A domain normally has a default owner. Another approved subsystem may temporarily take authority over a specific entity or function when performing coordinated cross-system behavior.

While temporary authority is active, the default owner must not autonomously act on that controlled entity in a way that conflicts with the authority holder.

### 14.4 Directed Actions

Temporary authority does not require duplicating the default owner's execution machinery.

An authority holder may issue an explicit directed command to the normal domain system, which may execute that requested operation without regaining autonomous decision authority.

Conceptually:

```text
DEFAULT OWNER
    ↓
autonomous decisions allowed

TEMPORARY AUTHORITY HOLDER CLAIMS ENTITY
    ↓
default owner's autonomous decisions suppressed for that entity
    ↓
authority holder may issue explicit directed actions
    ↓
default owner executes only those approved directed actions
```

### 14.5 Stock-Manipulation Example

The normal Stock System owns autonomous trading decisions for stocks.

If a future Stock Manipulation subsystem takes authority over a symbol while coordinating a pump/dump or related strategy, the normal Stock System must not independently buy, sell, short, cover, or rebalance that symbol while the claim is active.

The manipulation controller may still issue explicit trade commands to the Stock System, allowing the Stock System to reuse its normal trade execution and position-management machinery without independently deciding to trade the controlled symbol.

Exact manipulation logic, claim schema, trade rules, and strategy remain intentionally deferred until that subsystem is implemented.

### 14.6 Cross-Domain Use

The same authority model may later apply to:

- hacking targets;
- stock symbols/trading decisions;
- purchased-server lifecycle actions;
- player work/progression tasks;
- money/capital decision domains;
- testing or recovery controllers;
- other controllable entities where autonomous systems could conflict.

### 14.7 Authority Reconciliation

When temporary authority is released, the returning default owner must reconcile current state before resuming autonomous decisions. It must not assume the controlled entity remained unchanged while another authority held control.

### 14.8 Failure and Stale Claims

Authority claims must eventually include a safe mechanism for detecting and reclaiming stale ownership after crashes or lost controllers. The exact lease, heartbeat, timeout, and recovery logic is deferred until implementation.

### 14.9 Scheduler Boundary

> **The scheduler arbitrates and records system-level authority; domain systems retain responsibility for domain-specific decisions and execution behavior.**

The scheduler must not become a centralized implementation of every domain strategy merely because it coordinates authority.

---

## 15. Major Domain Systems

### 15.1 Hacking System

Purpose:

> Convert available compute resources into reliable hacking income as efficiently as practical, while maintaining targets in appropriate money/security states and respecting scheduler resource allocations.

Architectural responsibilities include:

- target discovery/eligibility through shared data;
- target selection;
- target tuning;
- server preparation;
- RAM/thread calculation;
- execution scheduling;
- hack/grow/weaken workers;
- hacking telemetry and validation;
- recovery from actual target state after failures.

Target scoring formulas, preparation tolerances, batching algorithms, target counts, timing mathematics, and tuning logic are intentionally deferred until implementation and validation.

### 15.2 Purchased Server Fleet System

The Purchased Server Fleet System exclusively owns purchased-server lifecycle decisions, including fleet discovery, purchasing, upgrades, replacement/retirement, naming, and lifecycle policy.

Other systems may consume allocated fleet RAM but must not independently purchase, delete, replace, or upgrade purchased servers.

### 15.3 Stock System

The Stock System owns normal market trading decisions, including long/short position logic, position sizing, position management, execution, telemetry, and P&L.

Its default autonomous authority over a stock symbol may be temporarily suspended through the global authority mechanism when another approved subsystem is coordinating that symbol.

Higher-level capital/resource policy determines whether capital is available; domain trading strategy remains owned by the Stock System except where authority is explicitly delegated.

### 15.4 Progression System

The Progression System owns long-term player advancement decisions and actions, including work selection, stat growth, faction/company progression, augmentation evaluation/purchasing, and player-facing recommendations.

It should support advisory and automated behavior where appropriate.

Progression owns what advancement action should occur; the scheduler coordinates when it may act and what globally constrained resources are available.

### 15.5 Data Collection System

Purpose:

> Collect, normalize, timestamp, and expose game-state data so other systems can make decisions from a consistent view of the world instead of independently re-querying and re-deriving the same information.

Its domains may include player state, server/network state, RAM/resource state, progression state, faction/company state, augmentation state, stock state, purchased-server state, world clock, and repository/update state.

Data Collection owns acquisition and normalization of shared state. Consuming systems own decisions made from that state.

Shared data should expose enough metadata for consumers to distinguish fresh, stale-but-usable, invalid, and unavailable state.

Exact transport, schemas, and refresh cadences remain deferred until consumer requirements are known.

### 15.6 RAM Audit System

Purpose:

> Measure RAM cost of stack scripts, produce a machine-readable RAM requirement report for schedulers, and a human-readable audit for the player.

Schedulers consume RAM Audit results; they do not independently recalculate script RAM requirements.

RAM audit output is derived data. Current scripts and actual game RAM costs remain the source of truth.

Mode selection must not rely on an audit that is missing, incompatible with the current stack revision, or known stale after an update.

---

## 16. Repository Update Subsystem

The Data Collection System includes a Repository Update subsystem with separate Update Watcher and Revision Puller responsibilities.

### 16.1 Update Watcher

The Update Watcher may automatically detect whether a newer approved repository revision exists and inform the player.

> **The stack may automatically detect updates, but it must never automatically install them.**

### 16.2 Revision Puller

The Revision Puller performs an update only after an explicit player command.

### 16.3 Controlled Update Sequence

A player-authorized update follows this conceptual sequence:

```text
PLAYER AUTHORIZES UPDATE
        ↓
identify persistent scripts
        ↓
kill all non-persistent running scripts
        ↓
delete superseded non-persistent scripts/files
        ↓
pull and write approved revision
        ↓
validate revision/update integrity
        ↓
regenerate required derived data such as RAM audit
        ↓
restart normal stack
```

### 16.4 Persistent Script Exemption

Persistence is explicit and opt-in. Only scripts deliberately flagged by centralized policy as `persistent` are exempt from normal update shutdown/replacement.

Expected examples include the world clock and required persistent data-collection processes.

If a normally persistent process cannot safely survive a revision boundary, the updater may restart it as part of the authorized update.

### 16.5 Update Integrity

The updater must not report the new revision as installed until the complete authorized replacement has succeeded and required integrity checks pass.

A failed or partial replacement must not advance the recorded local revision.

---

## 17. State vs Telemetry

The architecture distinguishes operational state from telemetry.

**State** is information required to make decisions, such as player money, server security, available RAM, stock prices, positions, and progression state.

**Telemetry** is information used to understand and validate behavior, such as scheduler cycle duration, target scores, prep completion, profit rates, RAM utilization, trade P&L, update checks, errors, and decision traces.

Both may feed dashboards, but they serve different architectural purposes and should not be conflated.

---

## 18. Versioning

Project releases use the literal format:

```text
vMAJOR.MINOR.PATCH
```

Examples include `v0.4.2` and `v1.0.0`.

Semantic-versioning style meaning is used:

- **MAJOR** — intentionally incompatible architectural/interface changes;
- **MINOR** — backward-compatible features or capabilities;
- **PATCH** — fixes/refinements without a new feature contract.

Version information is release-level metadata and must have one authoritative local source rather than duplicated constants throughout the codebase.

The same release version should be exposed consistently through update metadata, validation dashboards, production dashboards, and other revision surfaces.

`v0.x.x` is appropriate during initial development. `v1.0.0` should be declared deliberately when the first stable release is considered ready.

---

## 19. Rules Still To Be Defined

The following remain intentionally open until their requirements are discussed and approved:

- project goals and explicit non-goals;
- exact feature roadmap and dependency order;
- final folder and naming conventions beyond the subsystem-design requirement;
- shared-state transport and persistence strategy;
- exact scheduler port assignments and message schemas;
- exact authority-claim schema, lease/recovery mechanics, and directed-command protocol;
- RAM allocation policy details;
- money/spending allocation policy details;
- exact Low-RAM → Full Stack viability calculation;
- error handling and retry standards;
- telemetry schema and transport;
- React dashboard architecture and component conventions;
- production dashboard requirements;
- coding style and documentation standards;
- exact repository manifest format;
- persistent-script declaration mechanism;
- updater rollback/recovery strategy;
- domain strategy algorithms intentionally deferred to implementation.

These open items must not be silently decided through implementation when they materially affect architecture. They should be discussed and added to the appropriate root or subsystem design document when their requirements become clear.
