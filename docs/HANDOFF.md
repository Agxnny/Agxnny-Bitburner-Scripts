# Project Handoff Guide

GitHub `main` is the source of truth. Read this file first, then fetch the current live files before editing. Project target is Bitburner v3.x; current live testing is on v3.0.1.

## Current control modes

```text
STANDBY   control plane online; no target-side worker/coordinator launches
HGW       normal sequential automation
BATCH     serialized one-batch-at-a-time HWGW
PIPELINE  continuous controller-managed depth-2 HWGW
```

`startup.js` defaults the controller to **STANDBY**. Planner/economy/controller/UI processes still run, but target-side execution does not begin until the user chooses a mode or explicitly requests prep.

## Latest live pipeline state

The standalone depth-2 executor completed four consecutive overlapping `phantasy` batches with 100% money recovery, +0.000 security, correct H → W1 → G → W2 order, and a stable ~6262 ms sustainable cadence in the then-current pool.

The same executor is now controller-integrated in PIPELINE mode and runs its coordinator on **home** while H/G/W workers remain remote. Live depth remains hard-capped at 2 during integration validation. Keep the intra-batch stage gap at 200 ms until rolling timing history exists.

## New multi-target allocator scaffold

`hacking/multi-target-scheduler.js` is the first planning-only global allocator for the eventual multi-target system.

Usage:

```text
run hacking/multi-target-scheduler.js money 4 0.10 200 64
run hacking/multi-target-scheduler.js balanced 4 0.10 200 64
run hacking/multi-target-scheduler.js xp 4 0.10 200 64
```

It launches **no workers**. It:

- considers several eligible targets at once;
- builds a prepared-baseline HWGW template for each;
- scores candidates for MONEY / BALANCED / XP;
- uses one shared host/time RAM reservation calendar;
- protects a global landing spacing floor between batches from different targets;
- repeatedly admits the highest-value feasible virtual batch;
- applies a diminishing-returns fairness penalty so a dominant target can receive more depth without trivially starving every secondary target;
- produces **dynamic per-target depth** rather than a fixed `2 per target` split;
- publishes the full snapshot to **Port 17** so it does not overwrite the live single-target pipeline state on Port 16.

Current XP scoring is deliberately labelled a proxy (`ACTION_THREAD_DIFFICULTY_PROXY_PER_RAM_SECOND`), not exact Bitburner XP. It is enough to validate resource allocation behavior before implementing a dedicated XP executor/Formula-based score.

## Runtime batching state

- Port 12: serialized batch snapshot.
- Port 14: live batch timing-event queue.
- Port 15: latest completed serialized/pipeline batch.
- Port 16: current single-target pipeline planner/simulator/executor.
- Port 17: global multi-target allocation planner.

The current live PIPELINE executor still owns Port 14 while active. The new multi-target allocator is dry-run only and does not consume Port 14.

## Current important limitations

- Live PIPELINE depth is still fixed at 2.
- Multi-target allocation is simulation/planning only.
- Multi-target candidate templates assume production from a prepared baseline; `preparedNow` is reported separately.
- Port 15 is latest-only; rolling landing/recovery history is still missing.
- Timing adaptation still uses latest matching completion rather than several samples.
- XP scoring is a proxy, not exact hacking XP.
- Automatic worker watchdog termination remains deferred.

## Immediate next development sequence

```text
1. Finish continuous PIPELINE + PIPELINE→STANDBY drain validation
2. Pull/run the multi-target scheduler in MONEY, BALANCED, and XP profiles
3. Inspect whether dynamic allocation gives dominant targets more depth while retaining viable secondary targets
4. Tune fairness/global landing spacing from the dry-run results
5. Add rolling per-target landing/recovery history
6. Extract/reuse shared batch-template + host-reservation code to prevent planner/executor divergence
7. Build a persistent multi-target admission simulation using Port 17
8. First real multi-target test: global live depth 2, per-target depth 1, two targets
9. Evolve to dynamic per-target depth with one global RAM/time calendar
10. Keep automatic worker killing deferred until multi-target timing is stable
```

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
