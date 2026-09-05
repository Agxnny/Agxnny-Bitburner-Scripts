# Testing and Validation Guide

Validate incrementally. Maximum live single-target pipeline depth remains 2; multi-target production is still dry-run/planning only.

## After pulling

```text
run gitpull.js
run startup.js
run diagnostics/mem-audit.js
```

`gitpull.js` should now distinguish actual content changes from clean replacement:

```text
UPDATED    file.js
REPLACED   file.js (unchanged)
ADDED      file.js
```

The final summary should include an `UPDATED` count and an `Updated files:` line when changes exist. The self-update handoff should use the same UPDATED/REPLACED distinction for `gitpull.js`.

## Startup / dedicated prepper

Startup still places the production controller in STANDBY, but the dedicated prepper is now independent background maintenance. Therefore a grow/weaken worker may be present on the reserved prep host even while production mode is STANDBY.

Acceptance checks:

```text
Port 18 model == DEDICATED_TARGET_PREPPER_V1
Port 18 reservedHost is non-empty
Port 18 updatedAt stays fresh
production execution pool excludes reservedHost
```

The prepper should choose the smallest rooted execution host with at least 32 GB by default, or fall back to the largest available host. Existing work on that host must drain naturally before prep begins.

Observe several prep waves. The prepper should round-robin targets needing work instead of finishing one difficult target before considering every other target. It must only launch GROW/WEAKEN, never HACK, and must not emit Port 14 batch timing events.

A target is considered prepared when money is >=99.5% of maximum and security is <=+0.05 above minimum. Once all currently eligible money targets meet that baseline, Port 18 should report `IDLE_PREPARED`.

If the prepper process is stopped, wait more than five seconds and confirm the previously reserved host returns to the normal production execution pool.

## Controller-managed PIPELINE

Select a validated full-money target and click Pipeline. Port 16 should report `PIPELINE_EXECUTOR_DEPTH2_V2`, `continuous: true`, `controllerManaged: true`, and `maxDepth: 2`.

Healthy completions require correct H → W1 → G → W2 order, zero missing events, money >=99.5%, and security <=+0.05. Keep the 200 ms stage gap unchanged.

### Safe drain

While a wave is active, switch to Standby. The executor should stop later wave admission, drain the current admitted work, publish `DRAINED_FOR_MODE_SWITCH`, then allow the controller to enter STANDBY. The independent prepper may continue maintenance on its reserved host.

## Multi-target allocator dry-run

Run all three profiles:

```text
run hacking/multi-target-scheduler.js money 4 0.10 200 64
run hacking/multi-target-scheduler.js balanced 4 0.10 200 64
run hacking/multi-target-scheduler.js xp 4 0.10 200 64
```

Acceptance checks:

- the script explicitly reports `workers launched: NO`;
- Port 17 model is `MULTI_TARGET_ALLOCATOR_DRY_RUN_V1`;
- dynamic per-target allocation changes by objective;
- the Port 18 reserved prep host is excluded from Port 17 capacity;
- reservations never exceed host/time capacity;
- cross-target landings obey the global spacing floor;
- Port 17 does not disturb live Port 16 state.

Current observed profile separation is healthy: MONEY heavily favors `phantasy`, BALANCED gives more relative share to XP-efficient secondary targets, and XP shifts primary allocation to `joesguns`.

## Regression checklist

- gitpull marks actual content changes as UPDATED and identical refreshes as REPLACED (unchanged);
- startup starts one prepper service and production controller in STANDBY;
- Port 18 keeps one remote host reserved while prepper is alive;
- prepper round-robins eligible targets using only grow/weaken;
- reserved prep host is excluded from normal production scheduling;
- all six GUI tabs remain responsive;
- HGW works;
- serialized BATCH works;
- PIPELINE auto-preps and runs continuous depth-2 waves;
- PIPELINE mode changes drain safely;
- Port 15 shows latest serialized/pipeline completion;
- Port 16 shows single-target pipeline state;
- Port 17 shows multi-target dry-run allocation state;
- Port 18 shows prepper/reserved-host state;
- watchdog termination remains disabled.
