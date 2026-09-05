# Project Handoff Guide

GitHub `main` is the source of truth. Read this file first, then fetch the current live files before editing. Project target is Bitburner v3.x; current live testing is on v3.0.1.

## Current control modes

```text
STANDBY   production controller parked
HGW       normal sequential automation
BATCH     serialized one-batch-at-a-time HWGW
PIPELINE  continuous controller-managed depth-2 HWGW
```

`startup.js` defaults the production controller to **STANDBY**. The dedicated prepper is now a separate background maintenance service, so STANDBY means no production hacking/batch/pipeline work; the reserved prep host may still run grow/weaken maintenance to keep eligible targets prepared.

## Latest live pipeline state

The standalone depth-2 executor completed four consecutive overlapping `phantasy` batches with 100% money recovery, +0.000 security, correct H → W1 → G → W2 order, and a stable ~6262 ms sustainable cadence in the then-current pool.

The same executor is controller-integrated in PIPELINE mode and runs its coordinator on **home** while H/G/W workers remain remote. Live depth remains hard-capped at 2 during integration validation. Keep the intra-batch stage gap at 200 ms until rolling timing history exists.

## Multi-target allocator scaffold

`hacking/multi-target-scheduler.js` is the planning-only global allocator for the eventual multi-target system.

Usage:

```text
run hacking/multi-target-scheduler.js money 4 0.10 200 64
run hacking/multi-target-scheduler.js balanced 4 0.10 200 64
run hacking/multi-target-scheduler.js xp 4 0.10 200 64
```

It launches **no workers**. It considers several targets at once, scores MONEY/BALANCED/XP candidates, uses one shared host/time reservation calendar, enforces global landing spacing, applies diminishing-return fairness, and produces dynamic per-target depth rather than `2 per target`. Full state is published to **Port 17**.

Observed dry-run allocation on the current pool:

```text
MONEY:    phantasy 16 | joesguns 4 | sigma-cosmetics 2
BALANCED: phantasy 11 | joesguns 4 | sigma-cosmetics 1 | foodnstuff 1
XP:       joesguns 3  | foodnstuff 2 | sigma-cosmetics 1 | phantasy 1
```

The profile objective is therefore materially changing allocation as intended. XP remains an explicit proxy metric, not exact Formula-based XP optimization.

## Dedicated target prepper

`hacking/prepper.js` is now a persistent background service started by `kickstart.js`.

Behavior:

- reserves exactly one remote RAM host while alive;
- default host selection chooses the smallest rooted execution host with at least 32 GB, falling back to the largest available host if none meet that floor;
- publishes a heartbeat/state snapshot to **Port 18**;
- `lib/execution.js` automatically excludes the fresh Port 18 reserved host from HGW/BATCH/PIPELINE/multi-target production capacity;
- existing production work already on the newly reserved host is allowed to drain naturally;
- round-robins all currently eligible money targets;
- performs one grow or weaken wave per visit so one difficult target cannot monopolize prep forever;
- targets full money (>=99.5%) and near-minimum security (<=+0.05);
- never hacks and does not write Port 14 batch timing events.

Manual usage remains available:

```text
run hacking/prepper.js
run hacking/prepper.js <hostname> 32
```

The prepper is specifically intended to prevent a future multi-target allocator from stalling because a desirable target has never been prepared.

## Git pull change markers

`gitpull.js` still performs a destructive clean pull, but it now captures each old file's text before deletion and compares it with the freshly downloaded version.

Output semantics:

```text
UPDATED    file.js              contents actually changed
REPLACED   file.js (unchanged)  clean-pulled but byte/text-identical
ADDED      file.js              did not exist locally before pull
STALE RM   file.js              managed file removed because it left the manifest
```

The final pull summary includes an `UPDATED` count plus the list of changed files. `gitpull-self-update.js` performs the same comparison for `gitpull.js` during handoff.

## Runtime batching / scheduler state

- Port 12: serialized batch snapshot.
- Port 14: live batch timing-event queue.
- Port 15: latest completed serialized/pipeline batch.
- Port 16: current single-target pipeline planner/simulator/executor.
- Port 17: global multi-target allocation planner.
- Port 18: dedicated prepper/reserved-host state.

The current live PIPELINE executor still owns Port 14 while active. The multi-target allocator is dry-run only and does not consume Port 14. The prepper also does not consume or emit Port 14 timing events.

## Current important limitations

- Live PIPELINE depth is still fixed at 2.
- Multi-target allocation is simulation/planning only.
- Multi-target candidate templates still assume production from a prepared baseline; `preparedNow` is reported separately. The new prepper is intended to keep that assumption true over time.
- Port 15 is latest-only; rolling landing/recovery history is still missing.
- Timing adaptation still uses latest matching completion rather than several samples.
- XP scoring is a proxy, not exact hacking XP.
- Automatic worker watchdog termination remains deferred.
- Prepper selection/reservation has not yet been surfaced in the GUI.

## Immediate next development sequence

```text
1. Pull/start and validate the prepper reserves one remote host on Port 18
2. Confirm production Remote RAM excludes that host while prepper heartbeat is fresh
3. Confirm prepper round-robins targets and eventually reports all eligible targets prepared
4. Re-run MONEY/BALANCED/XP multi-target dry runs with the prepper active
5. Finish continuous PIPELINE + PIPELINE→STANDBY drain validation
6. Add rolling per-target landing/recovery history
7. Extract/reuse shared batch-template + host-reservation code
8. Build persistent multi-target admission simulation using Port 17
9. First real multi-target test with conservative global depth
10. Evolve to dynamic per-target depth with one global RAM/time calendar
```

## Useful commands

```text
run startup.js
run diagnostics/mem-audit.js
run hacking/prepper.js
run hacking/batch-scheduler.js phantasy 0.10 200
run hacking/multi-target-scheduler.js money 4 0.10 200 64
run hacking/multi-target-scheduler.js balanced 4 0.10 200 64
run hacking/multi-target-scheduler.js xp 4 0.10 200 64
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
