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

The Batch tab shows current and retained completed HWGW state, planned stage countdowns, recovery error, landing order, drift/spread, and a planned-vs-actual timing graph. Overview also exposes current-action ETA and an Active Workers panel. Worker lateness is diagnostic only; automatic termination is not enabled yet.

## Architecture summary

- Home is the control/UI node; H/G/W workers run remotely.
- Planner discovers targets and execution hosts.
- Economic selection chooses automatic target strategy.
- Controller switches between sequential HGW and synchronized one-batch-at-a-time HWGW.
- The current **live** batch path is still serialized.
- Pipeline scheduling is being built and validated in non-executing simulation before real overlap is enabled.

## Current batching status

The original W2 grow-security under-compensation bug is fixed. Corrected live batches recover money/security to the intended baseline without standalone repair work.

Batch workers publish planned/actual completion telemetry through Port 14; Port 12 holds the current batch and Port 15 retains the latest completed batch. Recent `phantasy` testing has shown correct H → W1 → G → W2 order with a 200 ms planned stage gap and low observed drift, but more samples are still required before reducing timings.

## Pipeline scheduler

`hacking/batch-scheduler.js` now has two **non-executing** modes.

One-shot capacity/cadence planning:

```text
run hacking/batch-scheduler.js phantasy 0.10 200
```

Persistent depth-2 admission simulation:

```text
run hacking/batch-scheduler.js phantasy 0.10 200 admission
```

The scheduler separates:

- **stage gap** — H → W1 → G → W2 spacing inside a batch;
- **batch interval** — H(N) → H(N+1) spacing between batches.

It performs host-by-host RAM reservation over future execution windows, distinguishes burst depth from sustainable cadence, and publishes scheduler state to **Port 16**.

Admission mode is hard-capped at **2 virtual in-flight batches**. It requires a prepared baseline before opening the virtual pipeline, waits for the sustainable interval before admitting the second virtual batch, rechecks live host RAM, and enters `SAFETY_STOP` if a newly observed matching Port 15 result has bad ordering, missing timing events, or material recovery error. No workers are launched.

On the first V2 `phantasy` capacity sample, the timing-only interval was 800 ms while the host-window model estimated roughly **6280 ms** as sustainable with the then-current ~4.2 TB remote pool.

See `docs/BATCH_SCHEDULER.md` for the detailed design.

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
| 16 | pipeline scheduler / admission-simulation snapshot |

Port 14 is still owned by the serialized batch runner and cleared before each real batch. That must be redesigned before overlapping real batches are enabled.

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
```

## Documentation

- `docs/HANDOFF.md` — current milestone and next work
- `docs/architecture.md` — architecture and data flow
- `docs/BATCH_SCHEDULER.md` — pipeline scheduler design
- `docs/RUNTIME_STATE.md` — ports/state contracts
- `docs/TESTING.md` — validation and acceptance criteria
- `docs/SYSTEM_MAP.md` — module responsibilities
- `docs/ROADMAP.md` — staged roadmap

## Immediate roadmap

1. validate the depth-2 admission simulator alongside serialized production;
2. continue collecting repeated landing/recovery telemetry;
3. add rolling timing history;
4. redesign Port 14 for multiple live batch IDs;
5. reuse host-window reservations for actual atomic worker launch;
6. first real pipeline test remains capped at depth 2;
7. only raise depth after repeated depth-2 timing/recovery validation;
8. later add watchdog kill/recovery and multi-target scheduling.
