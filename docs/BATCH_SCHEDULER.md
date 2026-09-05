# Batch Scheduler Design

## Current Stage 5 layers

```text
batch-scheduler.js snapshot      → single-target capacity/cadence analysis
batch-scheduler.js admission     → single-target virtual depth-2 admission
pipeline-runner.js               → real single-target depth-2 executor
controller PIPELINE mode         → continuous managed single-target execution
multi-target-scheduler.js        → global multi-target resource allocator DRY RUN
```

Single-target planner/executor state uses Port 16. Global multi-target planning uses Port 17 so it can be evaluated while the live single-target pipeline remains visible.

## Timing controls

```text
stage gap             H → W1 → G → W2 inside a batch
target batch interval H(N) → H(N+1) for one target
global landing gap    minimum spacing across stage landings from all targets
```

The requested intra-batch gap remains 200 ms. The multi-target dry run currently uses a 100 ms global cross-target landing floor and one shared RAM/time calendar.

## Dynamic multi-target allocation

The end-state scheduler should not divide RAM into permanent percentages and should not assign every target the same depth.

Instead every complete candidate batch competes for admission:

```text
build target templates
        ↓
score candidate value for MONEY / BALANCED / XP
        ↓
find conflict-free global landing window
        ↓
try exact host/time RAM reservation
        ↓
admit highest-value feasible batch
        ↓
apply diminishing-return fairness to that target
        ↓
repeat
```

This makes depth an output of value and capacity. A dominant target may get depth 6 while another receives depth 2 and a third depth 1, if those reservations maximize the selected objective without starving viable secondary work.

Current dry-run profiles:

```text
MONEY     expected cash / reserved RAM-time
BALANCED  70% normalized money + 30% normalized XP proxy
XP        action-thread × difficulty proxy / reserved RAM-time
```

The XP metric is explicitly provisional and not exact Bitburner XP.

## Global host/time calendar

All target stages reserve from the same host calendars. A target cannot assume RAM that another target has already reserved during an overlapping interval. This prevents the classic failure mode where several independently valid target schedulers overbook the same remote hosts.

The planner also avoids cross-target landing collisions with a global spacing floor.

## Fairness without rigid shares

After each admitted batch, that target's selection score is divided by a diminishing-return factor. This is not a permanent RAM quota. If secondary targets cannot fit or are much lower value, the dominant target can still consume more capacity. If another target becomes the best marginal use of the remaining RAM/time, it receives the next admission.

## Live single-target executor

`hacking/pipeline-runner.js` remains hard-capped at live depth 2. It owns Port 14 while PIPELINE is active, routes timing events by `batchId`, publishes completions to Port 15, and live state to Port 16. The 200 ms gap remains fixed until rolling history exists.

## Path to real multi-target execution

Before the new allocator is allowed to launch work:

1. validate MONEY/BALANCED/XP dry-run allocation behavior;
2. add rolling timing/recovery history per target;
3. extract shared batch-template and reservation code so dry-run and executor semantics match;
4. build persistent multi-target admission simulation;
5. make one global scheduler the permanent Port 14 owner;
6. first real test: two targets, global depth 2, per-target depth 1;
7. classify failures as target-local vs global;
8. then allow dynamic higher per-target depth from the global calendar.

Automatic worker watchdog killing remains deferred.
