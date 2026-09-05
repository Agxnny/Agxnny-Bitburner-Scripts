# Project Handoff Guide

This file is the recommended starting point for a new development chat or contributor.

## Repository and source-of-truth policy

Repository: `Agxnny/Agxnny-Bitburner-Scripts`

The **current GitHub `main` branch is the source of truth**. Before changing any existing script, fetch/read the current repository file first. Do not reconstruct current code from old chat transcripts, cached snippets, or memory.

The project targets **Bitburner v3.x** and is currently being developed/tested on **v3.0.1**.

After a major architectural change, refresh `README.md`, this handoff, `docs/architecture.md`, and any directly affected reference docs.

## Project objective

Build a modular, low-RAM Bitburner automation system that evolves from simple distributed HGW into adaptive, synchronized, pipelined, eventually multi-target HWGW.

Core design goals:

- Home is primarily the control/UI plane.
- Rooted and purchased/cloud servers form the remote execution plane.
- H/G/W workers remain minimal and dumb.
- Important decisions are published as structured runtime state.
- The GUI consumes state and sends commands; it does not own hacking logic.
- RAM efficiency and safe recovery are first-class constraints.

## Current execution modes

The controller still supports:

1. **Normal HGW** — sequential tactical weaken/grow/hack.
2. **Batched HWGW** — automatic synchronized **one-batch-at-a-time** HWGW.

That controller-integrated path remains serialized.

A new standalone `hacking/pipeline-runner.js` now provides the **first opt-in real overlapping depth-2 test**. It is deliberately not wired into automatic controller mode yet.

## Latest validated background

The original W2 grow-security under-compensation bug is fixed. Corrected batches recover money/security to the intended baseline without standalone repair work.

Recent `phantasy` serialized timing showed a healthy representative sample with correct H → W1 → G → W2 order, about 193 ms minimum spacing from a 200 ms plan, about 10 ms max drift, and all timing events reported. Keep the stage gap at 200 ms until repeated depth-2 data says otherwise.

A host-window capacity run on `phantasy` previously reported roughly:

```text
requested timing interval: 800 ms
RAM-sustainable interval:  ~6280 ms
remote RAM:                 ~4196 GB / 59 hosts
burst depth at 800 ms:      16
```

Those values are point-in-time observations, not hard-coded production settings.

## Pipeline components

### `hacking/batch-scheduler.js`

Still provides non-executing analysis:

```text
snapshot   → capacity/cadence planner
admission  → persistent depth-2 virtual admission simulation
```

Both publish to **Port 16**.

### `hacking/pipeline-runner.js`

New first executable pipeline test:

```text
run hacking/pipeline-runner.js phantasy 0.10 200 2
```

Important safety rules:

- hard real depth cap = **2**;
- default/recommended first test count = **2 total batches**;
- controller must already be parked in `PREPARED HOLD` on the same target;
- no standalone controller workers may still be active;
- no serialized batch runner may be active;
- target must be at prepared money/security baseline;
- stages are launched just-in-time from a host-by-host future reservation plan;
- the runner clears Port 14 once at startup, then becomes the sole timing-event consumer for the test;
- Port 14 events are routed by `batchId` to the correct in-flight batch;
- each completed pipeline result is copied to Port 15 so the existing Batch GUI timing graph continues to work;
- live pipeline status is published to Port 16;
- launch failure, wrong order, missing timing events, low recovered money, or excessive security stops new waves;
- already-launched work is allowed to drain rather than admitting more work.

The runner executes in **waves** of at most two overlapping batches. Larger requested counts create later depth-2 waves only after the current pair drains and the target is still prepared. Do not use more than `2` for the first live test.

## GUI simplification

`ui/dashboard.js` was compacted to reduce repeated information while preserving operational controls and diagnostics.

Overview now keeps:

- four top metrics;
- one combined quick-controls card for HGW/BATCH + prep/hold/resume;
- compact target and health/economy cards;
- Active Workers only while workers actually exist.

The Batch tab now combines pipeline state, serialized batch state, latest recovery/timing, the planned-vs-actual graph, and collapsible stage diagnostics into fewer panels. Port 16 real/simulation state is visible there, so terminal tailing is not required for live scheduler observability.

React callbacks remain Netscript-free; port/file work still happens only in the asynchronous dashboard loop.

## Runtime telemetry relevant to batching

- Port 12: current serialized batch snapshot.
- Port 14: batch worker timing event queue.
- Port 15: latest completed serialized **or pipeline** batch snapshot.
- Port 16: latest pipeline planner, admission simulation, or real executor snapshot.

The serialized runner still clears Port 14 before a serialized batch. Therefore `pipeline-runner.js` may only run while serialized batching is parked. Permanent automatic pipelining still requires a single shared queue owner integrated with controller scheduling.

## Immediate next development sequence

```text
1. Pull/restart so the compact GUI and pipeline runner are deployed everywhere
2. Put the intended test target into PREPARED HOLD from the GUI
3. Confirm all controller workers are idle and no serialized batch is running
4. Run exactly two real batches with pipeline-runner.js
5. Watch the Batch tab Port 16 state and Port 15 completed timing graph
6. Validate BOTH batches: H→W1→G→W2, missing events=0, positive spacing, low drift, money≥99.5%, security≤+0.05
7. If healthy, repeat a few two-batch tests before asking for more than 2 total batches
8. Add rolling timing history across completed pipeline batches
9. Move Port 14 ownership and pipeline admission into the controller-integrated scheduler
10. Replace the serialized per-batch strategic-review barrier with pipeline-aware admission/review logic
11. Only raise maximum live depth after repeated depth-2 validation
12. Keep watchdog termination deferred until pipeline timing is stable
```

## Important architectural constraints

### Remote-only worker execution

H/G/W workers do not use home as fallback capacity.

### Controller must be parked for real pipeline tests

The standalone real runner is a test harness, not a third automatic controller mode. Use `Prep target to 100%` and wait for `PREPARED HOLD` before launching it. Do not resume automatic HGW/BATCH while the real pipeline runner is active.

### Stage gap and batch interval are independent

`stage gap` protects H → W1 → G → W2 inside a batch. `batch interval` protects the global landing stream between batches. The first real runner computes a conservative RAM-sustainable interval rather than assuming the timing-only 800 ms cadence.

### Port 14 has one owner during a real test

The depth-2 runner consumes all Port 14 timing events and routes them by `batchId`. Do not run the serialized batch runner concurrently.

### Port 15 remains latest-only

Port 15 is still a snapshot, not history. Adaptive gap reduction needs a separate rolling history layer.

### Worker watchdog remains deferred

Do not add automatic worker killing until batch/pipeline timing is stable. Any future watchdog must verify PID state, apply measured grace, and force recovery after a killed partial operation.

## Useful commands

```text
run startup.js
run diagnostics/mem-audit.js
run diagnostics/economy-targets.js
run diagnostics/income.js
run diagnostics/progression.js
run network/inspect.js
run network/root.js
run hacking/batch-scheduler.js phantasy 0.10 200
run hacking/batch-scheduler.js phantasy 0.10 200 admission
run hacking/pipeline-runner.js phantasy 0.10 200 2
```

For repository updates:

```text
run gitpull.js
run startup.js
```

## Related documentation

- `docs/README.md` — documentation index
- `docs/architecture.md` — architecture and data flow
- `docs/BATCH_SCHEDULER.md` — pipeline planner/executor design
- `docs/SYSTEM_MAP.md` — responsibility map by script/module
- `docs/RUNTIME_STATE.md` — ports/state contracts
- `docs/TESTING.md` — validation procedures
- `docs/ROADMAP.md` — staged roadmap
