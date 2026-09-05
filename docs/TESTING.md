# Testing and Validation Guide

Validate incrementally. Production MULTI is real but still uses same-target depth 1. Dedicated validators may probe higher target-local depth while the controller is fully STANDBY.

## After pulling

```text
run gitpull.js
run startup.js
```

For architecture changes also run:

```text
run diagnostics/mem-audit.js
```

`gitpull.js` should distinguish actual content changes from clean replacement:

```text
UPDATED    file.js
REPLACED   file.js (unchanged)
ADDED      file.js
STALE RM   file.js
```

Do not keep hard-coded expected managed-file counts in this guide; the manifest changes frequently during active development.

## Startup acceptance

After `startup.js`:

- main Control Plane opens;
- stock Market Lab opens;
- controller reaches STANDBY;
- planner/economic target state becomes available;
- adaptive prepper is running and Port 18 stays fresh;
- batch-history collector is running and Port 19 stays fresh;
- stock recorder is running when TIX is available;
- remote deployment is current.

If a dashboard fails to start, `ui/dashboard-launcher.js` retries and reports missing script or required/free/max home RAM. `need 0.00 GB` can indicate a parse/import failure rather than real RAM pressure; run the dashboard directly to expose the parser error.

## Prepper acceptance

Port 18 model should be `DISTRIBUTED_TARGET_PREPPER_V3_ADAPTIVE_FOCUS`.

Verify:
- `reservedHosts[]` and `reservedRamGb` are sensible;
- production execution pool excludes fresh reserved hosts;
- GROW is prioritized while money is low, then WEAKEN cleans security;
- multiple reserved hosts can work on one target when the focus plan chooses concentration;
- prepared/below-max/active counts update;
- Targets tab ETA/state rows update without terminal spam.

## Sequential HGW and serialized BATCH

HGW should execute remotely and continue to refresh tactical/economic state.

A healthy serialized batch must finish H → W1 → G → W2 with no missing timing events, money >=99.5%, security <=+0.05, max drift <=150 ms, and min spacing >=75 ms. Port 15 should receive the latest completion and Port 19 should ingest it only once.

## PIPELINE

Controller PIPELINE remains real continuous same-target depth 2.

Verify:
- Port 16 reports real execution state;
- at most two batches are in flight;
- timing events route by batch id;
- clean waves satisfy the normal recovery/timing thresholds;
- switching to STANDBY stops new admissions, drains admitted work, then exits cleanly;
- a safety failure prevents further admissions until reviewed/resumed.

## Real MULTI

Manual finite example:

```text
run hacking/multi-target-runner.js money 6 0.10 200 3
```

Manual real runs require STANDBY. Controller MULTI can also repeat finite waves from the Batch tab.

Verify:
- Port 17 model starts with `MULTI_TARGET_EXECUTOR`;
- global live count never exceeds requested cap;
- each target has at most one live production batch;
- only prepared targets are admitted;
- one Port 14 consumer routes all timing events;
- completions publish to Port 15;
- any safety failure stops the wave/controller admissions rather than silently continuing.

## Global stress validation

Example:

```text
run diagnostics/multi-target-stress.js mixed 8 2 12 0.10 200 10 resume
```

The stress test advances global distinct-target depth one level at a time, can wait for prep, and persists normal completed evidence to `/data/multi-stress-evidence.txt`.

BLOCKED/ABORTED attempts must not reduce existing proof. A higher failed depth must not erase lower proven global depth.

## Target-local overlap validation

All real overlap/depth validation requires controller mode STANDBY, no pending transition, and no active controller jobs.

### Depth-2 qualification

Use the Validation tab MIXED/ALL PREPARED flows or terminal legacy validator. Two clean dedicated waves are the normal proof requirement.

### Specific depth

```text
run diagnostics/multi-depth-validate.js phantasy 3 2 0.10 200
```

Verify timing order/events, spacing/drift, final recovery, and the matching target/depth record in `/data/multi-overlap-evidence.txt`.

### Individual full-depth climb

```text
run diagnostics/multi-full-depth-test.js phantasy 2 0.10 200
```

The climb starts above the target's current durable proven depth and proceeds through the configured ladder until failure/resource ceiling. Every successful level remains recorded.

### PROVEN2+ set climb

Preferred current runtime test is the Validation tab:

```text
Target:       PROVEN2+ SET · full-depth each
Waves/depth: 2
Hack:         10%
Stage gap:    200ms
```

Then press `FULL DEPTH · PROVEN2+ SET`.

The set snapshots current planner targets with `provenDepth >= 2` and tests them sequentially. One target's ceiling must not erase its lower proof. The set should continue to later targets unless the controller leaves STANDBY or the coordinator itself cannot launch the next child.

Do **not** manually rerun a failed higher depth before inspecting the failure; failure type is useful evidence.

## Validation evidence acceptance

For each target/depth, inspect:
- validation/clean/failed/blocked wave counts;
- `proven` and `latestHealthy`;
- consecutive clean waves;
- max observed drift;
- minimum observed spacing;
- hack fraction;
- stage gap;
- batch interval;
- last status/reason.

Expected behavior: target A can remain proven 5 while target B remains proven 2. A failed depth 6 for A must leave depth 5 intact.

## Stock Market Lab acceptance

Verify:
- recorder status online when TIX is available;
- history sample count increases only on actual price-vector changes;
- wall-clock history persists across dashboard restarts;
- 5m/15m/30m/1h/4h candles show true selected lookback windows;
- longer windows naturally display more candles under the configured bucket sizes;
- candle direction is close vs open and wick is observed high/low;
- gaps are not bridged;
- a historical gap disappears from short chart windows once it falls outside the visible range;
- HISTORY · LINE ALL retains the full recorded history;
- no stock orders are placed.

## GUI regression checklist

- all seven main tabs switch repeatedly without killing the dashboard;
- all cards/hero cards collapse/expand;
- Overview has only generic STANDBY/HGW/Resume controls;
- Batch owns MULTI controls and timing activity;
- Validation launches quiet dashboard tests and unlocks after the real process exits;
- stale validation files do not falsely report an active process;
- Diagnostics buttons launch useful tests/diagnostics;
- inactive stock timeframe buttons use black borders; selected button uses accent border.

## Safety regression checklist

- home is not normal worker fallback capacity;
- exactly one real synchronized coordinator consumes Port 14;
- prep reservations are excluded from production while fresh;
- manual savings lock blocks automated cloud spending;
- production same-target MULTI depth remains 1 until the dynamic rollout is explicitly enabled;
- global proof and target-local proof remain separate;
- failed higher validation never destroys lower proof;
- stock trading remains disabled;
- automatic watchdog termination remains deferred.
