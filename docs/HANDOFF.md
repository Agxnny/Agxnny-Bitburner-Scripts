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

`hacking/prepper.js` reserves one remote host, publishes Port 18, round-robins eligible targets with grow/weaken only, and returns the host to production automatically if its heartbeat goes stale.

## Multi-target planning

`hacking/multi-target-scheduler.js` remains the one-shot dry-run allocator. It now uses shared helpers from `lib/batch-allocation.js` so batch-template and host/time reservation logic are not duplicated with the persistent simulator.

Usage:

```text
run hacking/multi-target-scheduler.js money 4 0.10 200 64
run hacking/multi-target-scheduler.js balanced 4 0.10 200 64
run hacking/multi-target-scheduler.js xp 4 0.10 200 64
```

Current one-shot model:

```text
MULTI_TARGET_ALLOCATOR_DRY_RUN_V2_SHARED
```

Observed profile separation before the persistent simulator was added:

```text
MONEY:    phantasy 16 | joesguns 4 | sigma-cosmetics 2
BALANCED: phantasy 11 | joesguns 4 | sigma-cosmetics 1 | foodnstuff 1
XP:       joesguns 3  | foodnstuff 2 | sigma-cosmetics 1 | phantasy 1
```

XP sourcing now uses planner rankings instead of economic rankings so XP mode is not constrained by money-specific filtering. XP remains an explicit proxy metric, not exact Formula-based XP optimization.

## Persistent multi-target admission simulation

`hacking/multi-target-sim.js` is the next planning stage. It is long-running but still launches **no workers**.

Usage:

```text
run hacking/multi-target-sim.js money 4 0.10 200 64
run hacking/multi-target-sim.js balanced 4 0.10 200 64
run hacking/multi-target-sim.js xp 4 0.10 200 64
```

Model:

```text
MULTI_TARGET_ADMISSION_SIM_V2_PERSISTENT
```

Behavior:

- continuously refreshes the real production execution pool;
- preserves one shared host/time RAM reservation calendar;
- expires virtual reservations as their landing windows pass;
- repeatedly admits new virtual batches as capacity becomes free;
- applies fairness against **current virtual depth**, not lifetime admissions, so fairness pressure does not grow forever;
- only admits production batches for targets currently at >=99.5% money and <=+0.05 security;
- marks unprepared candidates `WAITING_PREP` while the independent Port 18 prepper works on them;
- dynamically rebalances target depth as virtual batches complete;
- resets the virtual calendar safely if the production host set changes;
- publishes live per-target depth, lifetime admissions/completions, recent 60-second completions, prepper status, in-flight batches, and host peak reservations to Port 17;
- does not consume Port 14 and does not interfere with the single-target pipeline state on Port 16.

For first validation, run the persistent simulator while the production controller is in STANDBY and leave it alive long enough for at least one virtual batch to complete and be replaced.

## Runtime batching / scheduler state

- Port 12: serialized batch snapshot.
- Port 14: live batch timing-event queue.
- Port 15: latest completed serialized/pipeline batch.
- Port 16: current single-target pipeline planner/simulator/executor.
- Port 17: one-shot or persistent global multi-target planner/simulator.
- Port 18: dedicated prepper/reserved-host state.

The current real PIPELINE executor still owns Port 14 while active. Neither multi-target planning script consumes Port 14. The prepper also does not consume or emit Port 14 timing events.

## Current important limitations

- Live PIPELINE depth is still fixed at 2.
- Multi-target work is still simulation/planning only; no real multi-target worker launches yet.
- Persistent simulation uses real wall-clock time but virtual batch completions do not mutate targets.
- Port 15 is latest-only; rolling real landing/recovery history is still missing.
- Timing adaptation still uses latest matching completion rather than several real samples.
- XP scoring is a proxy, not exact hacking XP.
- Automatic worker watchdog termination remains deferred.
- Prepper and persistent multi-target state are not yet surfaced in the GUI.

## Immediate next development sequence

```text
1. Pull and run mem-audit; expect 50 managed JS files, 39 runnable scripts, 11 modules
2. Run persistent MONEY simulation in STANDBY and verify Port 17 model/state
3. Leave it running until virtual completions occur and replacement admissions appear
4. Confirm unprepared targets stay WAITING_PREP and become eligible after prepper readiness changes
5. Compare persistent MONEY/BALANCED/XP depth over time
6. Add rolling per-target real landing/recovery history
7. Finish continuous PIPELINE + PIPELINE→STANDBY drain validation
8. First real multi-target test with conservative global live depth 2 / per-target depth 1
9. Evolve real executor toward dynamic per-target depth using the shared global calendar
10. Keep automatic worker killing deferred until multi-target timing is stable
```

## Useful commands

```text
run startup.js
run diagnostics/mem-audit.js
run hacking/prepper.js
run hacking/multi-target-scheduler.js money 4 0.10 200 64
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

## Related documentation

- `README.md`
- `docs/architecture.md`
- `docs/BATCH_SCHEDULER.md`
- `docs/RUNTIME_STATE.md`
- `docs/TESTING.md`
- `docs/SYSTEM_MAP.md`
- `docs/ROADMAP.md`
