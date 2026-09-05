# Project Handoff Guide

GitHub `main` is the source of truth. Read this file first, then fetch the current live files before editing. Project target is Bitburner v3.x; current live testing is on v3.0.1.

## Current control modes

```text
STANDBY   production controller parked
HGW       normal sequential automation
BATCH     serialized one-batch-at-a-time HWGW
PIPELINE  continuous controller-managed depth-2 HWGW
```

`startup.js` defaults the production controller to **STANDBY**. The dedicated prepper is a separate background maintenance service, so STANDBY means no production hacking/batch/pipeline work; the reserved prep host may still run grow/weaken maintenance.

## Latest validated prepper state

The dedicated prepper is live on home and the production pool correctly excludes its reserved host. Before prepper reservation the multi-target dry run saw `4196.00 GB / 59 hosts`; with prepper active it saw `4156.50 GB / 58 hosts`, while MONEY allocation remained `phantasy 16 | joesguns 4 | sigma-cosmetics 2`.

## Persistent multi-target admission simulation

`hacking/multi-target-sim.js` is planning-only and launches no workers. Live validation proved rolling admission works: the simulation progressed from `21 in flight | 21 admitted | 0 completed` to `24 in flight | 25 admitted | 1 completed`, then `20 in flight | 25 admitted | 5 completed`. Dynamic depth redistributed globally during expiry/re-admission, including a temporary `joesguns` depth increase while `sigma-cosmetics` returned to READY. `foodnstuff` correctly remained `WAITING_PREP` while unprepared.

Model:

```text
MULTI_TARGET_ADMISSION_SIM_V2_PERSISTENT
```

This validates the shared global reservation calendar and continuous replacement loop. It does not yet prove that high real depth is safe.

## Rolling real batch safety history

The next safety layer is now scaffolded.

New files/services:

```text
lib/batch-history.js
hacking/batch-history.js
```

`kickstart.js` starts the batch-history collector on home. It watches latest completed real batches on Port 15 and publishes rolling per-target safety history on **Port 19**. It does not consume Port 14 and launches no workers.

Port 19 model:

```text
ROLLING_BATCH_HISTORY_V1
```

Up to 16 real samples are retained per target. Samples include stage order, missing timing jobs, money/security recovery, maximum landing error, minimum spacing, allocation spread, gap, and batch interval.

A sample is currently considered clean only if:

```text
order correct
missing jobs == 0
money >= 99.5%
security <= +0.05
max |landing error| <= 150 ms
minimum spacing >= 75 ms
```

Conservative advisory depth ladder:

```text
0-1 consecutive clean -> depth 1 / UNPROVEN
2-3 consecutive clean -> depth 2 / LOW
4-7 consecutive clean -> depth 4 / MEDIUM
8+ consecutive clean  -> depth 8 / HIGH
```

This recommendation is advisory only in the current commit. The immediate next implementation step is to make the persistent multi-target simulator expose and enforce this per-target cap before any real multi-target executor exists.

## Runtime batching / scheduler state

- Port 12: serialized batch snapshot.
- Port 14: live batch timing-event queue.
- Port 15: latest completed serialized/pipeline batch.
- Port 16: current single-target pipeline planner/simulator/executor.
- Port 17: one-shot or persistent global multi-target planner/simulator.
- Port 18: dedicated prepper/reserved-host state.
- Port 19: rolling per-target real batch safety history.

The current real PIPELINE executor still owns Port 14 while active. Multi-target planning and the Port 19 collector do not consume Port 14.

## Current important limitations

- Live PIPELINE depth is still fixed at 2.
- Multi-target work is still simulation/planning only; no real multi-target worker launches yet.
- Port 19 history only learns from new Port 15 completions after the collector is running; old historical completions are not reconstructed.
- The persistent multi-target simulator does not yet enforce Port 19 recommended depth.
- XP scoring is still a proxy, not exact Formula-based hacking XP.
- Automatic worker watchdog termination remains deferred.
- Prepper, Port 17, and Port 19 state are not yet surfaced in the GUI.

## Immediate next development sequence

```text
1. Pull/start and confirm hacking/batch-history.js is running on home
2. Run mem-audit and confirm manifest cleanliness
3. Produce fresh real PIPELINE completions and verify Port 19 accumulates samples/streaks
4. Wire Port 19 recommendedDepth into persistent multi-target simulation as a hard per-target admission cap
5. Validate that unproven targets stay depth 1 while proven targets can earn higher simulated depth
6. Finish continuous PIPELINE + PIPELINE→STANDBY drain validation
7. First real multi-target test with conservative global live depth 2 / per-target depth 1
8. Evolve real executor toward dynamic per-target depth only after clean timing evidence
9. Keep automatic worker killing deferred until multi-target timing is stable
```

## Useful commands

```text
run startup.js
run diagnostics/mem-audit.js
ps home
run hacking/multi-target-sim.js money 4 0.10 200 64
run hacking/pipeline-runner.js phantasy 0.10 200 2
```

For updates:

```text
run gitpull.js
run startup.js
```
