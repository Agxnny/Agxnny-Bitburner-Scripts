# Testing and Validation Guide

Validate incrementally. Maximum live single-target pipeline depth remains 2; multi-target production is still planning/simulation only.

## After pulling

```text
run gitpull.js
run startup.js
run diagnostics/mem-audit.js
```

Expected managed-file baseline after the persistent simulator change:

```text
Files: 50
Runnable scripts: 39
Library modules: 11
Unmanaged installed .js files: 0
```

`gitpull.js` should distinguish actual content changes from clean replacement:

```text
UPDATED    file.js
REPLACED   file.js (unchanged)
ADDED      file.js
```

## Startup / dedicated prepper

Startup places the production controller in STANDBY, but the dedicated prepper remains independent background maintenance. Therefore a grow/weaken worker may be present on the reserved prep host even while production mode is STANDBY.

Acceptance checks:

```text
Port 18 model == DEDICATED_TARGET_PREPPER_V1
Port 18 reservedHost is non-empty
Port 18 updatedAt stays fresh
production execution pool excludes reservedHost
```

Current live validation showed the production pool fall from `4196.00 GB / 59 hosts` to `4156.50 GB / 58 hosts` with the prepper active, while the MONEY one-shot allocation remained 16/4/2.

## Multi-target one-shot dry run

Run all three profiles:

```text
run hacking/multi-target-scheduler.js money 4 0.10 200 64
run hacking/multi-target-scheduler.js balanced 4 0.10 200 64
run hacking/multi-target-scheduler.js xp 4 0.10 200 64
```

Acceptance checks:

- script reports `workers launched: NO`;
- Port 17 model is `MULTI_TARGET_ALLOCATOR_DRY_RUN_V2_SHARED`;
- dynamic allocation changes by objective;
- Port 18 reserved host is excluded from capacity;
- host/time reservations never exceed capacity;
- cross-target landings obey the global spacing floor;
- Port 16 remains untouched.

## Persistent multi-target admission simulation

First validation should be done while the production controller is in STANDBY:

```text
run hacking/multi-target-sim.js money 4 0.10 200 64
```

The simulator is intentionally long-running. It launches no workers and should print a compact summary about every 10 seconds unless `--quiet` is supplied.

Acceptance checks:

```text
Port 17 model == MULTI_TARGET_ADMISSION_SIM_V2_PERSISTENT
persistent == true
dryRun == true
launchesWorkers == false
consumesBatchTimingPort == false
capacity.inFlight > 0 when prepared candidates fit
capacity.totalAdmitted >= capacity.inFlight
```

Leave it running long enough for the first virtual batch landing horizon to pass. Then verify:

- `capacity.totalCompleted` increases;
- expired virtual reservations disappear;
- new admissions replace completed work;
- current target depths can change over time instead of remaining a fixed initial split;
- fairness does not flatten permanently because its penalty is based on current in-flight depth;
- targets below 99.5% money or above +0.05 security show `WAITING_PREP` and receive no new virtual production batches;
- after the prepper restores such a target, it can transition to READY/RUNNING and receive admissions without restarting the simulator;
- Port 18 status/reserved host is mirrored into the Port 17 `prepper` section;
- Port 14 receives no events from the simulator;
- no H/G/W workers appear because of the simulator.

Then repeat with:

```text
kill hacking/multi-target-sim.js
run hacking/multi-target-sim.js balanced 4 0.10 200 64
```

and later:

```text
kill hacking/multi-target-sim.js
run hacking/multi-target-sim.js xp 4 0.10 200 64
```

Only run one persistent simulator at a time. The one-shot scheduler and persistent simulator both publish latest-value Port 17 state, so a one-shot run will be overwritten on the simulator's next tick.

## Controller-managed PIPELINE

Select a validated full-money target and click Pipeline. Port 16 should report `PIPELINE_EXECUTOR_DEPTH2_V2`, `continuous: true`, `controllerManaged: true`, and `maxDepth: 2`.

Healthy completions require correct H → W1 → G → W2 order, zero missing events, money >=99.5%, and security <=+0.05. Keep the 200 ms stage gap unchanged.

### Safe drain

While a wave is active, switch to Standby. The executor should stop later wave admission, drain current admitted work, publish `DRAINED_FOR_MODE_SWITCH`, then allow the controller to enter STANDBY. The independent prepper may continue maintenance on its reserved host.

## Regression checklist

- gitpull marks actual content changes as UPDATED and identical refreshes as REPLACED (unchanged);
- startup starts one prepper service and production controller in STANDBY;
- Port 18 keeps one remote host reserved while prepper is alive;
- prepper round-robins eligible targets using only grow/weaken;
- reserved prep host is excluded from normal production scheduling;
- one-shot Port 17 allocator still works after shared-helper refactor;
- persistent Port 17 simulator admits, expires, completes, and replaces virtual batches;
- unprepared persistent targets stay WAITING_PREP;
- no multi-target planner/simulator launches workers or consumes Port 14;
- all six GUI tabs remain responsive;
- HGW works;
- serialized BATCH works;
- PIPELINE auto-preps and runs continuous depth-2 waves;
- PIPELINE mode changes drain safely;
- Port 15 shows latest serialized/pipeline completion;
- Port 16 shows single-target pipeline state;
- Port 18 shows prepper/reserved-host state;
- watchdog termination remains disabled.
