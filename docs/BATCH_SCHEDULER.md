# Batch and MULTI Scheduler Design

## Current execution layers

```text
batch-runner.js             real serialized one-batch HWGW
batch-scheduler.js          single-target planner/admission simulation; no workers
pipeline-runner.js          real continuous same-target depth-2 HWGW
multi-target-scheduler.js   one-shot global planning-only allocator
multi-target-sim.js         persistent global planning-only simulation
multi-target-runner.js      real finite global MULTI executor; per-target depth 1
multi-target-stress.js      progressive global-concurrency validator
multi-depth-validate.js     real configurable target-local overlap validator
full-depth-test/set         automatic target-local depth discovery
```

Port 16 is single-target pipeline state. Port 17 is global MULTI state. Port 14 is the real synchronized worker timing queue and has exactly one consumer during a real synchronized operation.

## Timing vocabulary

```text
stage gap             H → W1 → G → W2 landing spacing inside a batch
batch interval        H(N) → H(N+1) for one target
Global landing gap    minimum spacing enforced across the shared global stream
landing drift         actual landing - planned landing
```

Current production/validation safety thresholds are money >=99.5%, security <=+0.05, max absolute drift <=150 ms, and minimum spacing >=75 ms. The common conservative starting stage gap is 200 ms.

## Shared host/time calendar

Synchronized planners reserve RAM over time, not only at launch instant. All candidate stages compete against the same host calendars. A batch is admitted only when its complete reservation fits, preventing independent target schedulers from overbooking the same remote RAM.

`lib/batch-allocation.js` is the shared template/calendar/reservation primitive used by MULTI simulation, production, and depth validation.

## Current real MULTI

`hacking/multi-target-runner.js` is no longer planning-only. It launches a finite real wave with:

- MONEY/BALANCED/XP objective profile;
- configurable top-target count;
- configurable global live depth 2–12;
- configurable hack fraction and stage gap;
- prepared targets only;
- one shared calendar and JIT stage dispatch;
- one Port 14 event consumer/router;
- Port 17 live state and Port 15 completions;
- safety stop on launch/timing/order/recovery failure.

The controller's MULTI mode repeats finite waves automatically.

**Current production limit:** `PER_TARGET_LIVE_DEPTH = 1`. Real MULTI can run several targets concurrently, but cannot yet put multiple live batches on the same target.

## Global concurrency evidence

`diagnostics/multi-target-stress.js` progressively tests distinct-target global live depth. It is prep-aware and can resume above durable proof. Completed evidence is stored separately in `/data/multi-stress-evidence.txt`.

A blocked/prep-limited attempt is neutral. Global proof is not target-local overlap proof.

## Target-local overlap evidence

`/data/multi-overlap-evidence.txt` stores independent records for every target/depth tested by dedicated validators. Two consecutive clean waves prove a depth. A failed higher depth preserves lower proven levels.

The configured depth ladder is:

```text
2 3 4 5 6 7 8 9 10 11 12
```

Candidate tuning values currently exposed for future optimization are hack fractions 5/7.5/10/12.5/15/20% and stage gaps 100/125/150/175/200/250 ms.

`multi-full-depth-test.js` climbs one target. `multi-full-depth-set.js` sequentially climbs all current planner targets already PROVEN2+ so evidence can become heterogeneous, e.g. A×5, B×3, C×2.

## Why validation depth is not production depth yet

The current depth-N validator deliberately uses conservative non-crossing batch landing streams and checks final stream recovery. That is appropriate for proving the allocator/timing foundation, but tighter deep production overlap changes the meaning of per-batch final state: a later batch may hack before an earlier batch is finalized.

Before production consumes depth >1, validation must check the **target stream/trajectory** rather than assume every individual batch should finish at 100% money in isolation.

## Dynamic production target

The end-state should rank marginal batch opportunities rather than assign one fixed depth to every target.

Example candidate ordering:

```text
phantasy batch #1
phantasy batch #2
silver-helix batch #1
phantasy batch #3
omega-net batch #1
...
```

Every opportunity must satisfy:

```text
target-local proven depth/profile
AND global proven concurrency
AND prepared target state
AND complete shared-calendar reservation
AND timing/recovery safety
```

The allocator should explicitly compare concentrated and distributed portfolios:

```text
SINGLE HEAVY   one premium target at deeper proven overlap
DUAL           two strong targets at moderate depth
DISTRIBUTED    several targets at shallow/moderate depth
```

Selection should use expected/realized $/sec and $/RAM-second plus timing/recovery risk. More RAM is not permission to exceed evidence.

## AUTOMULTI relationship

The existing AUTOMULTI decision/supervisor chooses safe global configurations and can request global stress validation. After the heterogeneous allocator is proven, AUTOMULTI should consume target-local proven profiles and become the supervisory policy above the continuous global scheduler rather than duplicating scheduler mechanics.

## Next scheduler work

1. Runtime-prove individual and PROVEN2+ full-depth validation across representative targets.
2. Add target-stream trajectory/steady-state recovery validation.
3. Make production MULTI consume target-local proven depths.
4. Rank marginal batch opportunities and compare concentrated/distributed portfolios.
5. Tune hack fraction/timing with bounded experiments and failure cooldown.
6. Move from finite waves toward continuous refill.
7. Borrow genuinely idle prep reserve for low-priority automatic validation, yielding admission when prep demand returns.

Automatic worker watchdog killing remains deferred until the deeper timing model is stable.
