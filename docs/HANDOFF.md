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

Markdown documentation is not part of the in-game manifest and does not need to be downloaded into Bitburner unless desired for reference.

## Project objective

Build a modular, low-RAM Bitburner automation system that evolves from simple distributed HGW into adaptive, synchronized, eventually pipelined/multi-target HWGW.

Core design goals:

- Home is primarily the **control/UI plane**.
- Rooted and purchased/cloud servers form the **remote execution plane**.
- H/G/W workers remain minimal and dumb.
- Expensive analysis runs as short-lived remote services where possible.
- Important decisions are published as structured runtime state.
- The GUI consumes state and sends commands; it does not own hacking logic.
- Progression, purchasing, targeting, scheduling, and presentation remain separable layers.
- Automatic systems should explain why they are waiting, blocked, or acting.
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

The strict review barrier is important: batch hack telemetry must **not** trigger strategy review before W1/G/W2 have finished.

## Latest live validation

On 2026-09-05, the original automatic batch-mode production cycle on `sigma-cosmetics` exposed the W2 security-compensation defect:

```text
threads: 25H / 1W / 298G / 1W
money recovery: 100%
security recovery: +1.13 above minimum
```

After correcting the grow-security calculation, the first live corrected batch on the same target used:

```text
threads: 25H / 1W / 298G / 24W
money recovery: 100%
security recovery: 3.00 / 3.00
standalone correction weaken: not required
```

Following automatic cycles continued to size W2 correctly, including `25H / 1W / 299G / 24W`, and returned to the expected money/security baseline. The W2 sizing defect is considered sufficiently validated to proceed with timing instrumentation.

## Highest-priority known issue

**Measure actual H/W1/G/W2 landing drift and stage ordering over repeated batches.**

Recovery-model telemetry is already present in Port 12. The next timing layer is now implemented:

- workers receive their planned landing timestamp as a batch-only argument;
- each completed batch worker writes a tiny timing event to **Port 14**;
- the batch runner drains Port 14 while the batch is active;
- if a stage is split across hosts, the stage's actual landing is the completion timestamp of its **last allocation**;
- the earliest allocation completion and within-stage spread are also retained;
- Port 12 batch state version 3 publishes aggregated landing telemetry.

The `landing` object now includes:

```text
expectedOrder
actualOrder
orderCorrect
expectedJobs
reportedJobs
missingJobs
minimumSpacingMs
maxAbsLandingErrorMs
adjacentSpacing[]
stages[]
```

Each stage result includes:

```text
plannedLandingAt
firstCompletionAt
actualLandingAt
allocationSpreadMs
landingErrorMs
expectedJobs
reportedJobs
missingJobs
complete
```

Port 14 is a temporary event queue for the currently serialized single-batch model. The batch runner clears stale timing events immediately before launch. This must be revisited when overlapping batches are introduced.

## Immediate next development sequence

Recommended order:

```text
1. Pull/restart and collect Port 12 landing telemetry over several batches
2. Confirm H → W1 → G → W2 actual order remains correct
3. Measure maximum landing error, minimum adjacent spacing, and within-stage allocation spread
4. Decide whether the fixed 200 ms gap has sufficient safety margin
5. Tune or adapt the landing gap only if measurements justify it
6. Only then implement overlapping/pipelined batches
```

Before pipelining, several consecutive automatic batches should recover money/security correctly, require no standalone correction work, report all worker timing events, and preserve the intended landing order with understood timing margin.

## Important architectural constraints

### Remote-only worker execution

H/G/W worker jobs do not use home as fallback capacity. Home is preserved for controller/UI work.

### One batch at a time for now

Do not jump directly to overlapping batches. The existing system deliberately serializes synchronized batches while correctness and timing are being validated.

### Full-batch review boundary

Standalone HGW hacks may trigger strategy review after completion. Batch-associated hacks must be ignored until the **full batch** reaches `COMPLETE`.

### Manual money goal is a hard spending lock

A manual cash goal blocks automatic cloud-server purchases and upgrades independently of possibly stale economy state.

### Cloud capacity retry is independent of HACK completion

`hacking/refresh.js` retries an already-selected, affordable cloud purchase/upgrade every few seconds. It does not require a hack event. The expensive planner/economy chain is rerun only after a successful capacity change or another strategic event.

### GUI React callbacks must stay Netscript-free

React event callbacks must not call Netscript APIs. They may only update React-local presentation state or assign plain JS request/input state. Netscript port/file operations remain in the asynchronous dashboard loop.

### GUI React tree is persistent

`ui/dashboard.js` mounts its React tree once. The main loop refreshes a cached runtime snapshot and increments a plain-JS version counter; the mounted React root observes that version and re-renders without `clearLog()` / `printRaw()` remount churn.

Tab selection is React-local and therefore immediate. Controller commands still cross the Netscript boundary through queued plain-JS requests processed by the main loop.

### Batch timing events stay separate from strategic telemetry

Port 4 remains the HACK event queue used by income/strategic refresh logic. Port 14 is dedicated to batch worker completion timing so GROW/WEAKEN timing events cannot accidentally trigger strategic review.

## Important user-facing controls

Main GUI: `ui/dashboard.js`

Overview:

- `Use normal HGW`
- `Use batched HWGW`
- `Prep target to 100%`
- `Resume auto HGW / batching`

Targets:

- runtime manual target override;
- clear manual target to return to economic auto-selection.

Economy:

- manual money goal / savings lock;
- cloud automation state and reason.

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

Then fetch the actual files involved in the current task before proposing or writing code.

## Related documentation

- `docs/README.md` — documentation index
- `docs/architecture.md` — architectural design and data flow
- `docs/SYSTEM_MAP.md` — responsibility map by script/module
- `docs/RUNTIME_STATE.md` — ports, controller commands, and state contracts
- `docs/TESTING.md` — validation procedures and current acceptance criteria
- `docs/ROADMAP.md` — staged priorities and future work
