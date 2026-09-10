# Agxnny Bitburner Script Stack — Design Constitution

## 1. Authority and Purpose

This document is the architectural and implementation source of truth for this repository.

When implementation and `DESIGN.md` conflict, the implementation is considered incorrect unless this document is deliberately amended.

The root `DESIGN.md` is the highest-level design authority. Major systems and subsystems should maintain local `DESIGN.md` files that refine this architecture without contradicting it.

Implementation details that are not yet justified should remain explicitly deferred rather than being silently locked through code.

---

## 2. Project Goals and Non-Goals

### 2.1 Primary Goal

> Build a reliable, modular Bitburner automation stack that can operate across different stages of a run, maximize useful progression with strong emphasis on hacking income, recover from normal runtime changes, and remain understandable, testable, and maintainable as it grows.

### 2.2 Goals

The stack should:

- operate reliably from constrained early-game conditions through richer Full Stack operation;
- protect productive hacking income as the highest baseline productive priority;
- use modular ownership and explicit interfaces rather than hidden coupling;
- treat RAM and capital as first-class globally coordinated resources;
- reconstruct correct behavior from observable game state after expected restarts/failures;
- make important decisions observable and testable through telemetry and validation;
- prefer maintainability and correctness over cleverness or theoretical optimization;
- support advisory and automated progression behavior from the same underlying plans where practical;
- evolve through controlled versioned updates rather than silent runtime mutation;
- keep the player able to understand current mode, intent, blockers, resource use, health, and major automated decisions.

### 2.3 Optimization Hierarchy

When goals conflict, prefer:

```text
1. Correctness / recoverability
2. Maintain productive hacking income
3. Progress the run
4. Efficient use of RAM and capital
5. Throughput / optimization
6. Convenience and polish
```

### 2.4 Non-Goals

The project is not trying to:

- automate every possible Bitburner action merely because an API exists;
- achieve mathematically perfect global optimization at the expense of complexity, RAM, reliability, or maintainability;
- become a loose collection of unrelated standalone scripts;
- rely on manual startup order or manual recovery as a normal operating requirement;
- duplicate domain strategy across Low-RAM/Full modes, dashboards, or advisory/automated paths without a strong reason;
- sacrifice readability for trivial RAM or line-count savings;
- silently perform high-impact or irreversible operations without the appropriate validation and authority boundary.

### 2.5 Explainable Intent

The stack should eventually be able to explain, through state/telemetry, what mode it is in, what it is trying to accomplish, what is using RAM/money, what is blocked, and why major domain decisions were made.

---

## 3. Core Engineering Philosophy

### 3.1 Complexity Must Earn Its Cost

Bitburner RAM is a first-class resource. Additional managers, services, APIs, abstractions, telemetry, and scheduling machinery must provide enough measurable value to justify runtime and implementation cost.

Correctness and reliability come before theoretical optimization.

### 3.2 One Responsibility, Clear Ownership

Each component must have a clear responsibility and ownership boundary. Decision-making belongs in managers/controllers; execution workers should remain small and deterministic wherever practical.

Two independent systems must not unknowingly own the same RAM, money, jobs, targets, decisions, or subsystem state.

### 3.3 Central Coordination, Distributed Execution

Higher-level components decide what work should occur. Lightweight workers execute that work. Workers should not independently recreate strategic decisions already owned by managers.

### 3.4 Explicit State and Deterministic Behavior

Prefer explicit arguments, defined state interfaces, telemetry contracts, ports/files where appropriate, and deterministic decisions. Hidden state and accidental coupling are architectural defects.

### 3.5 Automatic Recovery

The stack should recover cleanly from script termination, server changes, newly rooted hosts, restarts, and other expected runtime changes. Manual startup order should not be normal glue.

### 3.6 Central Configuration

Shared thresholds, IDs, paths, port assignments, feature flags, mode policies, reserves, and similar cross-cutting settings should have one centrally owned configuration source rather than duplicated constants.

### 3.7 Intentional Logging

Normal operation should remain quiet enough to be useful. Managers may report meaningful state and failures; high-volume workers should suppress repetitive noise unless actively being debugged.

### 3.8 No Cleverness Without Measurable Benefit

Complex scheduling, RAM tricks, timing correction, predictive behavior, and other sophisticated mechanisms should only be introduced when they solve a demonstrated limitation.

---

## 4. Operating Modes and Lifecycle

The stack has exactly two primary operating regimes.

### 4.1 Low-RAM Mode

