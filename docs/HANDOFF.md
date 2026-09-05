# Project Handoff Guide

This file is the recommended starting point for a new development chat or contributor.

## Repository and source-of-truth policy

Repository: `Agxnny/Agxnny-Bitburner-Scripts`

The **current GitHub `main` branch is the source of truth**. Before changing any existing script, fetch/read the current repository file first. Do not reconstruct current code from old chat transcripts, cached snippets, or memory.

The project targets **Bitburner v3.x** and is currently being developed/tested on **v3.0.1**.

After a major architectural change, refresh `README.md`, this handoff, `docs/architecture.md`, and any directly affected reference docs.

## Project objective

Build a modular, low-RAM Bitburner automation system that evolves from simple distributed HGW into adaptive, synchronized, eventually pipelined/multi-target HWGW.

Core design goals:

- Home is primarily the control/UI plane.
- Rooted and purchased/cloud servers form the remote execution plane.
- H/G/W workers remain minimal and dumb.
- Important decisions are published as structured runtime state.
- The GUI consumes state and sends commands; it does not own hacking logic.
- RAM efficiency is a first-class constraint.

## Current live execution milestone

The controller supports two runtime-selectable modes:

1. **Normal HGW** — sequential tactical weaken/grow/hack.
2. **Batched HWGW** — automatic synchronized **one-batch-at-a-time** HWGW.

The live production path is still serialized. Do not treat the pipeline scheduler as permission to launch overlapping real batches yet.

Current live batch lifecycle:

```text
select target + strategy
        ↓
prepare target
        ↓
launch synchronized H / W1 / G / W2
        ↓
wait for full completion
        ↓
post-batch strategic review barrier
        ↓
repair/review if needed
        ↓
next batch
```

## Latest live validation

The original W2 grow-security under-compensation bug is fixed. Corrected `sigma-cosmetics` batches used approximately:

```text
25H / 1W / 298–299G / 24W
money recovery: 100%
security recovery: minimum
standalone repair weaken: not required
```

More recent `phantasy` timing telemetry showed a representative healthy sample with correct H → W1 → G → W2 order, approximately 193 ms minimum spacing from a 200 ms plan, maximum drift around 10 ms, and all timing events reported. Continue collecting samples before reducing the stage gap.

## Current highest-priority work

**Build and validate the pipeline scheduler without enabling live overlapping execution yet.**

`hacking/batch-scheduler.js` now has two non-executing modes:

```text
snapshot   → host-window capacity/cadence analysis
admission  → persistent live depth-2 admission simulation
```

Both publish to **Port 16**.

### Scheduler timing model

Two independent controls are modeled:

```text
stage gap      = H → W1 → G → W2 spacing inside a batch
batch interval = H(N) → H(N+1) spacing across batches
```

The scheduler must protect both. A safe stage gap does not imply a safe cross-batch cadence.

### V2 host-window model

The scheduler calculates stage durations/RAM, creates a global landing calendar, and reserves RAM host-by-host over each future stage execution window. It reports:

- timing-only requested interval;
- RAM-sustainable interval;
- burst depth;
- steady-state concurrent window;
- host/stage that blocks a candidate when reservation fails.

A first `phantasy` capacity run reported roughly:

```text
stage gap:             200 ms
requested interval:    800 ms
sustainable interval:  6280 ms
remote RAM:             4196 GB / 59 hosts
burst depth:            16
batch 17:               blocked at HACK
```

Treat these as a point-in-time capacity result, not a permanent configuration.

### V3 depth-2 admission simulator

Run:

```text
run hacking/batch-scheduler.js phantasy 0.10 200 admission
```

This mode **does not launch workers**. It keeps a virtual in-flight set and applies the admission rules intended for the first executable pipeline:

- hard maximum depth = 2;
- first virtual admission requires prepared money/security;
- second admission waits for the sustainable interval;
- current live remote RAM is rechecked host-by-host;
- depth 2 blocks further admissions until the oldest virtual batch reaches planned W2;
- new matching Port 15 completed-batch telemetry is watched for safety failures;
- bad order, missing timing events, or material recovery errors trigger `SAFETY_STOP` and block further virtual admissions;
- existing virtual work is allowed to drain.

