# Project Handoff Guide

GitHub `main` is the source of truth. Read this file first, then fetch current live files before editing. Target is Bitburner v3.x; live testing is v3.0.1.

## Engineering constraints: prefer modules over monoliths

Prefer small modules with narrow responsibilities that work together over large monolithic scripts.

Soft size targets:

```text
ordinary module / script        aim for <= 300 lines
review / split threshold        ~400 lines
exception threshold             >500 lines requires a clear reason
UI view module                  ideally 100-250 lines
shared UI component module      ideally 100-250 lines
entrypoint / coordinator        keep as small as practical
individual function             usually <= 40-60 lines
```

These are guardrails, not arbitrary hard failures. Split by responsibility, not merely to satisfy line count. Avoid circular imports and preserve Bitburner RAM awareness when introducing shared modules.

For GUI work specifically: React callbacks must remain Netscript-free. The async Netscript loop owns ports/files/process launches; React consumes cached plain-JS state and emits plain-JS requests.

## Current control modes

```text
STANDBY   controller parked
HGW       sequential automation
BATCH     serialized HWGW
PIPELINE  continuous single-target depth-2 HWGW
MULTI     controller-managed repeated finite multi-target waves
```

Startup defaults to STANDBY. Background prep is independent of production mode.

## Latest validated batching evidence

Real multi-target stress test `mixed 6 2 12 0.10 200 10` completed cleanly through distinct-target depth 5:

```text
depth 2: 2/2 clean
depth 3: 2/2 clean
depth 4: 2/2 clean
depth 5: 2/2 clean
worst max drift: 129 ms
worst minimum spacing: 151 ms
```

Targets exercised included `phantasy`, `silver-helix`, `joesguns`, `sigma-cosmetics`, and `omega-net`. Depth 6 did not fail; it was prep-limited because only five prepared candidates were available. Therefore global distinct-target concurrency 5 is proven clean and depth 6 remains inconclusive.

Per-target real MULTI overlap remains hard-capped at 1. Port 19 same-target history and Port 20 global distinct-target stress evidence are separate safety signals.

### Persistent stress evidence foundation

AUTOMULTI work has started with durable stress evidence rather than a UI-only preset.

```text
lib/multi-stress-evidence.js
data file: /data/multi-stress-evidence.txt
model: MULTI_STRESS_EVIDENCE_V1
```

`diagnostics/multi-target-stress.js` now records its final result into this durable evidence file. The record keeps the highest proven clean distinct-target depth, highest attempted depth, accumulated clean-wave count, observed drift/spacing extremes, unique exercised targets, last result/reason, and a failed depth when a real FAILED/SAFETY_STOP occurs. BLOCKED or ABORTED runs never reduce already-proven depth.

This is intentionally separate from transient Port 20. Port 20 remains live/current stress-run telemetry; the data file is the persistent evidence source that future AUTOMULTI decisions will consume after restarts.

Important migration note: the historical depth-5 result documented above predates this persistence helper. The new file begins empty on first pull; do not silently seed it with depth 5. Re-run controlled stress testing to establish machine-readable evidence before AUTOMULTI trusts a depth above its conservative fallback.

## Distributed target prepper V3 adaptive focus

```text
hacking/prepper.js
hacking/prepper-allocation.js
model: DISTRIBUTED_TARGET_PREPPER_V3_ADAPTIVE_FOCUS
state: Port 18
policy: ADAPTIVE_FOCUS_GROW_THEN_WEAKEN
etaModel: FULL_READY_GROW_PLUS_WEAKEN_V1
```

The prepper scans the full eligible target universe and reserves a bounded slice of remote RAM. Allocation is adaptive: `hacking/prepper-allocation.js` compares focus widths and may spread prep or concentrate multiple reserved hosts on one target.

Defaults:

```text
target refresh: 15 seconds
reserve ratio: 12.5% remote RAM
minimum reserve: 64 GB
maximum reserve: 1024 GB
money ready threshold: >=99.5%
security ready threshold: <= min +0.05
```

Prep ordering is money-first. If below the money threshold the stage is GROW even with elevated security; after money is ready, WEAKEN cleans security. One target may receive multiple jobs on different reserved hosts in the same wave, and it is not replanned until that wave drains. Production excludes fresh Port 18 reserved hosts.