Low-RAM Mode is a deliberate early/resource-constrained regime prioritizing minimal control-plane overhead, simple reliable logic, few persistent managers, and productive RAM use.

It is not a crippled Full Stack or an excuse for monolithic scripts.

### 4.2 Full Stack Mode

Full Stack Mode becomes appropriate when resources justify richer scheduling, shared state, resource allocation, telemetry, automation, and optimization.

### 4.3 Shared Architecture

Both modes are modes of one architecture and should share modules, workers, interfaces, configuration, state/telemetry contracts, and conventions wherever RAM-efficient.

### 4.4 Bootstrap

The bootstrap/start script is one-shot. It evaluates viability, honors `auto` / `low` / `full`, launches the appropriate scheduler, and exits.

### 4.5 Mode Transition

The Low-RAM Scheduler periodically determines whether Full Stack is viable and performs a controlled handoff. Full Stack should support controlled fallback with hysteresis when sustained non-viability is detected.

Conceptually:

```text
full-stack viable =
    available worker RAM
    >= control-plane RAM
     + minimum useful workload RAM
     + safety reserve
```

Exact thresholds remain deferred until RAM Audit and runtime measurements exist.

### 4.6 Separate Lifecycle Mechanisms

The architecture distinguishes:

1. initial boot;
2. mode transition;
3. player-authorized repository update.

These mechanisms must not be conflated.

---

## 5. Module and Source Discipline

All major systems use module-based architecture. Managers, schedulers, selectors, resource logic, configuration, utilities, telemetry, validation/UI, and workers should be separated along real responsibility boundaries.

Modules are responsibility boundaries, not arbitrary file fragmentation. Systems communicate through defined contracts rather than reaching into one another's internals.

Workers remain dumb wherever practical.

### 5.1 Source File Limits

- target maximum: 400 lines per source file;
- hard maximum: 500 lines unless a deliberate exception is documented;
- split along responsibility boundaries;
- generated/static/documentation artifacts may be exempt;
- never compress code into unreadable one-liners to game the limit.

---

## 6. Implementation Discipline

Only one roadmap feature may be the primary active implementation target at a time.

Necessary helpers, interfaces, test facilities, or direct prerequisites may temporarily become subordinate work, but implementation returns to the active feature afterward.

Dependencies are implemented before dependents. Stubs, fake data, TODOs, bypasses, or incomplete branches do not count as completion unless explicitly approved for a prototype stage.

Substantial scope expansion requires design review rather than silent implementation. Refactoring is allowed when required for correctness, maintainability, validation, or design compliance.

Once an implementation roadmap is established, its dependency/build order is authoritative until deliberately revised.

---

## 7. Feature Lifecycle and Validation

Features use:

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

`BLOCKED` and `FAILED` may be used where appropriate.

`IMPLEMENTED` does not mean finished. `COMPLETE` requires defined acceptance criteria and mandatory validation to pass.

Before substantive implementation, a feature defines expected behavior, acceptance criteria, failure conditions, telemetry required to prove correctness, relevant test parameters, and mode-specific expectations.

Validation should include, where applicable:

1. module-level validation;
2. integration validation;
3. real Bitburner runtime validation.

Helpers are validated. Bugs should gain regression checks where practical. Mode-specific behavior is tested in relevant modes. Complex/timing-sensitive systems must be observable before optimization.

Instrumentation must not become a production dependency or materially distort RAM/timing.

---

## 8. React Validation and Dashboard Architecture

React is the standard UI technology for validation dashboards and later production dashboards.

Features own validation logic and telemetry definitions; the React validation suite owns presentation, aggregation, and permitted test orchestration.

Validation UI and production operational dashboards remain conceptually separate but may share components, schemas, selectors, and rendering primitives.

The validation suite has three primary surfaces:

1. **Active / In Development** — current feature, subordinate helpers, live telemetry, test inputs/results, acceptance criteria, timing/resource data, errors/warnings, and approved debug controls.
2. **Completed / Validated** — health/regression visibility for completed features.
3. **Overall Testing** — cross-system health, ownership/resource conflicts, inconsistent state, scheduler disagreements, and integration failures.

Dashboard architecture should be data-driven: UI components consume state/telemetry contracts rather than embedding domain strategy.

Production logic must continue to function correctly with dashboards closed. Dashboard/control actions are explicit and permissioned; dashboards do not acquire hidden production authority.

Exact React component conventions and production layout remain deferred until UI implementation.

---

## 9. Standard Health Vocabulary

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

Additional health states require a genuinely distinct semantic condition.

