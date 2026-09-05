# Project Handoff Guide

GitHub `main` is the source of truth. Read this file first, then fetch current live files before editing. Target is Bitburner v3.x; live testing is v3.0.1.

## Engineering constraints: prefer modules over monoliths

This project now has an explicit maintainability rule: prefer small modules with narrow responsibilities that work together over large monolithic scripts.

Soft size targets:

```text
ordinary module / script        aim for <= 300 lines
review / split threshold        ~400 lines
exception threshold             >500 lines requires a clear reason
UI view module                  ideally 100-250 lines
shared UI component module      ideally 100-250 lines
entrypoint / coordinator        keep as small as practical; orchestration only
individual function             usually <= 40-60 lines
```

These are engineering guardrails, not arbitrary hard failures. A cohesive file may exceed them when splitting would make the design worse, but growth beyond the review threshold should trigger a deliberate check for separable responsibilities.

Preferred decomposition rules:

```text
- one clear responsibility per module
- keep React/UI rendering separate from Netscript I/O
- keep state transport, actions, formatting, styles, and views separable
- reuse shared helpers instead of copying logic between runners/views
- avoid circular imports
- avoid tiny one-function files when they do not create a meaningful boundary
- do not add abstraction solely to reduce line count
- preserve Bitburner RAM awareness when introducing imports
- large coordinators should delegate calculation/state/rendering to pure helper modules
- new features should normally extend an existing focused module or add a focused module, not enlarge a monolith
```

For GUI work specifically, preserve the single-mounted React tree and Netscript-free React callbacks. The asynchronous Netscript loop owns ports/files/process launches; React consumes cached plain-JS state and emits plain-JS requests.

The current monolithic `ui/dashboard.js` is a known exception and should be replaced by a parity-first modular refactor before substantial new GUI features are added. The intended shape is approximately:

```text
ui/
  dashboard.js          small entrypoint / async bridge
  state.js              snapshot collection
  actions.js            request/action bridge
  styles.js             shared style objects
  components/
    layout.js
    controls.js
    telemetry.js
  views/
    overview.js
    targets.js
    economy.js
    batch.js
    network.js
    diagnostics.js
```

Feature parity comes before cleanup or redesign. Existing tabs, controls, cards, collapse behavior, MULTI controls, batch telemetry, economy/network views, and safety behavior must survive the refactor. The distributed-prepper target-progress card should be added after or as part of that modular Targets view.

## Control modes

```text
STANDBY   controller parked
HGW       sequential automation
BATCH     serialized HWGW
PIPELINE  continuous single-target depth-2 HWGW
MULTI     controller-managed repeated finite multi-target waves
```

Startup defaults to STANDBY. Background prep is independent of production mode.

## Latest runtime evidence

Real multi-target stress test `mixed 6 2 12 0.10 200 10` completed cleanly through distinct-target depth 5:

```text
depth 2: 2/2 clean
depth 3: 2/2 clean
depth 4: 2/2 clean
depth 5: 2/2 clean
worst max drift: 129 ms
worst minimum spacing: 151 ms
```

Targets exercised included `phantasy`, `silver-helix`, `joesguns`, `sigma-cosmetics`, and `omega-net`. Depth 6 did NOT fail: it was prep-limited because XP found only 5 prepared candidates inside the top 12. Therefore global distinct-target concurrency 5 is proven clean; depth 6 remains inconclusive.

Earlier real 2-target and 3-target finite waves were also clean. Latest visible 3-target MONEY evidence showed 100% money, +0.000 security, correct H/W1/G/W2 order, 188 ms minimum spacing, 33 ms max drift, and 4/4 timing events.

## Distributed target prepper V2

Managed script:

```text
hacking/prepper.js
model: DISTRIBUTED_TARGET_PREPPER_V2
state: Port 18
```

The old single-dedicated-host prepper has been replaced.

V2 behavior:

```text
- periodically calls the shared rankEligibleTargets() path, which scans the reachable network
- therefore considers every rooted, currently hackable money server, not only planner ranking snapshots
- target universe refresh defaults to every 15 seconds
- ready threshold remains money >= 99.5% and security <= min +0.05
- reserves a bounded slice of REMOTE execution RAM by selecting small execution hosts
- default reserve target: 12.5% of total remote RAM
- default minimum reserve: 64 GB
- default maximum reserve: 1024 GB
- reserved hosts are excluded from production by lib/execution.js
- multiple reserved hosts may prep different targets concurrently
- active/fresh multi-target demand receives priority, then normal target rank
- all other eligible targets are eventually prepared in the background
- existing production work on a newly reserved host drains naturally before prep uses it
- reservations are not moved while prep jobs are active
```

Usage:

```text
run hacking/prepper.js
run hacking/prepper.js 0.125 64 1024
```

Arguments are `reserveRatio minReserveGb maxReserveGb`.

Port 18 V2 publishes `reservedHosts`, `reservedRamGb`, `targetCount`, `preparedCount`, `needsPrepCount`, `activeCount`, `activeJobs`, `prepTargets`, `demandTargets`, `nextTargets`, and completed wave count. Each `prepTargets` entry includes current/max money, money ratio, security delta, current/next prep action, active host, and estimated prep ETA. `reservedHost` is retained as a compatibility alias for the first reserved host.

