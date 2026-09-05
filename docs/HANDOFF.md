# Project Handoff Guide

GitHub `main` is the source of truth. Read this file first, then fetch the current live files before editing. Project target is Bitburner v3.x; current live testing is on v3.0.1.

## Current control modes

```text
STANDBY   production controller parked
HGW       normal sequential automation
BATCH     serialized one-batch-at-a-time HWGW
PIPELINE  continuous controller-managed single-target depth-2 HWGW
MULTI     controller-managed repeated finite multi-target HWGW waves
```

`startup.js` still defaults the production controller to STANDBY. The dedicated prepper is a separate background maintenance service, so its reserved host may still run grow/weaken maintenance while production is parked.

## Latest validated runtime milestones

Dedicated prepper reservation is stable: production capacity remained `4156.5 GB / 58 hosts` with one host excluded for prep during earlier validation.

Rolling real Port 19 evidence is replay-safe. Latest validated `phantasy` single-target pipeline evidence reached 4 consecutive clean pipeline completions, producing recommended depth 4 / MEDIUM.

Persistent history-capped multi-target simulation is validated, and the real multi-target executor has now been validated at distinct-target concurrency 2 and 3.

Latest visible 3-target MONEY run admitted:

```text
phantasy
silver-helix
omega-net
```

The previous completed 3-target run admitted:

```text
phantasy
joesguns
sigma-cosmetics
```

and completed 3/3 clean. The latest completed batch visible in the GUI showed 100% money, +0.000 security, correct order, 188 ms minimum spacing, 33 ms max drift, and 4/4 timing events.

The collapsible dashboard and Multi-target activity card are runtime-visible and responsive while a 3-target wave is running.

## Configurable real multi-target runner

Managed script:

```text
hacking/multi-target-runner.js
```

Current model:

```text
MULTI_TARGET_EXECUTOR_V2_CONFIGURABLE_FINITE
```

Usage:

```text
run hacking/multi-target-runner.js [money|balanced|xp] [targetCount 2-12] [hackFraction] [stageGapMs] [globalDepth 2-12]
```

Safety posture:

```text
finite one-wave executor
configurable distinct-target global live depth up to 12
per-target live depth remains hard-capped at 1
one batch per distinct prepared target
shared global host/time RAM reservation calendar
JIT H/W/G/W dispatch
one global Port 14 consumer/router keyed by batchId
Port 15 completion publication
unique batch/run IDs
manual runs require controller STANDBY
controller-owned runs require controller MULTI mode
no same-target overlap yet
```

The runner supports a controller-only `--controller` flag. That flag is not a positional argument and allows the main controller to own repeated MULTI waves while preserving the manual STANDBY preflight for one-shot tests.

## Controller-managed MULTI mode

`hacking/controller.js` recognizes:

```text
STANDBY | HGW | BATCH | PIPELINE | MULTI
```

Port 13 request:

```text
START_MULTI { profile, targetCount, globalDepth, hackPercent, stageGapMs }
```

`START_MULTI` stores the requested configuration and transitions to MULTI at the next safe boundary. If MULTI is already active, the updated configuration applies to the next finite wave.

Controller MULTI behavior:

```text
1. controller itself schedules no single-target H/G/W work in MULTI mode
2. it launches multi-target-runner.js on home with --controller
3. each runner invocation executes one conservative finite wave
4. COMPLETE -> controller waits/re-evaluates and launches another wave
5. BLOCKED -> controller retries later (important while prepper is preparing targets)
6. SAFETY_STOP -> controller stops new admissions until Resume
7. mode switch -> no new wave is admitted; current finite wave drains naturally before transition
```

Current defaults if MULTI is selected without a custom GUI request:

```text
profile MONEY
top targets 6
global distinct-target live depth 3
hack 10%
stage gap 200 ms
```

These remain deliberately conservative: repeated waves are continuous at the controller level, but there is still no same-target overlap inside a wave.

Controller state publishes:

```text
executionMode.multiRunning
executionMode.multiRunnerHost
executionMode.multiSafetyStopped
executionMode.multiConfig
```

## Progressive multi-target stress test

New managed script:

```text
diagnostics/multi-target-stress.js
```

Current model/state:

```text
MULTI_TARGET_STRESS_V1
Port 20
```

Default command:

```text
run diagnostics/multi-target-stress.js
```

Equivalent explicit defaults:

```text
run diagnostics/multi-target-stress.js mixed 8 2 12 0.10 200 10
```

Arguments:

```text
profile mode: mixed | money | balanced | xp
maxDepth: highest distinct-target concurrency to test, 2-12
wavesPerDepth: clean waves required before increasing depth, 1-10
targetCount: candidate target window, 2-12 and >= maxDepth
hackFraction: default 0.10
stageGapMs: default 200
prepWaitMinutes: how long BLOCKED waves may wait/retry for prep, default 10
```