Repository state such as `UPDATE_AVAILABLE` is not automatically a health failure.

---

## 10. Scheduling and Global Resource Coordination

### 10.1 Scheduler Boundary

The Scheduler coordinates major systems, global priorities, resource policy, authority, lifecycle, health, recovery, and mode transitions. It does not absorb domain-specific strategy.

### 10.2 Protected Hacking Baseline

> The stack must protect a productive hacking-income baseline before allocating discretionary resources to secondary systems.

Critical lifecycle/recovery actions may temporarily outrank this baseline when required for correctness or recoverability.

### 10.3 Global RAM Allocation

The Scheduler is the global RAM-allocation authority. Domain systems decide how to use granted RAM but must not assume globally free RAM belongs to them.

Conceptual allocation layers are:

```text
TOTAL RAM
- SAFETY RESERVE
- SYSTEM / CONTROL-PLANE RAM
- PROTECTED PRODUCTIVE RAM
= DISCRETIONARY CAPACITY
```

Conceptual classes include `SYSTEM`, `PROTECTED`, normal `ALLOCATED`, and temporary `BURST` capacity.

Normal allocations are hard ceilings, not consumption targets. Demand should be expressible as minimum useful, preferred, and maximum useful capacity. Exact fields are deferred.

Hacking receives a protected baseline and may consume otherwise-idle allocatable RAM when no stronger approved claim exists.

Reclamation should normally be cooperative: stop scheduling new work, drain existing short-lived work where practical, report release, then reallocate. Forced termination is reserved for transitions, updates, recovery, emergency pressure, or non-drainable work.

Physical placement and accounting must agree. If scheduler accounting conflicts with observable Bitburner RAM state, observed state wins and accounting is reconciled.

### 10.4 Global Capital Allocation

The Scheduler owns global spending permission/reservation accounting; domain systems own purchasing/investment strategy.

> Domain systems decide what is worth buying; the global capital allocator decides whether money is available to commit.

Conceptually:

```text
PLAYER MONEY
- PROTECTED CASH RESERVE
- ACTIVE CAPITAL RESERVATIONS
= AVAILABLE CAPITAL
```

Meaningful spending uses explicit reservations so multiple systems cannot count the same cash as available. A reservation identifies at least owner, amount, purpose, and lifecycle; exact schema/expiry rules are deferred.

Stock positions are committed capital, not ordinary free cash. The Scheduler may request liquidity for a higher-priority objective; Stock decides how to unwind positions within policy.

Expensive/irreversible spending requires current domain validation and current capital authorization immediately before execution.

Exact reserve values and arbitration formulas remain deferred.

---

## 11. Scheduler Communication

Scheduler-to-system and system-to-scheduler communication uses centrally assigned ports where port availability permits.

Exact numeric assignments are centrally declared; systems must not steal or hard-code unrelated ports.

A standard message envelope conceptually includes:

```text
type
source
target
timestamp
requestId
correlationId
payload
```

`requestId` identifies a request/response interaction. `correlationId` ties related cross-system operations together.

Global message families should remain small and broad, such as resource, authority, lifecycle, health, state-notification, action, and result messages.

Ports carry live coordination/events, not durable truth. Missing old port history must not prevent restart reconstruction. Dashboards must not compete for production control messages.

A failed control-plane write must be observable and handled. Critical commands must not silently disappear.

Only commands whose correctness depends on confirmed receipt/completion require explicit acknowledgement/result; informational notifications may remain fire-and-forget.

Exact port numbers, serialization, retry, queue, and backpressure mechanics remain deferred.

---

## 12. Global Authority and Ownership

> Anything whose autonomous control can conflict must have one clear decision authority at a time.

The architecture distinguishes decision authority from resource usage allocation.

At most one autonomous decision authority may exist for a controllable entity at a time. A domain has a default owner; another approved subsystem may temporarily claim a narrowly scoped entity/function.

Conceptual states are:

```text
DEFAULT
EXCLUSIVE
DIRECTED
RELEASING
```

While another owner holds authority, the default owner suppresses conflicting autonomous decisions. The authority holder may issue directed actions through the normal domain executor without returning autonomous authority.

Claims are explicit and conflict-aware; inactivity is not evidence of ownership. Existing valid claims are normally denied/deferred to competing requesters rather than automatically preempted.

Temporary authority must be recoverable after controller failure using lease/heartbeat or equivalent stale-owner detection. Exact timeout mechanics remain deferred.

When authority is released or reclaimed, the returning default owner must reconcile current observed state before resuming autonomous decisions.