`lib/execution.js` understands both legacy one-host Port 18 state and V2 multi-host reservations. A fresh V2 reservation excludes every listed reserved host from the production execution pool.

Important runtime validation still required after pull: verify the new prepper starts, reserves a reasonable amount of RAM, increases prepared target count, and production pool excludes all reserved prep hosts without collisions.

## Multi-target runner

```text
hacking/multi-target-runner.js
model: MULTI_TARGET_EXECUTOR_V2_CONFIGURABLE_FINITE
```

Usage:

```text
run hacking/multi-target-runner.js [money|balanced|xp] [targetCount 2-12] [hackFraction] [stageGapMs] [globalDepth 2-12]
```

It is still a conservative finite executor: one batch per distinct prepared target, per-target live depth hard-capped at 1, shared host/time RAM calendar, JIT H/W/G/W dispatch, one Port 14 consumer/router, Port 15 completion, unique run/batch IDs. Manual runs require STANDBY; controller-owned runs use `--controller` in MULTI mode.

## Controller MULTI

Controller supports `STANDBY | HGW | BATCH | PIPELINE | MULTI`.

Port 13 request:

```text
START_MULTI { profile, targetCount, globalDepth, hackPercent, stageGapMs }
```

MULTI launches one finite `multi-target-runner.js --controller` wave at a time. COMPLETE causes another wave after re-evaluation; BLOCKED retries later; SAFETY_STOP halts new admissions until Resume; mode changes drain the current wave before transition.

Defaults remain MONEY / top 6 / global depth 3 / hack 10% / stage gap 200 ms. The stress-test result is not yet automatically consumed as a production ceiling; wiring proven global depth into controller policy is a next step.

## Progressive stress test

```text
diagnostics/multi-target-stress.js
model: MULTI_TARGET_STRESS_V1
state: Port 20
```

Example:

```text
run diagnostics/multi-target-stress.js mixed 6 2 12 0.10 200 10
```

It starts at depth 2, requires all requested waves at a depth to be clean before incrementing, rotates MONEY/BALANCED/XP in mixed mode, uses the real finite runner, requires controller STANDBY, and stops escalation on safety failure. BLOCKED waves wait/retry for prep up to the configured timeout.

Current limitation: BLOCKED prep retries relaunch the finite runner every 10 seconds. With V2 prepper this should become less common, but a future cleanup should let the stress harness observe prep readiness directly and avoid noisy runner relaunches.

## Rolling batch history

Port 19 model: `ROLLING_BATCH_HISTORY_V2_PIPELINE_EVIDENCE`.

Clean criteria: correct order, missing jobs 0, money >=99.5%, security <=+0.05, max absolute landing error <=150 ms, minimum spacing >=75 ms.

Per-target evidence ladder:

```text
0-1 clean -> depth 1 / UNPROVEN
2-3 clean -> depth 2 / LOW
4-7 clean -> depth 4 / MEDIUM
8+ clean  -> depth 8 / HIGH
```

This per-target evidence is separate from global distinct-target stress evidence. Real MULTI still hard-caps same-target depth at 1.

## Runtime state ports

```text
12 serialized batch
14 live worker timing events; exactly one real coordinator owns it
15 latest completed batch
16 single-target pipeline state
17 multi-target scheduler/executor state
18 distributed prepper state
19 rolling per-target safety history
20 progressive global stress-test state
```

## GUI

Batch tab contains Multi-target controls and Multi-target activity. Same profile/top-target/live-batch/hack/gap fields can launch a finite wave or start/update controller MULTI. Quick Controls has Multi. Activity shows active targets and timing progress. All normal and hero cards are collapsible with React-local state; callbacks remain Netscript-free. Stale Port 16 pipeline state is freshness-gated.

The current dashboard is intentionally scheduled for a parity-first modular refactor. Port 18 already exposes the telemetry required for a Targets-tab preparation card showing servers below full money, their percentage, current prep state, and ETA.

## Current limitations / next sequence

```text
1. Modularize ui/dashboard.js with strict feature parity and the engineering constraints above.
2. Add the Port 18 target-preparation card in the new Targets view.
3. Pull main and restart startup so prepper V2 + execution reservation support + modular GUI are live together.
4. Run diagnostics/mem-audit.js and confirm managed/unmanaged counts remain clean.
5. Runtime-test rapid tab switching, collapse controls, controller buttons, MULTI controls, and GUI refresh behavior.
6. Inspect prepper state / GUI and ps output: verify multiple reserved hosts, sensible reserved RAM, concurrent prep jobs, and ETA progress.
7. Let prepper raise prepared target count above 5.
8. Re-run stress test through depth 6; depth 5 is already proven and depth 6 was only prep-limited.
9. Improve stress BLOCKED behavior to wait on Port 18 readiness rather than relaunching every 10s.
10. Wire proven global stress depth into controller MULTI as an evidence ceiling, not a forced depth.
11. Validate repeated controller-owned MULTI waves and MULTI -> STANDBY drain.
12. Move from whole-wave repetition to rolling per-target admissions.
13. Add target-local recovery before continuous aggressive admission or same-target overlap.
```

Automatic worker watchdog remains deferred. XP scoring remains a proxy rather than exact Formula-based XP.
