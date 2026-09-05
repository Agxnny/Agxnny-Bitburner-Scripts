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

## Dedicated prepper

The dedicated prepper is live on home and the production pool correctly excludes its reserved host. Before prepper reservation the multi-target dry run saw `4196.00 GB / 59 hosts`; with prepper active it saw `4156.50 GB / 58 hosts`.

## Rolling real batch safety history

Files/services:

```text
lib/batch-history.js
hacking/batch-history.js
```

`kickstart.js` starts the collector on home. It watches fresh completed real batches on Port 15 and publishes rolling per-target safety history on Port 19. Current model:

```text
ROLLING_BATCH_HISTORY_V2_PIPELINE_EVIDENCE
```

The collector is hardened against replay/duplication: the startup Port 15 snapshot is treated as already seen, fresh timestamps are required, batch IDs are deduplicated, and only real PIPELINE completions can promote depth above 1.

Latest runtime validation on `phantasy`:

```text
PIPELINE depth 2, interval 6216 ms
batch 1: money 100.00%, security +0.000, ORDER OK
batch 2: money 100.00%, security +0.000, ORDER OK
collector after batch 1: pipeline evidence 3, clean streak 3, recommended depth 2 / LOW
collector after batch 2: pipeline evidence 4, clean streak 4, recommended depth 4 / MEDIUM
```

The 16 total retained samples still include older diagnostic history, but only the validated pipeline evidence/streak drives depth recommendations.

A clean pipeline sample requires:

```text
order correct
missing jobs == 0
money >= 99.5%
security <= +0.05
max |landing error| <= 150 ms
minimum spacing >= 75 ms
```

Depth ladder:

```text
0-1 consecutive clean -> depth 1 / UNPROVEN
2-3 consecutive clean -> depth 2 / LOW
4-7 consecutive clean -> depth 4 / MEDIUM
8+ consecutive clean  -> depth 8 / HIGH
```

## Persistent multi-target admission simulation

`hacking/multi-target-sim.js` remains planning-only and launches no workers. It now enforces Port 19 `recommendedDepth` as a **hard per-target simulated admission cap**.

Current model:

```text
MULTI_TARGET_ADMISSION_SIM_V3_HISTORY_CAPPED
```

Important behavior:

- unprepared targets remain `WAITING_PREP`;
- prepared targets with no trusted pipeline evidence are capped at depth 1;
- proven targets can earn depth 2/4/8 according to Port 19;
- when a target reaches its evidence cap it reports `AT_SAFETY_CAP`;
- if a recommendation falls below current virtual depth, existing virtual batches are not killed; new admissions stop until depth naturally falls below the cap;
- the shared global host/time RAM reservation calendar and objective/fairness scoring remain unchanged;
- Port 17 now exposes `safetyDepthCap`, `safetyConfidence`, pipeline evidence count, clean streak, and Port 19 collector status for each target.

This is still simulation only; Port 19 does not yet authorize high live multi-target depth.

## Real pipeline launch-race note

One earlier manual depth-2 run safety-stopped because `ns.exec` failed on `blade`. Subsequent depth-2 runs completed cleanly, including the validated 6216 ms run above, so the failure is currently **not reproducible**. Do not add blind launch retries that could violate future host/time reservations. Revisit only if the failure recurs with repeatable host/RAM evidence.

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
- Port 19 depth evidence is intentionally conservative and only real pipeline completions promote it.
- XP scoring is still a proxy, not exact Formula-based hacking XP.
- Automatic worker watchdog termination remains deferred.
- Prepper, Port 17, and Port 19 state are not yet surfaced in the GUI.

## Immediate next development sequence

```text
1. Pull latest main
2. Run persistent MONEY simulation and verify phantasy is capped at depth 4 while unproven targets remain depth 1
3. Verify AT_SAFETY_CAP appears and replacement admissions respect caps over time
4. Compare BALANCED and XP under the same evidence caps
5. Finish continuous PIPELINE + PIPELINE→STANDBY drain validation
6. First real multi-target test with conservative global live depth 2 / per-target depth 1
7. Evolve real executor toward dynamic per-target depth only after clean timing evidence
8. Keep automatic worker killing deferred until multi-target timing is stable
```

## Useful commands

```text
run startup.js
run diagnostics/mem-audit.js
ps home
run hacking/multi-target-sim.js money 4 0.10 200 64
run hacking/multi-target-sim.js balanced 4 0.10 200 64
run hacking/multi-target-sim.js xp 4 0.10 200 64
run hacking/pipeline-runner.js phantasy 0.10 200 2
```

For updates:

```text
run gitpull.js
run startup.js
```
