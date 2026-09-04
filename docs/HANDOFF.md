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

The system now supports two runtime-selectable controller modes:

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

On 2026-09-05, the first automatic batch-mode production cycle was observed on `sigma-cosmetics`.

Observed batch state:

```text
target: sigma-cosmetics
mode: BATCH HWGW
batch result: COMPLETE
threads: 25H / 1W / 298G / 1W
money recovery: 100%
security recovery: +1.13 above minimum
```

The controller correctly:

- accepted the batch as complete;
- waited for the post-batch strategic review;
- released the review barrier after fresh target/economy state arrived;
- noticed the remaining `+1.13` security;
- entered `SECURITY_PREP / WEAKEN`;
- launched a 23-thread weaken correction before allowing another batch.

This proves the following pieces are working together:

- GUI HGW/BATCH selector;
- controller batch handoff;
- remote batch runner launch;
- synchronized completion ordering sufficient to restore money;
- Port 12 batch state;
- full-batch strategic review boundary;
- fallback target-repair path after imperfect batch recovery.

## Highest-priority known issue

**Batch security compensation is currently wrong or under-calculated.**

The first automatic batch used `25H / 1W / 298G / 1W` and ended at `+1.13` security. Money recovery was correct, but one weaken thread after 298 grow threads is suspicious and the batch should recover much closer to minimum security.

Before implementing overlapping/pipelined batches, diagnose this completely.

Primary files to inspect first:

- `hacking/batch-runner.js`
- `hacking/workers/hack.js`
- `hacking/workers/grow.js`
- `hacking/workers/weaken.js`
- `lib/threads.js`
- `lib/execution.js`

Investigate:

- exact `ns.hackAnalyzeSecurity(...)` use;
- exact `ns.growthAnalyzeSecurity(...)` use and argument semantics for the current Bitburner version;
- exact `ns.weakenAnalyze(...)` use and core assumptions;
- whether batch calculations use correct thread counts and server/core parameters;
- predicted security increase vs measured final security delta;
- whether any stage allocation or worker argument mismatch changes the actual number of effective threads.

Do **not** hide this problem by relying on the post-batch repair weaken. The repair path is a safety net, not the intended steady-state batching model.

## Immediate next development sequence

Recommended order:

```text
1. Fix single-batch security compensation
2. Validate repeated automatic batches return to near-minimum security
3. Add predicted-vs-actual batch recovery telemetry
4. Measure landing drift / timing error over repeated batches
5. Tune or adapt the landing gap if needed
6. Only then implement overlapping/pipelined batches
```

A useful acceptance criterion before pipelining is several consecutive automatic batches that recover money to the intended baseline and security to roughly `+0.00–0.05`, without needing standalone correction work.

## Important architectural constraints

### Remote-only worker execution

H/G/W worker jobs do not use home as fallback capacity. Home is preserved for controller/UI work.

### One batch at a time for now

Do not jump directly to overlapping batches. The existing system deliberately serializes synchronized batches while correctness is being validated.

### Full-batch review boundary

Standalone HGW hacks may trigger strategy review after completion. Batch-associated hacks must be ignored until the **full batch** reaches `COMPLETE`.

### Manual money goal is a hard spending lock

A manual cash goal blocks automatic cloud-server purchases and upgrades independently of possibly stale economy state.

### Cloud capacity retry is independent of HACK completion

`hacking/refresh.js` retries an already-selected, affordable cloud purchase/upgrade every few seconds. It does not require a hack event. The expensive planner/economy chain is rerun only after a successful capacity change or another strategic event.

### GUI React callbacks must stay Netscript-free

React event callbacks only assign plain JS request state. Netscript operations are performed in the asynchronous dashboard loop. This pattern was adopted to keep the GUI responsive and reliable.

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
