# Agxnny Bitburner Scripts

A modular Bitburner v3.x automation project built around a control-only home node, remote HGW/HWGW execution, adaptive economic targeting, progression automation, diagnostics, and a unified React control-plane GUI.

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

The dashboard mounts its React tree once. Tab selection is React-local and immediate; Netscript I/O stays in the asynchronous dashboard loop. React callbacks remain Netscript-free.

The dedicated **Batch** tab separates synchronized-HWGW telemetry from the main Overview page. It shows the current batch, planned H/W1/G/W2 landing countdowns, W2 ETA, planned total duration, the latest completed batch, recovery-model error, timing/order measurements, per-stage landing details, and a planned-vs-actual landing timeline.

Overview now also exposes standalone execution observability: current action ETA plus an **Active Workers** panel showing action/target, host, threads, elapsed time, and remaining estimate. Workers may be highlighted `LATE` after an observational grace margin, but automatic killing is intentionally not enabled yet.

## Architecture summary

- Home is the control/UI node; H/G/W workers run remotely.
- Planner discovers targets and execution hosts.
- Economic selection chooses automatic target strategy.
- Controller switches between sequential HGW and synchronized one-batch-at-a-time HWGW.
- Manual target override, prep-and-hold, and manual money-goal/spending-lock controls are available in the GUI.
- Automatic cloud capacity actions follow the progression advisor and respect the manual spending lock.
- Batch-associated HACK telemetry does not trigger strategic review until the full batch is complete.
- Execution-mode changes pause new scheduling and finish already-running target-side work before applying the new mode.

## Current batching status

The original W2 grow-security under-compensation bug is fixed. Corrected live batches on `sigma-cosmetics` have used approximately:

```text
25H / 1W / 298–299G / 24W
money after batch: 100%
security after batch: minimum
standalone repair weaken: not required
```

Recovery-model telemetry is recorded in Port 12. The current development step is **actual landing-drift measurement**.

Batch workers receive their planned landing timestamp and emit completion events to **Port 14**. The batch runner aggregates those events into Port 12 schema version 3, including actual stage order, per-stage landing error, within-stage allocation spread, minimum adjacent spacing, missing timing events, and maximum absolute drift.

A stage split across several hosts is considered fully landed when its **last allocation** completes.

The most recent `COMPLETE` batch is also copied to **Port 15**, so the GUI can keep showing the previous result even after Port 12 advances to the next running batch.

The configured landing order remains:

```text
HACK
  + 200 ms
WEAKEN_HACK
  + 200 ms
GROW
  + 200 ms
WEAKEN_GROW
```

Do not implement overlapping batches until repeated timing samples show stable order and adequate spacing margin.

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
| 12 | current synchronized HWGW batch snapshot |
| 13 | controller command queue |
| 14 | batch worker landing-timing event queue |
| 15 | latest completed batch snapshot |

Port 14 is currently safe because batching is serialized and the runner clears stale timing events immediately before launch. That behavior must be redesigned before pipelining.

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

## Documentation

- `docs/HANDOFF.md` — current milestone and next work
- `docs/architecture.md` — architecture and data flow
- `docs/RUNTIME_STATE.md` — ports/state contracts
- `docs/TESTING.md` — validation and acceptance criteria
- `docs/SYSTEM_MAP.md` — module responsibilities
- `docs/ROADMAP.md` — staged roadmap

## Immediate roadmap

1. collect repeated landing telemetry in the Batch tab;
2. measure worst landing error, allocation spread, and minimum stage spacing;
3. decide whether the 200 ms gap needs tuning/adaptation;
4. implement overlapping/pipelined batches only after timing is understood;
5. after batch timing is stable, design watchdog kill/recovery rules from observed worker timing;
6. later optimize global RAM scheduling and multi-target execution.
