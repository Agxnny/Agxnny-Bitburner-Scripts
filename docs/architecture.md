# Architecture

## Source of truth

GitHub `main` is the source of truth. Read `docs/HANDOFF.md` first, then fetch current files before editing.

## Core principle

Home is the control/UI plane. Rooted and cloud servers are the remote execution plane. The GUI consumes published state and sends commands; it does not own hacking logic. React callbacks remain Netscript-free.

## Startup behavior

`startup.js` still starts the GUI and kickstart chain:

```text
startup.js → dashboard → kickstart → planner/deploy/economy → controller
```

The controller now initializes in **STANDBY**. Control-plane services stay online, but no target-side H/G/W worker, serialized batch coordinator, or pipeline coordinator is launched until the user selects an execution mode or explicitly asks for Prep + hold.

## Controller execution modes

```text
STANDBY   observe only; no target-side execution
HGW       sequential tactical weaken/grow/hack
BATCH     serialized synchronized HWGW
PIPELINE  continuous controller-managed depth-2 HWGW
```

Mode changes are scheduling barriers. Tactical analysis may be cancelled because it has no target-side effect. Existing H/G/W, serialized batch, or already-admitted pipeline work drains naturally before the requested mode becomes active.

## Serialized batch mode

`hacking/batch-runner.js` remains the one-batch-at-a-time path. It plans H/W1/G/W2, launches timed workers, gathers Port 14 events, publishes Port 12/15 state, and then the controller uses the existing post-batch review barrier.

Default stage gap remains 200 ms.

## Integrated pipeline mode

`hacking/pipeline-runner.js` now has two uses:

```text
finite manual test:  ... 2
controller managed:  ... continuous --quiet
```

The controller selects PIPELINE, prepares the target, publishes one settled idle snapshot, then launches the executor remotely. The live depth cap remains exactly 2.

### Pipeline timing model

The executor separates:

```text
stage gap      = H → W1 → G → W2 inside one batch
batch interval = H(N) → H(N+1) across batches
```

Each stage reservation covers its actual process lifetime, including the dispatch lead before action start. A host-aware reservation plan is built before each depth-2 wave. Stages are dispatched just in time and may be split across hosts.

### Port 14 ownership

While PIPELINE is active, one pipeline coordinator consumes Port 14 and routes timing events by `batchId`. Serialized BATCH mode is not allowed to run concurrently.

The pipeline executor clears stale Port 14 state once at startup only after preflight confirms no serialized batch-runner process is active.

### Pipeline completion and safety

Each completed pipeline batch publishes landing/recovery telemetry to Port 15. Port 16 holds live executor state including in-flight batches, cadence, completion count, recent events, and safety state.

Admission stops on launch failure, wrong landing order, missing timing events, final money below tolerance, excessive security, or a bad post-wave target baseline.

On a controller execution-mode change, no later wave is admitted. The current depth-2 wave finishes fully, then the pipeline coordinator exits so the controller can complete the mode transition.

On a pipeline safety stop, the controller begins target recovery/prep and holds the target for inspection. The operator uses Resume after review to clear the stop.

## Validated depth-2 baseline

Two manual depth-2 runs on `phantasy` completed four overlapping batches total with 100.00% money, +0.000 security, and correct H → W1 → G → W2 ordering. Both selected roughly 6262 ms batch cadence under the then-current RAM pool.

This validates the basic depth-2 execution path, not higher depth. The 200 ms stage gap remains fixed until rolling history is implemented.

## Pipeline planner

`hacking/batch-scheduler.js` remains the non-executing planning/simulation tool. It provides host-window capacity analysis and a virtual depth-2 admission mode, both published to Port 16.

## GUI architecture

The compact dashboard keeps operational detail without duplicating it across many cards. Overview now exposes Standby/HGW/Batch/Pipeline, Prep + hold, and Resume in one control card. The Batch tab owns serialized/pipeline observability and detailed landing diagnostics.

## Runtime ports

| Port | Purpose |
| --- | --- |
| 1 | controller snapshot |
| 2 | planner / selected strategy |
| 3 | tactical plan |
| 4 | hack completion event queue |
| 5 | income telemetry |
| 6 | diagnostic request queue |
| 7 | progression/economy state |
| 8 | economic target state |
| 9 | root/tool state |
| 10 | cloud capacity automation state |
| 11 | manual money goal / spending lock |
| 12 | current serialized batch state |
| 13 | controller command queue |
| 14 | batch landing-timing event queue |
| 15 | latest completed serialized/pipeline batch |
| 16 | pipeline planner/simulation/executor state |

## Current limitations

- Live pipeline depth is fixed at 2.
- Port 15 is latest-only, not rolling history.
- Adaptive timing still uses the latest matching sample rather than several samples.
- The serialized runner still has its legacy Port 14 clear-at-start behavior, so BATCH and PIPELINE remain mutually exclusive at the controller level.
- Automatic worker watchdog termination remains deferred.
