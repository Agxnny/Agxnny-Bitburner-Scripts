# Agxnny Bitburner Scripts

A modular Bitburner v3.x automation project built around a control-only home node, remote HGW/HWGW execution, adaptive economic targeting, progression automation, diagnostics, and a compact React control-plane GUI.

## Quick start

```text
run startup.js
```

Startup now brings the control plane up in **STANDBY**. Planner/economy/controller/UI state remains available, but the controller does not launch target-side H/G/W workers, serialized batches, or a pipeline coordinator until an execution mode is selected in the GUI.

For updates:

```text
run gitpull.js
run startup.js
```

GitHub `main` is the source of truth. Read `docs/HANDOFF.md` first before continuing development.

## GUI execution controls

Overview provides four execution choices:

```text
STANDBY   no target-side execution
HGW       normal sequential automation
BATCH     serialized one-batch-at-a-time HWGW
PIPELINE  continuous controller-managed depth-2 HWGW
```

`Prep + hold` remains available for manual testing/recovery, and `Resume` releases a prepared hold or clears a reviewed pipeline safety stop.

The Batch tab shows serialized state, Port 16 pipeline state, in-flight depth, cadence, completed count, safety status, latest recovery, landing order, drift/spread, and collapsible stage diagnostics.

## Integrated depth-2 pipeline

Four consecutive real overlapping `phantasy` batches were validated across two depth-2 runs with:

```text
money recovery: 100.00%
security:       +0.000
landing order:  H → W1 → G → W2
safety stops:   none
cadence:        ~6262 ms in that capacity state
```

The controller now has a proper `PIPELINE` execution mode. When selected it prepares the target, launches `hacking/pipeline-runner.js` in continuous mode, and keeps the hard live depth cap at **2**.

The executor:

- reserves RAM host-by-host over future execution windows;
- includes dispatch lead in reservations;
- launches stages just in time;
- owns Port 14 while pipeline execution is active and routes events by `batchId`;
- publishes live executor state to Port 16;
- publishes completed batches to Port 15;
- stops new admissions on launch/timing/recovery failure;
- drains already-admitted HWGW work before a controller execution-mode change.

A pipeline safety stop does not silently continue. The controller prepares/holds the target for inspection and requires `Resume` before the pipeline can restart.

The 200 ms stage gap remains unchanged until more rolling timing history exists.

## Manual pipeline test

The finite test harness still works when the controller is parked at PREPARED HOLD:

```text
run hacking/pipeline-runner.js phantasy 0.10 200 2
```

Normal operation should now use the GUI `Pipeline` mode instead of repeatedly starting this command manually.

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
| 15 | latest completed serialized/pipeline batch |
| 16 | pipeline planner / simulation / executor snapshot |

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
run hacking/pipeline-runner.js phantasy 0.10 200 2
```

## Next priorities

1. validate controller-managed PIPELINE startup, prep, continuous depth-2 execution, and safe drain on mode switch;
2. collect rolling landing/recovery history across integrated pipeline batches;
3. make adaptive timing decisions from history rather than one Port 15 sample;
4. further unify serialized/pipeline Port 14 ownership;
5. only raise live depth above 2 after repeated integrated validation;
6. keep automatic worker watchdog termination deferred until pipeline timing is stable.