`prepTargets[].etaMs` estimates full ready time: remaining active grow/weaken work plus projected future grow rounds and weaken cleanup. Queued ETA includes an advisory adaptive-focus queue delay.

## Modular dashboard architecture

```text
ui/
  dashboard.js              small shell + async loop
  state.js                  cached snapshot / version bridge
  actions.js                plain-JS request model + async action processor
  styles.js                 shared styles
  components/
    format.js               formatting helpers
    layout.js               cards, buttons, badges, grids, hero metrics
  views/
    overview.js
    targets.js
    economy.js
    batch.js
    network.js
    diagnostics.js
```

Detailed architecture notes are in `docs/GUI_ARCHITECTURE.md`.

### Readability + diagnostics refinement phase 1

Current UI includes larger typography, a Diagnostics HEALTHY/DEGRADED/SAFETY STOP/STALE verdict, real diagnostic launch buttons, tracked PID/status for direct diagnostics, and severity-aware State Ages. React callbacks remain Netscript-free.

### Overview control cleanup

Overview is a status/control summary rather than a duplicate control surface. BATCH, PIPELINE, MULTI, and manual Prep+hold launch buttons were removed there. Overview keeps Standby, HGW, and Resume safety. MULTI configuration/start remains on Batch. Backend BATCH/PIPELINE modes remain for compatibility/testing until explicitly reviewed.

### Targets prep-progress card

Targets contains `Servers below max money` using Port 18. V3 exposes multiple hosts/threads per target, but the card still shows compatibility host first. Next refinement should render `N hosts · Nt` and improve GROW/WEAKEN/READY progress presentation.

## GUI runtime model that must not regress

```text
Netscript async loop
    -> refresh snapshot about once per second
    -> process queued plain-JS actions

React tree
    -> mounted once
    -> checks a JS version counter frequently
    -> owns tabs and collapse state locally
    -> never directly calls Netscript APIs
```

The prior direct/reactive Netscript approach caused unstable tab switching and dashboard termination. Do not reintroduce Netscript calls inside React callbacks.

## Multi-target runner/controller

Current real finite executor:

```text
hacking/multi-target-runner.js
model: MULTI_TARGET_EXECUTOR_V2_CONFIGURABLE_FINITE
```

Usage:

```text
run hacking/multi-target-runner.js [money|balanced|xp] [targetCount 2-12] [hackFraction] [stageGapMs] [globalDepth 2-12]
```

Controller MULTI repeats finite waves automatically. COMPLETE re-evaluates and launches another wave; BLOCKED retries later; SAFETY_STOP halts future admissions until Resume; mode changes wait for the current finite wave to drain.

## Runtime state ports

```text
12 serialized batch
14 live worker timing events; exactly one real coordinator owns it
15 latest completed batch
16 single-target pipeline state
17 multi-target scheduler/executor state
18 adaptive distributed prepper state
19 rolling per-target safety history
20 progressive global stress-test state
```

See `docs/RUNTIME_STATE.md` for the current contract.

## Immediate validation sequence

```text
1. run gitpull.js
2. restart startup/dashboard so current modules reload
3. run diagnostics/multi-target-stress.js mixed 6 2 12 0.10 200 10 while controller is STANDBY
4. after completion, cat /data/multi-stress-evidence.txt
5. confirm provenDepth reflects the highest newly completed clean depth and BLOCKED depth does not erase it
6. continue normal GUI tab/readability/diagnostic-button validation
```

## AUTOMULTI implementation sequence

```text
DONE 1. persistent stress evidence helper + stress-run recording
NEXT 2. make stress WAITING_PREP observe Port 18 readiness instead of noisy child relaunch every 10 seconds; add resume/start-depth support
3. pure AUTOMULTI decision module: prepared targets + production RAM + target value + durable stress ceiling + timing/history evidence
4. controller AUTO state machine: ASSESS -> VALIDATE if needed -> RUN -> OBSERVE -> ADAPT
5. Batch-tab AUTOMULTI button/status; keep manual controls as Advanced/Manual
6. expose Possible / Proven / AUTO effective concurrency
7. runtime validation and conservative fallback/demotion behavior
8. later keep global distinct-target depth separate from per-target overlap depth
```

AUTOMULTI must never interpret more RAM/prepared targets as permission to exceed proven stress evidence. It may request controlled validation for a higher depth, but production stays at the last trusted ceiling until that evidence exists. XP scoring remains a proxy rather than exact Formula-based hacking XP.
