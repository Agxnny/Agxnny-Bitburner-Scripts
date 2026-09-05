# Runtime State and Command Contract

`lib/runtime-state.js` is the port transport source of truth. Validation and stock research also use durable files because all 20 runtime ports are allocated.

## Port map

| Port | Purpose | Semantics |
| --- | --- | --- |
| 1 | Controller | latest snapshot |
| 2 | Planner / selected strategy | latest snapshot |
| 3 | Tactical plan | latest snapshot |
| 4 | Hack events | queue |
| 5 | Income telemetry | latest snapshot |
| 6 | Diagnostic/test requests | queue |
| 7 | Economy/progression | latest snapshot |
| 8 | Economic target | latest snapshot |
| 9 | Root/tool state | latest snapshot |
| 10 | Cloud capacity action | latest snapshot |
| 11 | Manual money goal | latest snapshot |
| 12 | Current serialized batch | latest snapshot |
| 13 | Controller requests | queue |
| 14 | Synchronized worker timing events | queue; one real coordinator only |
| 15 | Latest completed synchronized batch | latest snapshot |
| 16 | Single-target pipeline planner/sim/executor | latest snapshot |
| 17 | Global multi-target planner/sim/executor | latest snapshot |
| 18 | Adaptive distributed prepper | latest snapshot |
| 19 | Rolling real batch safety history | latest snapshot |
| 20 | Progressive global MULTI stress state | latest snapshot |

## Controller contract

Execution modes:

```text
STANDBY | HGW | BATCH | PIPELINE | MULTI
```

Important Port 13 requests:

```text
PREP_TARGET
RESUME_AUTO
SET_MANUAL_TARGET
CLEAR_MANUAL_TARGET
SET_EXECUTION_MODE STANDBY|HGW|BATCH|PIPELINE|MULTI
START_MULTI { profile, targetCount, globalDepth, hackPercent, stageGapMs }
```

A pending mode is an admission barrier. Existing synchronized work drains to a safe boundary before the transition applies.

## Port 14 ownership

Workers emit `BATCH_STAGE_COMPLETE` timing events with batch/stage/job identity, threads, planned landing, finish time, and landing error.

Exactly one real synchronized coordinator may consume Port 14 at a time. Depending on the operation this can be serialized batch, pipeline, real MULTI, or a real overlap/depth validator. Planning-only simulators, prepper, history collectors, stress/set supervisors, and stock services do not consume Port 14 themselves.

## Ports 15/16/17

Port 15 is latest-completion telemetry. `hacking/batch-history.js` accepts only genuinely new completions and folds them into Port 19.

Port 16 is single-target pipeline planning/simulation/execution state. Real pipeline remains hard depth 2.

Port 17 is global multi-target state. The real executor model is `MULTI_TARGET_EXECUTOR_V2_CONFIGURABLE_FINITE`: configurable global live depth, shared host/time calendar, JIT dispatch, central timing routing, prepared targets only. Current production `perTargetLiveDepthCap` remains 1.

## Port 18 prepper

Current prepper model is `DISTRIBUTED_TARGET_PREPPER_V3_ADAPTIVE_FOCUS`.

Important fields include status/reason, reserve ratio/min/max, `reservedRamGb`, `reservedHosts[]`, target/prepared/needs-prep counts, `activeJobs[]`, `prepTargets[]`, demand/next targets, completed waves, focus plan, and timestamps.

The prepper can reserve multiple hosts and concentrate several on one target. Production excludes fresh `reservedHosts[]`. Stale prepper state must not permanently remove hosts from production.

## Port 19 rolling batch history

`ROLLING_BATCH_HISTORY_V2_PIPELINE_EVIDENCE` stores rolling real completion evidence. Clean criteria are correct order, zero missing jobs, money >=99.5%, security <=+0.05, max absolute drift <=150 ms, and minimum spacing >=75 ms.

Its historical recommendation ladder is useful evidence but is **not** permission for same-target MULTI production depth >1. Dedicated overlap evidence is the target-local authority for the new design.

## Port 20 global stress

`diagnostics/multi-target-stress.js` publishes `MULTI_TARGET_STRESS_V2_PREP_AWARE_RESUME`. It runs one real finite MULTI child at a time, can wait for prep, and records completed evidence to `/data/multi-stress-evidence.txt`.

## Durable files

| File | Purpose |
| --- | --- |
| `/data/manual-money-goal.txt` | persistent user savings target / automated spending lock |
| `/data/multi-stress-evidence.txt` | durable global distinct-target concurrency proof |
| `/data/multi-overlap-evidence.txt` | durable per-target/per-depth same-target validation evidence |
| `/data/multi-overlap-validation-state.txt` | latest live overlap/depth/set validation telemetry |
| `/data/automulti-controller-state.txt` | AUTOMULTI supervisory state |
| `/data/stock-history.txt` | retained wall-clock stock price history and gaps |
| `/data/stock-market-state.txt` | current stock access/prices/positions/portfolio heartbeat |

## Dynamic overlap evidence

`MULTI_TARGET_OVERLAP_EVIDENCE_V2_DYNAMIC_DEPTH` stores a `targets[hostname].depths[depth]` record for each tested level. Records include validation/blocked/clean/failed waves, consecutive clean count, proof, latest health, drift, spacing, hack fraction, stage gap, batch interval, status/reason/run id, and timestamps.

Two consecutive clean dedicated waves prove a tested depth. `provenDepth` is the highest continuous active proven level. A failed higher depth does not delete lower proof.

## Stock timing semantics

Stock history uses `Date.now()` wall-clock timestamps. The recorder polls every 200 ms but appends a historical sample only when the price vector changes. Recorder downtime is represented as a gap rather than interpolated data. New history retention is unbounded (`retention: ALL`).
