# Project Handoff Guide

This file is the recommended starting point for a new development chat or contributor.

## Repository and source-of-truth policy

Repository: `Agxnny/Agxnny-Bitburner-Scripts`

The **current GitHub `main` branch is the source of truth**. Before changing any existing script, fetch/read the current repository file first. Do not reconstruct current code from old chat transcripts, cached snippets, or memory.

The project targets **Bitburner v3.x** and is currently being developed/tested on **v3.0.1**.

After a major architectural change, refresh the documentation set before considering the change complete:

- `README.md`
- `docs/HANDOFF.md`
- `docs/architecture.md`
- any directly affected reference docs in `docs/`

## Project objective

Build a modular, low-RAM Bitburner automation system that evolves from simple distributed HGW into adaptive, synchronized, eventually pipelined/multi-target HWGW.

Core design goals:

- Home is primarily the **control/UI plane**.
- Rooted and purchased/cloud servers form the **remote execution plane**.
- H/G/W workers remain minimal and dumb.
- Important decisions are published as structured runtime state.
- The GUI consumes state and sends commands; it does not own hacking logic.
- RAM efficiency is a first-class constraint.

## Current major milestone

The system supports two runtime-selectable controller modes:

1. **Normal HGW** — sequential tactical weaken/grow/hack automation.
2. **Batched HWGW** — automatic, synchronized **one-batch-at-a-time** HWGW.

The mode can be changed from the main GUI without restarting the stack.

Current automatic batch lifecycle:

```text
select target + strategy
        ↓
prepare target to strategy baseline
        ↓
launch synchronized H / W1 / G / W2
        ↓
wait for full batch completion
        ↓
post-batch strategic review barrier
        ↓
planner + sync + economy + target review
        ↓
repair target if recovery was imperfect
        ↓
next batch
```

## Latest live validation

On 2026-09-05, the original automatic batch-mode production cycle on `sigma-cosmetics` exposed the W2 security-compensation defect:

```text
threads: 25H / 1W / 298G / 1W
money recovery: 100%
security recovery: +1.13 above minimum
```

After correcting the grow-security calculation, corrected batches used approximately:

```text
threads: 25H / 1W / 298–299G / 24W
money recovery: 100%
security recovery: minimum
standalone correction weaken: not required
```

The W2 sizing defect is considered validated enough to proceed with timing instrumentation.

## Highest-priority known issue

**Measure actual H/W1/G/W2 landing drift and stage ordering over repeated batches.**

Recovery-model telemetry is already present in Port 12. Timing instrumentation is also implemented:

- workers receive their planned landing timestamp as a batch-only argument;
- each completed batch worker writes a timing event to **Port 14**;
- the batch runner drains Port 14 while the batch is active;
- if a stage is split across hosts, the stage's actual landing is the completion timestamp of its **last allocation**;
- earliest completion and within-stage spread are retained;
- Port 12 schema version 3 publishes aggregated landing telemetry.

Port 12 is the current batch slot, so a new batch can overwrite the just-completed result. To keep completed measurements visible, every `COMPLETE` payload is also copied to **Port 15**, the latest-completed batch snapshot.

The main GUI has a dedicated **Batch** tab that reads both states:

```text
Port 12 → current batch
Port 15 → latest completed batch
```

The Batch tab shows current batch status, planned H/W1/G/W2 landing countdowns, planned total duration, W2 ETA, last completed recovery, actual stage order, minimum spacing, maximum drift, missing events, per-stage error/spread, and a **planned-vs-actual landing timeline**.

## Pipeline scheduler work has started

`hacking/batch-scheduler.js` now exists as a **dry-run-only pipeline planner**. It does not launch workers and does not replace the serialized batch runner yet.

The scheduler deliberately separates two timing controls:

```text
stage gap      = H → W1 → G → W2 spacing inside one batch
batch interval = H(N) → H(N+1) spacing between successive batches
```

The dry-run scheduler:

- calculates H/W1/G/W2 sizing for a target;
- reads retained Port 15 timing telemetry when it matches the same target;
- conservatively recommends an intra-batch stage gap using observed drift/spread;
- independently recommends an inter-batch interval;
- creates a global landing calendar;
- models stage RAM occupancy from planned start to planned landing;
- sweeps that calendar to estimate peak aggregate RAM at pipeline depths 1–12;
- publishes the latest dry-run result to **Port 16**.

Current tuning remains conservative because Port 15 holds only one completed sample. Do not aggressively reduce timing gaps from one observation. A rolling timing-history layer is required before genuinely adaptive gap reduction.

See `docs/BATCH_SCHEDULER.md` for the current design, limitations, and milestones.

## New observability layer

The controller publishes timing estimates for standalone H/G/W allocations under `execution.activeWorkers` and an aggregate `execution.currentAction` summary.

Each active worker includes:

```text
pid
hostname
threads
action
target
startedAt
expectedDurationMs
expectedFinishAt
```

The Overview GUI includes:

- current action ETA;
- an Active Workers panel with action, target, host, threads, elapsed time, ETA/status;
- read-only `LATE` highlighting after expected duration + `max(5s, 15%)`;
- no automatic termination yet;
- stale historical Port 12 `COMPLETE` state is no longer shown as the current batch;
- execution-mode transition buttons are disabled while `SWITCHING → HGW/BATCH` is pending.

This observability work is intentionally non-destructive. **Do not add automatic worker killing yet.** After batching timing is understood, add a watchdog as a separate reliability milestone using measured runtime variation and a safe recovery path for partial operations.

