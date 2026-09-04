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

Port 12 is the current batch slot, so a new batch can overwrite the just-completed result. To keep completed measurements visible, every `COMPLETE` payload is now also copied to **Port 15**, the latest-completed batch snapshot.

The main GUI now has a dedicated **Batch** tab that reads both states:

```text
Port 12 → current batch
Port 15 → latest completed batch
```

The Batch tab shows current batch status, last completed recovery, actual stage order, minimum spacing, maximum drift, missing events, per-stage error/spread, and a **planned-vs-actual landing timeline**. Each H/W1/G/W2 row plots planned and actual completion markers on the same horizontal axis so systematic early/late landing is visible immediately.

## Immediate next development sequence

Recommended order:

```text
1. Pull/restart and verify HGW → BATCH GUI switching completes at a safe boundary
2. Allow at least one new batch to complete
3. Inspect the Batch tab retained completed result
4. Confirm H → W1 → G → W2 actual order remains correct
5. Collect several samples of max landing error, minimum spacing, and allocation spread
6. Decide whether the fixed 200 ms gap has sufficient safety margin
7. Tune/adapt the gap only if measurements justify it
8. Only then implement overlapping/pipelined batches
```

Before pipelining, several consecutive automatic batches should recover money/security correctly, require no standalone correction work, report all worker timing events, and preserve the intended landing order with understood timing margin.

## Important architectural constraints

### Remote-only worker execution

H/G/W worker jobs do not use home as fallback capacity. Home is preserved for controller/UI work.

### One batch at a time for now

Do not jump directly to overlapping batches. The existing system deliberately serializes synchronized batches while correctness and timing are being validated.

### Execution-mode changes are scheduling barriers

`SET_EXECUTION_MODE` is not allowed to compete with fresh tactical work. When HGW/BATCH switching is pending:

- no new tactical or batch work is scheduled;
- an in-flight tactical-analysis process may be cancelled immediately because it has no target-side effect;
- already-running H/G/W workers are allowed to finish naturally;
- an already-running synchronized batch is allowed to finish naturally;
- the controller publishes the pending transition through `executionMode.pending` / `transitioning` until the safe boundary is reached;
- only then is the new execution mode applied.

This prevents a mode button from appearing ignored because the controller keeps creating new work while waiting to become idle.

### Full-batch review boundary

Standalone HGW hacks may trigger strategy review after completion. Batch-associated hacks must be ignored until the **full batch** reaches `COMPLETE`.

### Manual money goal is a hard spending lock

A manual cash goal blocks automatic cloud-server purchases and upgrades independently of possibly stale economy state.

### GUI React callbacks must stay Netscript-free

React event callbacks must not call Netscript APIs. They may only update React-local presentation state or assign plain JS request/input state. Netscript port/file operations remain in the asynchronous dashboard loop.

### GUI React tree is persistent

`ui/dashboard.js` mounts its React tree once. The main loop refreshes a cached runtime snapshot and increments a plain-JS version counter; the mounted React root observes that version and re-renders without `clearLog()` / `printRaw()` remount churn.

Tab selection is React-local and therefore immediate. Controller commands still cross the Netscript boundary through queued plain-JS requests processed by the main loop.

### Batch timing events stay separate from strategic telemetry

Port 4 remains the HACK event queue used by income/strategic refresh logic. Port 14 is dedicated to batch worker completion timing so GROW/WEAKEN timing events cannot accidentally trigger strategic review.

### Latest-completed batch is a snapshot, not history

Port 15 retains one completed batch for GUI inspection. It is not yet a rolling history/statistics store. If timing trends across many batches are needed later, add a separate history layer rather than changing Port 15 semantics implicitly.

## Important user-facing controls

Main GUI: `ui/dashboard.js`

Tabs:

- Overview
- Targets
- Economy
- **Batch**
- Network
- Diagnostics

The Batch tab is now the primary synchronized-HWGW observability surface.

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
- `docs/SYSTEM_MAP.md` — responsibility map by script/module
- `docs/RUNTIME_STATE.md` — ports, controller commands, and state contracts
- `docs/TESTING.md` — validation procedures and current acceptance criteria
- `docs/ROADMAP.md` — staged priorities and future work
