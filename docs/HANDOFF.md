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

Latest pre-GUI memory audit after adding the live multi-target runner was clean:

```text
53 installed managed JS files
41 runnable scripts
12 library modules
0 unmanaged installed .js files
```

A fresh audit is required after pulling the GUI integration because `ui/dashboard.js` now imports Port 17 state and has additional multi-target UI logic.

## Real multi-target validation

The conservative real multi-target runner has completed four valid consecutive MONEY waves at global live depth 2 / per-target depth 1. Each valid wave admitted `phantasy` and `joesguns`, and both targets returned to:

```text
money 100.00%
security +0.000
ORDER OK
COMPLETE 2/2
```

A fifth pasted command was accidentally concatenated (`200run ...`) and produced an invalid stage-gap argument followed by `ns.exec failed on hgw-001`. Treat that run as malformed input, not as a proven scheduler/RAM failure.

The runner now rejects malformed/extra positional arguments instead of allowing `NaN` timing values.

Repeated old runs reused IDs such as `multi-phantasy-1`, which meant the Port 19 collector deduplicated later completions. This is fixed: every invocation now gets a unique run ID and unique batch IDs.

## Configurable finite multi-target runner

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
finite one-wave execution only
configurable global live depth up to 12
per-target live depth remains hard-capped at 1
one batch per distinct prepared target
shared global host/time RAM reservation calendar
JIT H/W/G/W dispatch
one global Port 14 consumer/router keyed by batchId
Port 15 completion publication
unique batch/run IDs
controller must be fully parked in STANDBY
no dynamic same-target overlap yet
```

The runner refuses to launch if the controller is not fully settled in STANDBY, if controller workers are still active, or if conflicting batch/pipeline/simulator coordinators are running.

The landing summary publishes aggregate `expectedJobs`, `reportedJobs`, `missingJobs`, and `totalMissingJobs`, so Port 19 missing-job safety checks have an explicit aggregate field.

## Main GUI multi-target controls and activity

`ui/dashboard.js` reads Port 17 and exposes two multi-target cards in the **Batch** tab:

```text
Multi-target finite wave
Multi-target activity
```

The finite-wave control card provides:

```text
Profile: MONEY / BALANCED / XP
Top targets: 2-12
Live batches: 2-12
Hack %
Stage gap ms
Run finite wave
```

`Live batches` means distinct-target global concurrency. Same-target overlap remains locked at depth 1. The Run button is disabled unless the production controller is fully in STANDBY with no active controller jobs.

The new activity card shows current executor profile/run ID, active-target count, completed count, and one row per active target with:

```text
target
ACTIVE status
H landing countdown
W2 landing countdown
launched stage list
```

Completed target timing rows are available under an expandable section and show recovery health, money/security, max landing drift, minimum spacing, and order status.

All dashboard content cards are now collapsible. The four compact hero metric cards are also collapsible. Collapse state is React-local UI state only; no Netscript work occurs inside card-toggle callbacks.

React callbacks remain Netscript-free: they only update local/plain-JS request state. The async dashboard loop validates actions and performs Netscript I/O or `ns.run()` calls.

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

The persistent simulator may use these caps. The real multi-target executor still ignores higher same-target recommendations and remains at one live batch per target.

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
- Multi-target runner is GUI-launchable but still finite/manual-test execution, not controller-integrated production.
- Per-target real multi-target depth is intentionally fixed at 1.
- Larger GUI tests increase the number of distinct concurrent targets, not same-target pipeline depth.
- Active multi-target timing card currently shows first H and final W2 landing countdowns plus launched-stage progress; full four-stage per-target live timing bars are not yet published on Port 17.
- Target-local failure/recovery policy is not yet implemented for continuous multi-target execution.
- XP scoring remains a proxy, not exact Formula-based hacking XP.
- Automatic worker watchdog termination remains deferred.
- Prepper and Port 19 safety history are still not fully surfaced in the GUI.

## Immediate next development sequence

```text
1. Pull latest main and restart startup so the collapsible dashboard/activity card is live
2. Run a fresh mem-audit and record the new dashboard RAM cost
3. Finish the currently running MONEY multi-target test and record admitted targets/results
4. In Batch tab, test MONEY with 3 distinct live batches and inspect the new activity rows/timing countdowns
5. If clean, try 4 distinct live batches, then increase gradually rather than jumping directly to 12
6. Compare BALANCED and XP target selection at the same safe distinct-target depth
7. Add target-local failure/recovery policy before any continuous multi-target admission
8. Only after repeated clean evidence consider same-target overlap/dynamic per-target live depth
9. Keep automatic worker killing deferred until multi-target timing is stable
```

## Useful commands

```text
run gitpull.js
run startup.js
run diagnostics/mem-audit.js
ps home
run hacking/multi-target-sim.js money 4 0.10 200 64
run hacking/multi-target-runner.js money 4 0.10 200 2
run hacking/multi-target-runner.js money 6 0.10 200 3
run hacking/multi-target-runner.js balanced 6 0.10 200 3
run hacking/multi-target-runner.js xp 6 0.10 200 3
run hacking/pipeline-runner.js phantasy 0.10 200 2
```
