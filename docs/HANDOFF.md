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

Files/services:

```text
lib/batch-history.js
hacking/batch-history.js
```

`kickstart.js` starts the batch-history collector on home. It watches latest completed real batches on Port 15 and publishes rolling per-target safety history on **Port 19**. It does not consume Port 14 and launches no workers.

Current Port 19 model:

```text
ROLLING_BATCH_HISTORY_V2_PIPELINE_EVIDENCE
```

The first runtime test exposed suspicious evidence growth after a failed manual pipeline attempt: the pipeline stopped with `completed 0/2` after `ns.exec failed on blade`, while the collector printed sample counts rising from 3 through 12. That evidence must not be trusted.

The collector has now been hardened so:

- the Port 15 snapshot present when the collector starts is treated as already observed;
- completion timestamps must be fresh relative to collector startup;
- every recorded batch ID is deduplicated, not just compared with the immediately previous ID;
- `lib/batch-history.js` also rejects duplicate batch IDs defensively;
- terminal collector messages include source (`PIPELINE` or `BATCH`) and a shortened batch ID;
- only real pipeline completions can promote `recommendedDepth` above 1; serialized BATCH completions remain diagnostic only.

Up to 16 real samples are retained per target. A sample is clean only if:

```text
order correct
missing jobs == 0
money >= 99.5%
security <= +0.05
max |landing error| <= 150 ms
minimum spacing >= 75 ms
```

Conservative advisory depth ladder, based only on consecutive clean pipeline samples:

```text
0-1 consecutive clean -> depth 1 / UNPROVEN
2-3 consecutive clean -> depth 2 / LOW
4-7 consecutive clean -> depth 4 / MEDIUM
8+ consecutive clean  -> depth 8 / HIGH
```

This recommendation is still advisory. Do not wire it into real multi-target execution until fresh collector behavior is revalidated.

## Latest real pipeline issue

Manual test:

```text
run hacking/pipeline-runner.js phantasy 0.10 200 2
```

Preflight succeeded and a depth-2 wave was admitted at about 6551 ms interval, but the run safety-stopped before completion:

```text
pipe-phantasy-...-1-2 launch failed at HACK: ns.exec failed on blade
```

This is now the highest-priority real-execution issue after revalidating the hardened history collector. Likely class: execution-pool RAM changed between reservation planning and JIT dispatch, or another process occupied `blade`; inspect live RAM/host state before implementing fallback/retry so the scheduler does not violate future reservations.

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
- Port 19 must be revalidated after replay/dedup hardening; the previous 12-sample history is not trusted as depth evidence.
- Persistent multi-target simulation does not yet enforce Port 19 recommended depth.
- Real pipeline can currently fail a JIT launch if planned host RAM is no longer available at dispatch time.
- XP scoring is still a proxy, not exact Formula-based hacking XP.
- Automatic worker watchdog termination remains deferred.
- Prepper, Port 17, and Port 19 state are not yet surfaced in the GUI.

## Immediate next development sequence

```text
1. Pull/start with hardened batch-history collector
2. Re-run a fresh manual pipeline test and verify Port 19 only records genuinely completed fresh pipeline batches
3. Diagnose/fix the blade ns.exec launch race without violating future host/time reservations
4. Produce multiple clean real PIPELINE completions and verify evidence ladder
5. Wire Port 19 recommendedDepth into persistent multi-target simulation as a hard per-target admission cap
6. Validate unproven targets stay depth 1 while proven targets can earn higher simulated depth
7. Finish continuous PIPELINE + PIPELINE→STANDBY drain validation
8. First real multi-target test with conservative global live depth 2 / per-target depth 1
9. Evolve real executor toward dynamic per-target depth only after clean timing evidence
10. Keep automatic worker killing deferred until multi-target timing is stable
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