## Immediate next development sequence

Recommended order:

```text
1. Continue collecting serialized batch timing/recovery samples
2. Confirm H → W1 → G → W2 actual order remains correct
3. Compare measured max drift, minimum spacing, and allocation spread
4. Run the dry-run scheduler against the same target and compare its timing/RAM model with reality
5. Add rolling timing history so tuning is based on several batches, not only Port 15
6. Add host-by-host time-window RAM reservation to the scheduler
7. Redesign Port 14 consumption so one scheduler can route events for several live batch IDs without clearing the queue
8. First live pipeline test must be capped at depth 2 with immediate admission stop on timing/recovery error
9. Raise depth only after repeated depth-2 validation
10. After batch timing is stable, design watchdog kill/recovery behavior from observed runtimes
```

Before live pipelining, several consecutive automatic batches should recover money/security correctly, require no standalone correction work, report all worker timing events, and preserve the intended landing order with understood timing margin.

## Important architectural constraints

### Remote-only worker execution

H/G/W worker jobs do not use home as fallback capacity. Home is preserved for controller/UI work.

### One live batch at a time for now

The existing execution path deliberately serializes synchronized batches while correctness and timing are being validated. The new batch scheduler is dry-run only and must not be mistaken for permission to launch overlapping batches yet.

### Pipeline timing has two independent margins

Future pipelining must protect both:

- stage-to-stage spacing within a batch; and
- batch-to-batch spacing across the global landing calendar.

A safe stage gap does not guarantee a safe batch interval.

### Execution-mode changes are scheduling barriers

`SET_EXECUTION_MODE` is not allowed to compete with fresh tactical work. When HGW/BATCH switching is pending:

- no new tactical or batch work is scheduled;
- an in-flight tactical-analysis process may be cancelled immediately because it has no target-side effect;
- already-running H/G/W workers are allowed to finish naturally;
- an already-running synchronized batch is allowed to finish naturally;
- the controller publishes the pending transition through `executionMode.pending` / `transitioning` until the safe boundary is reached;
- only then is the new execution mode applied.

### Full-batch review boundary

Standalone HGW hacks may trigger strategy review after completion. Batch-associated hacks must be ignored until the **full batch** reaches `COMPLETE`.

The current per-batch review barrier is intentionally incompatible with a steady pipeline and must be redesigned before live overlapping batches are enabled.

### Manual money goal is a hard spending lock

A manual cash goal blocks automatic cloud-server purchases and upgrades independently of possibly stale economy state.

### GUI React callbacks must stay Netscript-free

React event callbacks must not call Netscript APIs. They may only update React-local presentation state or assign plain JS request/input state. Netscript port/file operations remain in the asynchronous dashboard loop.

### GUI React tree is persistent

`ui/dashboard.js` mounts its React tree once. The main loop refreshes a cached runtime snapshot and increments a plain-JS version counter; the mounted React root observes that version and re-renders without `clearLog()` / `printRaw()` remount churn.

Tab selection is React-local and therefore immediate. Controller commands still cross the Netscript boundary through queued plain-JS requests processed by the main loop.

### Batch timing events stay separate from strategic telemetry

Port 4 remains the HACK event queue used by income/strategic refresh logic. Port 14 is dedicated to batch worker completion timing so GROW/WEAKEN timing events cannot accidentally trigger strategic review.

Port 14 is currently cleared by the serialized runner before a batch. That must be removed before pipelining; one future scheduler should consume the shared queue and route events by `batchId`.

### Latest-completed batch is a snapshot, not history

Port 15 retains one completed batch for GUI inspection. It is not a rolling history/statistics store. Adaptive scheduler tuning needs a separate rolling history layer rather than changing Port 15 semantics implicitly.

### Worker lateness is diagnostic only

The current GUI can label a standalone worker `LATE`, but the controller does not kill it. A future watchdog must distinguish harmless scheduler drift from genuinely stuck work and must force target recovery after any killed partial operation.

## Important user-facing controls

Main GUI: `ui/dashboard.js`

Tabs:

- Overview
- Targets
- Economy
- **Batch**
- Network
- Diagnostics

The Batch tab is the primary synchronized-HWGW observability surface. Overview also exposes active standalone worker timing and ETA.

## Useful commands

```text
run startup.js
run diagnostics/mem-audit.js
run diagnostics/economy-targets.js
run diagnostics/income.js
run diagnostics/progression.js
run economy/manual-goal.js status
run network/inspect.js
run network/root.js
run hacking/batch-runner.js n00dles 0.10 200 1
run hacking/batch-scheduler.js phantasy 0.10 200
```

For repository updates in-game:

```text
run gitpull.js
run startup.js
```

## Development workflow for a new chat

A good first instruction is:

```text
Continue my Bitburner automation project from GitHub.
Read docs/HANDOFF.md first, then inspect the current live files before editing anything.
The current priority is the highest-priority known issue in the handoff document.
Keep GitHub main as the source of truth and refresh the docs after major changes.
```

## Related documentation

- `docs/README.md` — documentation index
- `docs/architecture.md` — architectural design and data flow
- `docs/BATCH_SCHEDULER.md` — dry-run pipeline scheduler design and milestones
- `docs/SYSTEM_MAP.md` — responsibility map by script/module
- `docs/RUNTIME_STATE.md` — ports, controller commands, and state contracts
- `docs/TESTING.md` — validation procedures and current acceptance criteria
- `docs/ROADMAP.md` — staged priorities and future work