The Scheduler arbitrates and records global authority; domain systems retain domain strategy and execution behavior.

---

## 13. Shared State and Telemetry

### 13.1 Separation

> State exists so systems can make decisions. Telemetry exists so humans and validation systems can understand, prove, and diagnose those decisions.

A system must not need to scrape logs/telemetry to reconstruct authoritative operational state.

### 13.2 Shared State

Data Collection owns acquisition/normalization of shared state. Consuming systems own decisions made from that state.

Shared state is domain-oriented rather than one monolithic object. Each snapshot conceptually carries:

```text
domain
schemaVersion
generatedAt
valid
freshness
source
data
```

Architectural default transport is durable JSON-compatible domain snapshots/files, with ports used only for lightweight notifications. Exact filenames/serialization remain deferred.

A new snapshot replaces the current one only after successful acquisition, normalization, and validation. Publication must be atomic from the consumer's perspective.

Failed refresh normally preserves the last known valid snapshot and lets it age; it must not publish partial/empty garbage over known-good state.

Consumers distinguish:

```text
FRESH
STALE
INVALID
UNAVAILABLE
```

Freshness requirements belong to the consumer contract rather than one universal timeout.

Incompatible schema versions are rejected rather than silently misinterpreted.

Shared state primarily represents current truth. Large/indefinite history belongs in telemetry unless a specific decision contract requires otherwise.

### 13.3 Telemetry

Each major system should expose a compact current telemetry/health summary and may emit important operational events.

A common event envelope conceptually includes:

```text
type
source
timestamp
severity
correlationId
payload
```

Common severity levels are `DEBUG`, `INFO`, `WARN`, and `ERROR`. Event severity is distinct from overall system health.

Routine loop iterations and high-volume worker noise should not automatically become events.

Cross-system actions should use correlation identifiers where practical so objectives, requests, approvals, execution, refresh, and results can be traced together.

Telemetry history must be bounded. Telemetry failure should normally not stop safe production behavior; shared-state failure may block/degrade consumers when safe decisions are no longer possible.

Dashboards observe state/telemetry but are not part of the production control path.

---

## 14. Global Error, Retry, and Recovery Standard

Failures are classified by effect rather than retried blindly.

Broad categories are:

- **transient** — likely safe to retry;
- **dependency-blocked** — cannot succeed until another dependency/state changes;
- **validation/state conflict** — requires refresh/reconciliation/replan before retry;
- **terminal for current operation** — should fail the operation rather than loop;
- **systemic** — repeated or control-plane failure requiring scheduler-level recovery.

Retries must be bounded and observable. Tight infinite retry loops are prohibited.

Transient failures should use capped backoff or equivalent spacing rather than immediate busy-loop retries. Exact counts/intervals are centrally configurable and deferred until implementation.

A blocked dependency should produce `BLOCKED` rather than repeated restarts. Repeated recoverable failures may produce `DEGRADED`; inability to perform the system's essential responsibility produces `FAIL`.

Recovery escalation is conceptually:

```text
RETRY_OPERATION
→ RESTART_COMPONENT
→ RESTART_SYSTEM
→ MODE_FALLBACK
```

Not every failure traverses every level. Recovery must be dependency-aware and should use current observed state rather than assuming previous work completed.

Irreversible/destructive operations are not blindly retried after ambiguous outcomes; they must first reconcile observed state.

Telemetry/dashboard failure is normally non-fatal to production logic. Shared-state/control-plane failures may become blocking if correctness cannot be guaranteed.

---

## 15. Major Domain Systems

### 15.1 Hacking

Converts available compute into reliable hacking income, owns target selection/tuning/preparation/execution/thread distribution within Scheduler allocation, and uses dumb hack/grow/weaken workers. Exact scoring/timing/batching formulas remain subsystem implementation details.

### 15.2 Purchased Server Fleet

Exclusively owns purchased-server lifecycle decisions: discovery, purchase, upgrade/replacement, naming, and capacity publication. Others may consume allocated RAM but may not independently mutate fleet lifecycle.

### 15.3 Stock

Owns normal trading strategy, position management, execution, and P&L. Global capital policy determines available capital; temporary symbol authority may suspend autonomous Stock decisions for coordinated manipulation.

### 15.4 Progression

Owns what player advancement should occur, including activity/stat/faction/company/augmentation planning and recommendations. Scheduler controls globally constrained resources/authority; Progression does not seize them independently.

### 15.5 Data Collection

