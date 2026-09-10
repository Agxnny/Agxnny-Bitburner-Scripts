# RAM Audit System — Design

## Authority

This document refines the root repository `DESIGN.md` for the RAM Audit System. The root `DESIGN.md` remains authoritative if the two conflict.

Exact viability thresholds, safety reserves, script metadata format, and historical comparison mechanics remain intentionally deferred until implementation and validation.

## Purpose

> Measure the RAM cost of the current stack, classify that cost by role and operating mode, and publish both human-readable and machine-readable audit results for mode selection, scheduling, validation, and diagnostics.

## Ownership Boundary

RAM Audit owns measurement and classification of software RAM requirements.

The Scheduler owns runtime allocation and mode policy.

The Hacking System owns workload sizing and thread demand.

Data Collection's Resource State owns the current runtime picture of total/used/free/allocatable RAM.

> RAM Audit answers "what does the software cost?"; Resource State answers "what RAM exists right now?"; Scheduler decides how available RAM is allocated.

## Internal Structure

```text
RAM Audit System
├── Script Discovery
├── RAM Measurement
├── Script Classification
├── Dependency / Entrypoint Analysis
├── Mode Requirement Calculator
├── Audit Validator
├── Machine-Readable Publisher
├── Terminal Reporter
└── Telemetry / Validation
```

## Script Discovery and Classification

The audit should discover runtime-relevant stack scripts and classify them by responsibility, for example:

- bootstrap;
- scheduler;
- manager/controller;
- worker;
- collector;
- dashboard;
- utility;
- updater;
- test/validation;
- optional tooling.

Scripts should also carry mode applicability such as Low-RAM, Full Stack, shared, or optional.

The audit must not simply sum every source file, because mutually exclusive, imported, transient, and optional files would make that result misleading.

## Measurement Source of Truth

Actual Bitburner runtime RAM measurement for executable entry scripts is authoritative wherever possible.

> RAM audit results must be derived from current executable script costs, not hand-maintained RAM estimates.

Manual metadata may classify a script but should not normally declare its RAM cost.

Imported modules must be accounted for as Bitburner charges the executable entrypoint. Module source-file RAM must not be naively double-counted on top of the measured runtime cost.

## Persistent vs Transient Cost

The audit should distinguish at least:

- persistent control-plane RAM;
- persistent shared-service RAM;
- transient/on-demand script RAM;
- optional/dashboard/test RAM;
- worker RAM per thread;
- minimum useful workload RAM where policy provides enough information to calculate it.

A total of all repository scripts is diagnostic information, not by itself a valid operating-mode requirement.

## Worker Costs

Hack/grow/weaken and similar worker entrypoints should be reported as per-thread costs.

RAM Audit reports worker unit cost. Domain systems determine requested thread counts and workload composition.

## Mode Requirement Calculation

The audit should calculate the measured software-cost components needed by Low-RAM and Full-Stack viability decisions.

Conceptually:

```text
Low-RAM requirement
= required Low-RAM control plane
+ essential shared services
+ minimum useful workload cost supplied by policy
+ configured reserve component

Full-Stack requirement
= required Full-Stack control plane
+ required shared services
+ minimum useful workload cost supplied by policy
+ configured reserve component
```

The exact threshold and reserve policy remain Scheduler/bootstrap concerns.

> RAM Audit describes what the stack costs; it does not decide which mode should run.

## Machine-Readable Audit

The audit should publish a structured artifact containing enough information for schedulers and validation to consume safely.

Conceptual fields may include:

```text
schemaVersion
stackVersion
repositoryRevision
generatedAt
status
mode summaries
worker costs
script measurements
classification metadata
measurement failures
```

Exact serialization and field names are deferred.

## Validity and Staleness

A machine-readable audit must not be treated as valid scheduling input when it is:

- missing;
- incomplete;
- incompatible with the current audit schema;
- incompatible with the current stack version/revision;
- known stale after source/update changes;
- produced with failed required measurements.

A partial diagnostic report may still be shown to the player, but it must not masquerade as a valid audit.

> Mode selection must not rely on an audit that is missing, incompatible with the current stack revision, or known stale after an update.

## Update Integration

After an authorized repository update, required RAM audit data should be regenerated and validated before normal mode selection/scheduling relies on it.

Conceptually:

```text
revision installed
→ RAM audit regenerated
→ audit validated
→ normal scheduler startup
```

Exact recovery behavior when audit regeneration fails is deferred.

## Terminal Report

Manual audit output should make RAM cost easy to understand and should include, where useful:

- Low-RAM mode totals;
- Full-Stack mode totals;
- persistent/shared/transient breakdowns;
- worker per-thread costs;
- highest-cost runtime scripts;
- failed/incomplete measurements;
- audit version/revision status.

Historical delta reporting between valid audits is desirable but not required for the first implementation.

## Lifecycle

RAM Audit should be transactional/on-demand rather than a permanent control-plane process.

Expected triggers include:

- startup when required audit data is absent or invalid;
- after repository update;
- after known source changes;
- explicit manual audit;
- validation runs.

It should exit after publishing/reporting its result.

## Failure Behavior

Measurement failure should produce an incomplete/invalid audit status rather than guessed data.

The system should report which required scripts failed measurement and preserve enough diagnostics to correct the issue.

Schedulers must reject invalid scheduling input according to their own recovery policy.

## Telemetry

Potential telemetry includes:

- audit status;
- stack/repository version;
- audit schema version;
- generation time/duration;
- script count;
- measurement failure count;
- Low-RAM requirement;
- Full-Stack requirement;
- persistent RAM totals;
- worker unit costs;
- largest scripts;
- deltas from previous valid audit where supported.

## Validation Expectations

Validation should prove that:

- every required runtime entrypoint is represented;
- measured RAM agrees with Bitburner's current runtime measurement;
- imports are not naively double-counted;
- mode classifications are internally consistent;
- worker per-thread costs are available;
- failed required measurement cannot yield a valid audit;
- stale/incompatible audits are rejected;
- repository updates invalidate/regenerate required audit data;
- the audit process exits after completion.

## Deferred Implementation Details

Intentionally deferred:

- exact script-discovery manifest format;
- exact role/mode metadata mechanism;
- exact reserve and minimum-useful-workload policy inputs;
- exact stale-detection mechanism;
- exact machine-readable file format/path;
- exact historical delta storage;
- exact failure recovery chosen by bootstrap/schedulers.