Stress-test behavior:

```text
starts at distinct-target depth 2
requires every wave at a depth to complete cleanly before incrementing depth
mixed mode rotates MONEY -> BALANCED -> XP to exercise a broader range of ranked targets
uses the real finite multi-target runner, not simulation
runs only while controller is fully STANDBY
never overlaps two real multi-target coordinators
BLOCKED waits/retries for the dedicated prepper up to the configured timeout
first SAFETY_STOP / bad completion stops escalation immediately
controller mode changes stop the test after the current finite wave drains
records highest clean depth, clean wave count, unique targets, max drift, min spacing, blocked retries, and recent wave results on Port 20
```

This gives a repeatable downtime burn-in test for finding the highest observed clean distinct-target concurrency. It does not automatically promote production MULTI depth; results are evidence for later manual/controller tuning.

After adding this script the expected managed-file audit becomes:

```text
54 installed managed JS files
42 runnable scripts
12 library modules
0 unmanaged installed .js files
```

Runtime validation is still required after pull.

## Main GUI multi-target controls and activity

The Batch tab has:

```text
Multi-target controls
Multi-target activity
```

The same Profile / Top targets / Live batches / Hack % / Stage gap fields drive either:

```text
Finite wave       one-shot manual test, requires STANDBY
Start controller  switches to controller MULTI mode
Update controller changes the config used by the next MULTI wave
```

Quick Controls also has a `Multi` mode button using the current multi-target fields.

The activity card shows current executor profile/run ID/owner, active-target count, completed count, and active target rows with H and W2 countdowns plus launched-stage progress.

All dashboard content cards and hero cards are collapsible with React-local state. React callbacks remain Netscript-free.

The dashboard suppresses stale Port 16 pipeline state unless the controller says the pipeline is running or the Port 16 state is fresh, avoiding the earlier appearance of a pipeline still running many minutes after it stopped.

The progressive stress test currently has a terminal command + Port 20 state contract. A compact GUI stress card can be added after the backend is runtime-validated rather than increasing dashboard complexity before the test behavior is proven.

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

The persistent simulator may use these caps. Real controller MULTI still ignores higher same-target recommendations and remains at one live batch per target.

## Runtime batching / scheduler state

- Port 12: serialized batch snapshot.
- Port 14: live batch timing-event queue; exactly one real coordinator owns it.
- Port 15: latest completed batch.
- Port 16: single-target pipeline planner/simulator/executor.
- Port 17: global multi-target planner/simulator/executor state.
- Port 18: dedicated prepper/reserved-host state.
- Port 19: rolling per-target real batch safety history.
- Port 20: progressive multi-target stress-test state.

## Current important limitations

- Controller MULTI is newly integrated and still needs runtime validation across repeated controller-owned waves.
- MULTI currently repeats whole finite waves; it is not yet a continuously rolling per-target admission scheduler.
- Per-target real multi-target depth is intentionally fixed at 1.
- Larger tests increase the number of distinct concurrent targets, not same-target pipeline depth.
- Target-local failure/recovery is not yet implemented; current safety policy is a global MULTI admission stop until Resume.
- Active multi-target timing card still shows H and W2 countdowns plus launched-stage progress rather than full four-stage live timings.
- Stress test exercises distinct-target concurrency only; it does not test same-target overlap.
- XP scoring remains a proxy, not exact Formula-based hacking XP.
- Automatic worker watchdog termination remains deferred.

## Immediate next development sequence

```text
1. Pull latest main and restart startup
2. Run diagnostics/mem-audit.js; expect 54 managed JS / 42 scripts / 12 modules / 0 unmanaged
3. Finish controller MULTI validation at MONEY top 6 / live 3 / hack 10% / gap 200
4. Verify repeated controller waves and MULTI -> STANDBY drain behavior
5. During safe downtime with controller parked, run diagnostics/multi-target-stress.js mixed 6 2 12 0.10 200 10 for an initial burn-in
6. If clean through depth 6, optionally extend to maxDepth 8 before trying higher values
7. Record the first failing/blocked depth, target mix, drift, spacing, and exact failure reason
8. Only after repeated clean evidence consider rolling admission and evidence-gated same-target depth
```

## Useful commands

```text
run gitpull.js
run startup.js
run diagnostics/mem-audit.js
ps home
run hacking/multi-target-runner.js money 6 0.10 200 3
run diagnostics/multi-target-stress.js mixed 6 2 12 0.10 200 10
run diagnostics/multi-target-stress.js mixed 8 2 12 0.10 200 10
```
