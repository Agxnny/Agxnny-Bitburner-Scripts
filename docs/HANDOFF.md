# Project Handoff Guide

GitHub `main` is the source of truth. Read this file first, then fetch the current live files before editing. Project target is Bitburner v3.x; current live testing is on v3.0.1.

## Current control modes

```text
STANDBY   production controller parked
HGW       normal sequential automation
BATCH     serialized one-batch-at-a-time HWGW
PIPELINE  continuous controller-managed depth-2 HWGW
```

`startup.js` defaults the production controller to STANDBY. The dedicated prepper is a separate background maintenance service, so its reserved host may still run grow/weaken maintenance while production is parked.

## Latest validated runtime milestones

Dedicated prepper reservation is stable: production capacity remains `4156.5 GB / 58 hosts` with one host excluded for prep.

Rolling real Port 19 evidence is replay-safe. Latest validated `phantasy` single-target pipeline evidence reached 4 consecutive clean pipeline completions, producing recommended depth 4 / MEDIUM.

Persistent history-capped multi-target simulation is validated. MONEY profile held:

```text
phantasy        depth 4/4
joesguns        depth 1/1
sigma-cosmetics depth 1/1
foodnstuff      depth 0/1 WAITING_PREP
```

while rolling admissions progressed from 6 admitted / 0 completed to 8 admitted / 2 completed without violating evidence caps.

Controller-managed PIPELINE -> STANDBY drain is runtime-validated: the pipeline runner remained alive while the admitted wave drained, then exited while dashboard, prepper, history collector, and controller stayed running.

Latest memory audit is clean:

```text
52 installed managed JS files
40 runnable scripts
12 library modules
0 unmanaged installed .js files
```

Largest scripts before adding the live multi-target prototype were:

```text
10.65 GB hacking/pipeline-runner.js
 9.70 GB hacking/batch-runner.js
 8.90 GB hacking/multi-target-sim.js
 8.85 GB hacking/multi-target-scheduler.js
```

Run a fresh audit after pulling the new prototype because the managed file count should increase by one.

## Rolling real batch safety history

Current Port 19 model:

```text
ROLLING_BATCH_HISTORY_V2_PIPELINE_EVIDENCE
```

Clean criteria:

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

The persistent simulator may use these caps. Real multi-target execution must remain more conservative until its own timing behavior is proven.

## First real multi-target prototype

New managed script:

```text
hacking/multi-target-runner.js
```

Current model:

```text
MULTI_TARGET_EXECUTOR_V1_CONSERVATIVE
```

This is a finite manual-test executor, not controller-integrated production. Safety posture:

```text
global live depth 2
per-target live depth 1
2 distinct prepared targets
shared global host/time RAM reservation calendar
JIT H/W/G/W dispatch
one global Port 14 consumer/router keyed by batchId
Port 15 completion publication
no dynamic Port 19 live-depth promotion
```

It refuses to start while the single-target pipeline runner, serialized batch runner, or persistent multi-target simulator is active.

Important: the earlier one-off `ns.exec failed on blade` single-target pipeline failure has not reproduced in subsequent runs. Do not add blind launch retries; revisit only if launch failure becomes repeatable with host/RAM evidence.

## Runtime batching / scheduler state

- Port 12: serialized batch snapshot.
- Port 14: live batch timing-event queue; exactly one real coordinator owns it.
- Port 15: latest completed batch.
- Port 16: single-target pipeline planner/simulator/executor.
- Port 17: global multi-target planner/simulator/executor state.
- Port 18: dedicated prepper/reserved-host state.
- Port 19: rolling per-target real batch safety history.

## Current important limitations

- Controller PIPELINE is still single-target and fixed depth 2.
- New multi-target runner is manual and finite only.
- Real multi-target depth is intentionally fixed to global 2 / per-target 1.
- XP scoring remains a proxy, not exact Formula-based hacking XP.
- Automatic worker watchdog termination remains deferred.
- Prepper, Port 17, and Port 19 are not yet surfaced in the GUI.
- Multi-target launch/recovery behavior has not yet been runtime validated.

## Immediate next development sequence

```text
1. Pull latest main
2. Run mem-audit; expect 53 managed JS files, 41 runnable scripts, 12 modules, 0 unmanaged
3. Ensure multi-target simulator and single-target pipeline runner are stopped
4. Run first real conservative MONEY multi-target test
5. Verify two distinct prepared targets each complete one clean HWGW batch with correct Port 14 routing
6. If clean, repeat several finite waves before any controller integration
7. Add target-local failure/recovery policy before continuous real multi-target admission
8. Only then consider controller integration and later evidence-gated dynamic real depth
9. Keep automatic worker killing deferred until multi-target timing is stable
```

## Useful commands

```text
run gitpull.js
run startup.js
run diagnostics/mem-audit.js
ps home
run hacking/multi-target-sim.js money 4 0.10 200 64
run hacking/multi-target-runner.js money 4 0.10 200
run hacking/pipeline-runner.js phantasy 0.10 200 2
```