Owns collection, normalization, timestamping, validation, and publication of shared player/server/resource/progression/faction/company/augmentation/stock/fleet/world-clock/repository state.

### 15.6 RAM Audit

Measures current script RAM cost, classifies it by role/mode, and publishes machine/human-readable audit output. Runtime Bitburner RAM measurements are authoritative. Invalid/stale audit output cannot be used as valid scheduling input.

Subsystem `DESIGN.md` files define these domains in greater detail.

---

## 16. Repository Update Subsystem

Data Collection contains separate Update Watcher and Revision Puller responsibilities.

The stack may automatically detect updates but must never automatically install them.

Installation requires explicit player authorization.

Conceptual sequence:

```text
PLAYER AUTHORIZES UPDATE
→ identify persistence policy
→ stop replaceable runtime code
→ install complete approved revision
→ validate revision/integrity
→ regenerate derived data such as RAM Audit
→ restart normal stack
```

Persistence is explicit and opt-in through centralized metadata/policy. A process must not infer persistence from its name or runtime state.

The updater uses a revision manifest/inventory sufficient to know the expected managed files, release/revision identity, compatibility metadata, and validation requirements. Exact file format remains deferred.

Update installation should be staged so a partially fetched/replaced revision is not declared current. The authoritative local revision advances only after complete validation succeeds.

If download/write/validation fails, the updater preserves or restores the last known valid runnable revision where practical and reports the failure. It must not knowingly leave a mixed revision marked healthy.

If startup of the new revision fails after installation, recovery should prefer the last known valid revision when safely available; otherwise leave the stack in an explicit failed/recovery state rather than silently pretending success.

Persistent processes may be restarted when incompatible with the target revision.

Exact manifest serialization, staging mechanism, backup/rollback mechanics, and persistence declaration format remain deferred until updater implementation.

---

## 17. Repository, Folder, Naming, and Coding Conventions

The repository should remain responsibility-oriented.

Broad structure should use:

```text
systems/<system>/...
shared/...
config/...
ui/...
tests/...
```

where justified by implementation. Subsystems remain under their owning system. Final exact paths may evolve, but source should not be organized by arbitrary file type when doing so obscures ownership.

Major systems/subsystems keep local `DESIGN.md` documents.

Cross-cutting contracts/utilities belong in shared modules only when more than one system genuinely needs them; avoid a dumping-ground `utils` layer.

Central configuration owns magic IDs/ports/paths/reserves/shared thresholds. Domain-specific strategy values remain with their domain unless globally coordinated.

Names should describe responsibility rather than implementation accident. Prefer consistent lower-case/kebab-case file/folder names and clear exported function/type names. Exact lint/style tooling remains deferred.

Functions/modules should favor explicit inputs/outputs and deterministic pure logic where practical. Side effects should be concentrated in executors/adapters/managers so they can be validated.

Comments/documentation should explain contracts, invariants, non-obvious reasoning, and tradeoffs rather than restating code.

Errors should carry enough context to identify source, operation, and cause without relying on verbose worker logs.

---

## 18. Versioning

Releases use:

```text
vMAJOR.MINOR.PATCH
```

Semantic-versioning style meaning applies:

- MAJOR — intentionally incompatible architectural/interface changes;
- MINOR — backward-compatible features/capabilities;
- PATCH — fixes/refinements without a new feature contract.

Version information has one authoritative local source and is exposed consistently through update metadata and dashboards.

`v0.x.x` is appropriate during initial development. `v1.0.0` is declared deliberately when the first stable release is ready.

---

## 19. Rules Still Intentionally Deferred

The following remain open because they depend on implementation measurements or later validated requirements:

- exact feature roadmap and dependency order;
- exact final source tree beyond the conventions above;
- exact state/telemetry filenames and serialized schemas;
- exact scheduler port assignments and serialized message schema;
- exact authority claim schema, lease duration, heartbeat interval, stale-claim timeout, and preemption protocol;
- exact RAM allocation sizes, host-placement policy, reclamation timing, and safety reserve;
- exact capital reserve, reservation expiry, and arbitration formulas;
- exact Low-RAM → Full viability thresholds/hysteresis;
- exact retry counts/backoff intervals/recovery thresholds;
- exact React component/layout conventions and production dashboard layout;
- exact repository manifest/persistence/rollback serialization and staging mechanics;
- domain strategy algorithms such as target scoring, batching math, stock signals, Fleet ROI, training selection, and augmentation valuation.

These details must be deliberately specified when requirements are measurable. They must not be silently decided through implementation when they materially affect architecture.
