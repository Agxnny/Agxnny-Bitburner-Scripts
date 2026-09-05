# Agxnny Bitburner Scripts

A modular Bitburner v3.x automation project built around a control-only home node, remote HGW/HWGW execution, adaptive economic targeting, progression automation, diagnostics, and a React control-plane GUI.

## Quick start

```text
run startup.js
```

For updates:

```text
run gitpull.js
run startup.js
```

GitHub `main` is the source of truth. For continued development, read `docs/HANDOFF.md` first, then inspect current live files before editing.

## Main GUI

```text
run ui/dashboard.js
```

Tabs: **Overview, Targets, Economy, Batch, Network, Diagnostics**.

The dashboard has been compacted to reduce repeated status cards while preserving the controls and diagnostics used during development. Overview now keeps the four main metrics, one combined quick-controls card, compact target/health cards, and only shows the Active Workers card when workers actually exist. The Batch tab now folds pipeline state, serialized-batch state, latest recovery/timing, and collapsible stage diagnostics into fewer panels.

Worker lateness remains diagnostic only; automatic termination is still disabled.

## Execution architecture

- Home is the control/UI node; H/G/W workers run remotely.
- Planner discovers targets and execution hosts.
- Economic selection chooses automatic target strategy.
- Controller switches between sequential HGW and serialized automatic HWGW.
- The controller-integrated batch path is still one batch at a time.
- The first real overlapping test is an opt-in standalone runner with a hard depth cap of 2.

## Batch timing

The original W2 grow-security under-compensation bug is fixed. Corrected batches recover money/security to the intended baseline without standalone repair work.

Batch workers publish landing events through Port 14. Port 12 holds the serialized current batch, Port 15 retains the latest completed result, and Port 16 carries planner/simulator/real-pipeline state.

Recent `phantasy` testing showed correct H → W1 → G → W2 ordering around a 200 ms planned stage gap with low drift. Keep 200 ms until repeated real depth-2 samples establish a safe margin.

## Pipeline scheduler and real depth-2 runner

Capacity/cadence planner:

```text
run hacking/batch-scheduler.js phantasy 0.10 200
```

Depth-2 admission simulation:

```text
run hacking/batch-scheduler.js phantasy 0.10 200 admission
```

First real depth-2 test:

```text
run hacking/pipeline-runner.js phantasy 0.10 200 2
```

The real runner is intentionally **not controller-integrated yet**. Before it starts, the controller must already be parked in `PREPARED HOLD` on the same target with no standalone workers or serialized batch running.

The real runner:

- hard-caps overlap at 2 real batches;
- computes a conservative sustainable inter-batch interval;
- reserves RAM host-by-host over future stage windows;
- launches stages just in time rather than holding all worker RAM from admission;
- owns Port 14 for the duration of the test and routes events by `batchId`;
- publishes live pipeline state to Port 16;
- publishes each completed pipeline batch to Port 15 for the existing timing GUI;
- stops new waves on launch failure, bad order, missing timing events, low recovery money, or excessive security;
- allows already-launched work to drain instead of starting another wave.

For the initial test, use exactly `2` batches. Larger values run repeated depth-2 waves and should wait until the first pair is validated.

## Runtime ports

| Port | Purpose |
| --- | --- |
| 1 | controller snapshot |
| 2 | planner / selected strategy |
| 3 | tactical plan |
| 4 | hack-completion event queue |
| 5 | income telemetry |
| 6 | diagnostic request queue |
| 7 | economy/progression snapshot |
| 8 | economic target state |
| 9 | rooting/tool state |
| 10 | cloud-capacity action state |
| 11 | manual money-goal / spending lock |
| 12 | current serialized HWGW batch snapshot |
| 13 | controller command queue |
| 14 | batch worker landing-timing event queue |
| 15 | latest completed batch snapshot |
| 16 | pipeline planner / simulation / executor snapshot |

The serialized runner still clears Port 14 before its own batch. Therefore the real pipeline runner may only be used while serialized batching is parked. Full controller integration will require one permanent shared Port 14 owner.

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
run hacking/batch-scheduler.js phantasy 0.10 200 admission
run hacking/pipeline-runner.js phantasy 0.10 200 2
```

## Documentation

- `docs/HANDOFF.md` — current milestone and next work
- `docs/architecture.md` — architecture and data flow
- `docs/BATCH_SCHEDULER.md` — pipeline scheduler/executor design
- `docs/RUNTIME_STATE.md` — ports/state contracts
- `docs/TESTING.md` — validation and acceptance criteria
- `docs/SYSTEM_MAP.md` — module responsibilities
- `docs/ROADMAP.md` — staged roadmap

## Immediate roadmap

1. validate the first real two-batch pipeline pair;
2. compare both batches' landing order, drift, spacing, and recovery;
3. repeat depth-2 waves only after the first pair is healthy;
4. add rolling timing history;
5. move shared Port 14 ownership into the eventual controller-integrated scheduler;
6. replace the serialized per-batch review barrier with pipeline-aware review/admission logic;
7. only then raise live depth above 2;
8. later add watchdog kill/recovery and multi-target scheduling.
