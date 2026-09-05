# Project Handoff Guide

GitHub `main` is the source of truth. Read this file first, then fetch the current live files before editing. Project target is Bitburner v3.x; current live testing is on v3.0.1.

## Current control modes

The controller now supports four execution modes:

```text
STANDBY   control plane online; no target-side worker/coordinator launches
HGW       normal sequential automation
BATCH     serialized one-batch-at-a-time HWGW
PIPELINE  continuous controller-managed depth-2 HWGW
```

The controller defaults to **STANDBY**, so `run startup.js` no longer immediately begins hacking work. Planner/economy/controller/UI state still comes online; target-side execution begins only after the user selects HGW, BATCH, or PIPELINE, or explicitly requests Prep + hold.

## Latest real pipeline validation

Four consecutive real overlapping `phantasy` batches were completed across two depth-2 runs. All four reported:

```text
money:    100.00%
security: +0.000
order:    H → W1 → G → W2
```

Both runs selected a sustainable cadence of about **6262 ms** with the then-current execution pool. No safety stop occurred.

The 200 ms intra-batch stage gap remains unchanged. Do not reduce it until rolling timing history exists.

## Integrated pipeline execution

`hacking/pipeline-runner.js` now supports both finite manual tests and controller-managed continuous mode.

Manual finite test:

```text
run hacking/pipeline-runner.js phantasy 0.10 200 2
```

Controller mode launches:

```text
hacking/pipeline-runner.js <target> <hackFraction> 200 continuous --quiet
```

Hard rules remain:

- maximum live depth = 2;
- stages are launched just in time;
- RAM is reserved host-by-host over the full process lifetime including dispatch lead;
- Port 14 has one real pipeline consumer and events are routed by `batchId`;
- Port 15 receives each latest completed pipeline batch;
- Port 16 publishes current pipeline executor state;
- bad order, missing timing events, launch failure, low money recovery, or high security causes a safety stop;
- an execution-mode change blocks new waves and lets the current admitted depth-2 wave drain before the controller completes the switch.

If the pipeline safety-stops, the controller enters target recovery/prep and holds the target for inspection. `Resume` clears the reviewed stop and allows PIPELINE mode to restart.

## GUI

The compact dashboard remains the main operator surface. Overview has four top metrics, one Quick controls card, compact target/health cards, and Active Workers only when needed.

Quick controls now include:

```text
Standby | HGW | Batch | Pipeline | Prep + hold | Resume
```

The Batch tab shows Port 16 pipeline status, depth, cadence, completion count, safety state, latest recovery/timing graph, and collapsible detailed telemetry.

React callbacks remain Netscript-free.

## Current important limitations

- Pipeline live depth is intentionally fixed at 2.
- Port 15 is still one latest-completed snapshot, not rolling history.
- The old serialized batch runner still clears Port 14 before serialized batches; controller scheduling prevents serialized BATCH and PIPELINE from running concurrently.
- Pipeline timing tuning still relies on the latest matching completed batch rather than a rolling history.
- Automatic worker watchdog termination remains deferred.
- Controller-managed PIPELINE currently expects a fully prepared baseline before executor admission; keep current testing on the validated full-money target path while integrated behavior is being validated.

## Immediate next development sequence

```text
1. Pull and run startup.js; confirm initial mode is STANDBY with zero target-side jobs
2. Select the intended target and choose PIPELINE from the GUI
3. Confirm controller prep occurs automatically, then continuous depth-2 execution starts
4. Verify Port 16/Batch tab shows in-flight depth <= 2 and healthy repeated waves
5. Switch PIPELINE → STANDBY during a live wave and confirm no new wave is admitted while current work drains safely
6. Repeat PIPELINE startup/drain/restart validation
7. Add rolling landing/recovery history across integrated pipeline batches
8. Base future timing adaptation on several samples, not Port 15 alone
9. Only raise live depth above 2 after repeated integrated validation
10. Keep automatic worker killing deferred until pipeline timing is stable
```

## Useful commands

```text
run startup.js
run diagnostics/mem-audit.js
run hacking/batch-scheduler.js phantasy 0.10 200
run hacking/pipeline-runner.js phantasy 0.10 200 2
```

For updates:

```text
run gitpull.js
run startup.js
```

## Related documentation

- `README.md`
- `docs/architecture.md`
- `docs/BATCH_SCHEDULER.md`
- `docs/RUNTIME_STATE.md`
- `docs/TESTING.md`
- `docs/SYSTEM_MAP.md`
- `docs/ROADMAP.md`
