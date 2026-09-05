# Agxnny Bitburner Scripts

A modular Bitburner v3.x automation project built around a control-only home node, remote HGW/HWGW execution, adaptive economic targeting, progression automation, diagnostics, and a compact React control-plane GUI.

## Quick start

```text
run startup.js
```

Startup brings the control plane up in **STANDBY**. Planner/economy/controller/UI state remains available, but the controller does not launch target-side H/G/W workers, serialized batches, or a pipeline coordinator until an execution mode is selected in the GUI.

For updates:

```text
run gitpull.js
run startup.js
```

GitHub `main` is the source of truth. Read `docs/HANDOFF.md` first before continuing development.

## GUI execution controls

```text
STANDBY   no target-side execution
HGW       normal sequential automation
BATCH     serialized one-batch-at-a-time HWGW
PIPELINE  continuous controller-managed depth-2 HWGW
```

`Prep + hold` remains available for manual testing/recovery, and `Resume` releases a prepared hold or clears a reviewed pipeline safety stop.

## Integrated depth-2 pipeline

Four consecutive real overlapping `phantasy` batches were validated with 100.00% money recovery, +0.000 security, correct H → W1 → G → W2 order, and no safety stops. The then-current sustainable cadence was about 6262 ms.

The controller-integrated `PIPELINE` mode keeps the live depth cap at 2 while integration is validated. The coordinator runs on home, H/G/W workers remain remote, Port 14 events are routed centrally by `batchId`, Port 15 keeps the latest completion, and Port 16 exposes the current single-target pipeline state.

The 200 ms stage gap remains unchanged until rolling timing history exists.

## Multi-target resource allocator — dry run

The first global multi-target planning scaffold is now available:

```text
run hacking/multi-target-scheduler.js money 4 0.10 200 64
run hacking/multi-target-scheduler.js balanced 4 0.10 200 64
run hacking/multi-target-scheduler.js xp 4 0.10 200 64
```

It launches **no workers**. Instead of assigning a fixed depth to every target, it repeatedly scores and reserves complete virtual HWGW batches against one shared host/time calendar. Better targets can receive more depth, while a diminishing-returns fairness penalty leaves room for secondary viable targets when capacity permits.

Profiles:

```text
MONEY     expected cash per reserved RAM-time
BALANCED  70% normalized money efficiency + 30% XP proxy
XP        action-thread/difficulty XP proxy per reserved RAM-time
```

The XP score is intentionally a proxy at this stage, not an exact hacking-experience formula. Full allocation state is published to **Port 17**, leaving Port 16 free for the live single-target pipeline.

## Manual finite pipeline test

```text
run hacking/pipeline-runner.js phantasy 0.10 200 2
```

Normal single-target operation should use GUI `Pipeline` mode rather than repeatedly starting this manually.

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
| 16 | single-target pipeline planner / simulation / executor |
| 17 | global multi-target allocation planner |

## Useful commands

```text
run startup.js
run diagnostics/mem-audit.js
run hacking/batch-scheduler.js phantasy 0.10 200
run hacking/multi-target-scheduler.js money 4 0.10 200 64
run hacking/multi-target-scheduler.js balanced 4 0.10 200 64
run hacking/multi-target-scheduler.js xp 4 0.10 200 64
run hacking/pipeline-runner.js phantasy 0.10 200 2
```

## Next priorities

1. finish continuous PIPELINE startup/drain/restart validation;
2. inspect MONEY/BALANCED/XP multi-target dry-run allocations and tune fairness/global landing spacing;
3. add rolling per-target landing/recovery history;
4. extract shared batch-planning/reservation logic;
5. build persistent multi-target admission simulation;
6. first real multi-target test with global depth 2 / per-target depth 1;
7. then replace fixed depth with dynamic safe per-target depth under one global RAM/time calendar;
8. keep automatic watchdog termination deferred until timing is stable.
