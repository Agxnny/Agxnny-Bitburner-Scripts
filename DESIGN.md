# Agxnny Bitburner Script Stack — Design Constitution

## 1. Authority and Purpose

This document is the architectural and implementation source of truth for this repository.

When implementation and `DESIGN.md` conflict, the implementation is considered incorrect unless this document is deliberately amended.

The purpose of this document is to prevent architectural drift, uncontrolled scope expansion, skipped implementation stages, untestable systems, and monolithic scripts as the stack grows.

Changes to these rules must be intentional. A convenient implementation shortcut is not sufficient reason to violate them.

---

## 2. Core Engineering Philosophy

### 2.1 Complexity Must Earn Its Cost

Bitburner RAM is a first-class resource. Additional managers, services, APIs, abstractions, telemetry, and scheduling machinery must provide enough value to justify their runtime and implementation cost.

Correctness and reliability come before theoretical optimization.

### 2.2 One Responsibility, Clear Ownership

Each component must have a clear responsibility and ownership boundary. Decision-making belongs in managers/controllers; execution workers should remain small and deterministic wherever practical.

Two independent systems must not unknowingly own the same RAM, money, jobs, or subsystem state.

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

### 3.4 Central Mode Selection

Operating mode is selected centrally. Individual workers and unrelated modules must not independently decide whether the stack is in Low-RAM or Full Stack Mode.

The stack should eventually support:

- `auto` — automatically determine the viable operating mode;
- `low` — force Low-RAM Mode for testing or operation;
- `full` — force Full Stack Mode for testing or operation.

### 3.5 Viability-Based Transition

The transition to Full Stack Mode should ultimately be based on usable resources and the actual cost of the advanced stack, rather than an arbitrary home-RAM number.

Conceptually:

```text
full-stack viable =
    available worker RAM
    >= control-plane RAM
     + minimum useful workload RAM
     + safety reserve
```

Mode transitions should be automatic and, where practical, reversible.

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

Helper work is subordinate to the active feature. It does not replace or cancel the parent feature.

Once the required helper is complete, implementation returns immediately to the parent feature.

### 6.3 Minimal Helper Scope

A helper should implement what the current feature requires. It must not become an excuse to build speculative future systems.

### 6.4 No Jumping Ahead

Later-stage functionality must not be implemented unless it is directly required to complete the currently approved feature.

### 6.5 Dependencies Before Dependents

If an active feature reveals a required dependency, that dependency becomes temporary subordinate work. It must be implemented and validated before dependent work proceeds.

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

The validation suite is optimized for proving correctness and diagnosing failures. Production dashboards are optimized for operating and understanding a validated system.

### 9.2 Data-Driven UI

Feature-specific behavior must not be unnecessarily hard-coded into React presentation components.

Features should expose standardized telemetry and validation contracts. The dashboard consumes and renders those contracts.

### 9.3 Ownership Rule

> **Features own their validation logic and telemetry definitions; the React validation suite owns presentation, test execution orchestration where appropriate, and aggregation.**

---

## 10. Validation Dashboard Tabs

The testing/validation suite has three primary functional tabs.

### 10.1 Active / In Development

This is the primary engineering surface for the current active feature and any directly subordinate helper work.

It should expose all information useful for active development and validation, including where applicable:

- live telemetry;
- current feature/module state;
- test parameters;
- expected values;
- actual values;
- acceptance criteria;
- individual test results;
- timing information;
- resource usage;
- errors and warnings;
- explicitly approved debug/test controls.

The goal is to make the active feature observable enough to prove whether it behaves correctly and diagnose why it does not.

### 10.2 Completed / Validated

Features that have passed their completion gate move to the Completed / Validated surface rather than disappearing from observation.

This tab should retain appropriate information such as:

- validated features;
- current health;
- regression status;
- latest validation result;
- last validation time where useful;
- persistent operational telemetry relevant to continued correctness.

Completed features remain subject to regression and health monitoring.

### 10.3 Overall Testing

The Overall Testing tab provides a whole-stack health check across all known systems, whether complete, incomplete, active, disabled, or blocked.

Its responsibilities include:

- running or aggregating system-wide health checks;
- showing all known modules/features;
- dependency health;
- mode-specific checks;
- warnings and failures;
- cross-system consistency checks;
- an overall stack health assessment.

Incomplete systems must not be hidden or falsely reported as healthy.

The overall suite should eventually detect disagreements between systems that individual feature tests cannot detect, such as conflicting views of network state, resource ownership, scheduler state, or worker execution.

---

## 11. Standard Health Vocabulary

Validation and telemetry should use a shared health vocabulary so that modules and dashboards communicate consistently.

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

Additional states may be introduced only when they express a genuinely distinct condition that cannot be represented cleanly by the existing vocabulary.

---

## 12. Initial Architectural Direction

The eventual stack is expected to follow a hierarchy broadly similar to:

```text
bootstrap
   │
   ├── infrastructure
   │     ├── network discovery/rooting
   │     ├── purchased servers
   │     └── resource accounting
   │
   ├── hacking
   │     ├── target selection
   │     ├── preparation
   │     ├── scheduling
   │     └── workers
   │
   ├── economy
   │     ├── hacknet
   │     ├── stocks
   │     └── spending policy
   │
   └── progression
         ├── factions
         ├── augmentations
         ├── sleeves
         ├── gangs
         └── corporations
```

This diagram is directional rather than a commitment to implement every listed subsystem. Actual scope and implementation order will be defined deliberately before construction.

---

## 13. Rules Still To Be Defined

The following areas remain intentionally open until requirements for the script stack are discussed and approved:

- project goals and explicit non-goals;
- exact feature roadmap and dependency order;
- folder and naming conventions;
- inter-module communication mechanisms;
- persistent/shared state strategy;
- RAM ownership and allocation policy;
- money/spending ownership policy;
- exact Low-RAM → Full Stack viability calculation;
- error handling and retry standards;
- telemetry schema and transport;
- React dashboard architecture and component conventions;
- production dashboard requirements;
- coding style and documentation standards;
- release/versioning policy.

These open items must not be silently decided through implementation when they materially affect architecture. They should be discussed and added to this document when their requirements become clear.