The simulator deliberately does not auto-reset a safety stop. Restart it after investigating.

See `docs/BATCH_SCHEDULER.md` for detailed rules.

## Runtime telemetry relevant to batching

- Port 12: current serialized batch snapshot.
- Port 14: batch worker timing event queue.
- Port 15: latest completed batch snapshot.
- Port 16: latest pipeline scheduler/admission-simulation snapshot.

Port 14 is still cleared by the serialized batch runner before launch. This is safe only while one real batch is in flight and **must change before live pipelining**.

## GUI observability

The main GUI has a dedicated **Batch** tab showing current/last completed batch state, planned H/W1/G/W2 countdowns, recovery error, actual order, drift/spread, and planned-vs-actual timing graph.

Overview also publishes standalone/prep worker ETA and an Active Workers panel. Worker `LATE` status is diagnostic only; no automatic termination is enabled yet.

## Immediate next development sequence

```text
1. Pull and run the new depth-2 admission simulation alongside serialized production
2. Confirm it never launches workers and remains capped at 2 virtual batches
3. Observe ADMITTED → DEPTH_CAP → DRAIN behavior
4. Confirm live RAM changes can produce RAM_BLOCKED instead of unsafe admission
5. Observe new matching Port 15 completions and validate safety-stop evaluation
6. Continue collecting repeated single-batch timing/recovery samples
7. Add rolling timing history instead of relying on one Port 15 sample
8. Redesign Port 14 as one multi-batch-safe event stream owned/routed by the future scheduler
9. Reuse host-window reservations as the actual allocation plan
10. Add atomic real depth-2 launch/rollback
11. Replace the per-batch strategic-review barrier with pipeline-aware review behavior
12. Only then perform the first executable depth-2 pipeline test
```

## Important architectural constraints

### Remote-only worker execution

H/G/W workers do not use home as fallback capacity.

### One real batch at a time for now

The production batch runner remains serialized. The scheduler's depth-2 mode is simulation only.

### Execution-mode changes are scheduling barriers

When HGW/BATCH switching is pending, no new target-side work is scheduled. Tactical analysis may be cancelled; already-running H/G/W or batch work finishes naturally before the mode changes.

### Full-batch strategic boundary

Batch-associated HACK telemetry must not trigger standalone strategic review. The current serialized controller waits for the full batch completion. This review model must be redesigned before a steady pipeline can admit continuously.

### GUI React callbacks remain Netscript-free

React callbacks may update plain-JS UI/request state only. Netscript I/O stays in the async dashboard loop.

### Batch timing queue is not pipeline-safe yet

Port 14 cannot be cleared per batch once several real batch IDs overlap. One future scheduler must consume and route the shared event stream by `batchId`.

### Latest-completed state is not timing history

Port 15 retains one completed result. Adaptive timing reduction requires a separate rolling history.

### Worker watchdog remains deferred

Do not add automatic worker killing until batch/pipeline timing is stable. Any future watchdog must verify the PID, apply measured grace, and force target recovery after a killed partial operation.

## Useful commands

```text
run startup.js
run diagnostics/mem-audit.js
run diagnostics/economy-targets.js
run diagnostics/income.js
run diagnostics/progression.js
run network/inspect.js
run network/root.js
run hacking/batch-runner.js n00dles 0.10 200 1
run hacking/batch-scheduler.js phantasy 0.10 200
run hacking/batch-scheduler.js phantasy 0.10 200 admission
```

For repository updates:

```text
run gitpull.js
run startup.js
```

## Related documentation

- `docs/README.md` — documentation index
- `docs/architecture.md` — architecture and data flow
- `docs/BATCH_SCHEDULER.md` — pipeline scheduler design and milestones
- `docs/SYSTEM_MAP.md` — responsibility map by script/module
- `docs/RUNTIME_STATE.md` — ports/state contracts
- `docs/TESTING.md` — validation procedures
- `docs/ROADMAP.md` — staged roadmap
