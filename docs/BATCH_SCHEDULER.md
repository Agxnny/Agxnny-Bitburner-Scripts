# Batch Scheduler Design

## Current status

Stage 5 now has three layers:

```text
hacking/batch-scheduler.js snapshot   → one-shot capacity/cadence analysis
hacking/batch-scheduler.js admission  → persistent virtual depth-2 admission simulation
hacking/pipeline-runner.js            → opt-in REAL depth-2 execution test
```

The automatic controller still uses serialized `hacking/batch-runner.js`. The real pipeline runner is a standalone validation harness, not yet a production controller mode.

## Two independent timing controls

1. **Stage gap** — H → W1 → G → W2 spacing inside one batch.
2. **Batch interval** — H(N) → H(N+1) spacing between successive batches.

Safe internal HWGW timing does not automatically imply a sustainable or safe cross-batch cadence.

## Commands

Capacity/cadence analysis:

```text
run hacking/batch-scheduler.js <target> [hackFraction] [stageGapMs]
```

Virtual depth-2 admission simulation:

```text
run hacking/batch-scheduler.js <target> [hackFraction] [stageGapMs] admission
```

First real depth-2 test:

```text
run hacking/pipeline-runner.js <target> [hackFraction] [stageGapMs] [batchCount]
```

Recommended first run:

```text
run hacking/pipeline-runner.js phantasy 0.10 200 2
```

All three publish their latest planner/simulation/execution state to **Port 16**.

## Host-window capacity model

Every stage has:

```text
startAt = landingAt - actionDuration
endAt   = landingAt
ram     = threads × workerRam
```

The planner reserves these windows host-by-host. A stage may be split across multiple hosts. The reservation model therefore catches host fragmentation that aggregate RAM alone misses.

The planner reports both:

- **burst depth** — temporary capacity at a fast cadence;
- **sustainable interval** — the smallest cadence that can survive a full steady-state residence window.

A representative `phantasy` sample previously found 800 ms timing-only cadence but about 6280 ms RAM-sustainable cadence with the then-current pool.

## Virtual depth-2 admission simulation

Admission mode launches no workers. It keeps at most two virtual batches in flight and models:

- prepared-target opening gate;
- sustainable interval wait;
- live host-RAM admission checks;
- hard depth-2 cap;
- Port 15 safety evaluation;
- `SAFETY_STOP` with virtual drain.

It remains useful for testing planner behavior without target-side risk.

## Real depth-2 executor

`hacking/pipeline-runner.js` is the first live overlap implementation.

### Preflight gate

The runner refuses to start unless:

```text
controller target == requested target
controller prep.hold == true
controller activeJobs == 0
controller serialized batchRunning == false
target money >= 99.5%
target security <= minimum + 0.05
```

The intended workflow is to use the GUI's **Prep + hold** control, wait until the header shows `PREP HOLD`, then launch the runner manually.

Do not resume automatic HGW/BATCH while the pipeline test is active.

### Hard depth cap and waves

```text
MAX_DEPTH = 2
```

The recommended first test asks for `2` total batches. If a larger `batchCount` is supplied, execution occurs in later waves of at most two overlapping batches. A new wave is planned only after the current wave drains and the target still satisfies the prepared baseline.

### Sustainable cadence

The executor recomputes H/W1/G/W2 sizing and a conservative sustainable interval from the current remote pool before each wave. It does not assume a stale fixed cadence.

Matching Port 15 drift/spread may increase the requested 200 ms stage gap, but the real runner never reduces below the requested gap.

### Exact host reservations

Before admitting a wave, the executor reserves all future stage windows host-by-host and stores exact host/thread allocations for each `batch + stage` pair.

If a complete wave cannot be reserved, no wave starts.

### Just-in-time launch

Stages are not all launched at admission time. Each stage is dispatched shortly before its own `startAt`, using the stored reservation allocation.

The worker receives any remaining timing correction via `additionalMsec`, together with:

```text
batchId
stage
plannedLandingAt
```

This avoids wasting RAM on long sleeping worker scripts and makes actual RAM residency match the reservation model.

### Partial launch failure

If `ns.exec` fails for an allocation, already-launched jobs from that batch are cancelled, the batch is marked failed, and new wave admission stops.

This is safest before any stage lands, which is why dispatch happens around calculated starts rather than very near landing time.

### Port 14 routing

The real runner verifies serialized batching is parked, clears stale Port 14 data once, then becomes the sole Port 14 consumer for the test.

Every timing event is routed by `batchId` to the correct live batch. No per-batch queue clearing occurs while two batch IDs overlap.

This is the first real multi-batch-safe event-routing path in the project.

### Completion telemetry

Each pipeline batch publishes a Port 15-compatible completed result with:

```text
model: PIPELINE_HWGW_DEPTH2_V1
pipeline: true
landing.orderCorrect
landing.minimumSpacingMs
landing.maxAbsLandingErrorMs
landing.missingJobs
landing.stages[]
final.moneyPercent
final.securityDelta
```

The compact Batch GUI can therefore reuse the same planned-vs-actual landing graph and stage diagnostics for serialized and pipeline completions.

### Safety stop

A completed real batch stops new waves when any of these occur:

- H/W1/G/W2 actual order is incorrect;
- timing events are missing;
- final money is below 99.5%;
- final security is above +0.05.

Launch failure or a target that is no longer prepared after a wave also stops execution.

Already-launched work is allowed to drain. Automatic watchdog killing remains intentionally out of scope.

## Port ownership warning

The serialized `batch-runner.js` still clears Port 14 before its own batch. Therefore the serialized runner and the real pipeline runner must **never run concurrently**.

The standalone runner's PREP/HOLD preflight gate protects the current test workflow, but full production pipelining still requires one permanent scheduler to own Port 14 and all batch admission.

## Timing tuning

Matching completed telemetry may enforce:

```text
stageGap >= requested gap
stageGap >= maxAbsLandingError + maxAllocationSpread + 25 ms
```

Port 15 still retains only one completed batch. Automatic reduction of the requested 200 ms gap must wait for rolling history.

## Current limitations

The real runner does not yet:

- integrate as a third controller execution mode;
- keep a rolling timing-history database;
- support live depth > 2;
- perform automatic target repair/restart after a safety stop;
- replace the controller's serialized strategic-review barrier;
- prevent a user from manually resuming controller automation during a test;
- kill merely late workers.

## Validation milestones

1. Run exactly two real batches.
2. Confirm both report correct H → W1 → G → W2 order.
3. Confirm missing timing events = 0 for both.
4. Compare minimum spacing and max drift across both.
5. Confirm each batch returns money >=99.5% and security <=+0.05.
6. Repeat several two-batch tests.
7. Add rolling timing history.
8. Move Port 14 ownership/admission into the controller-integrated scheduler.
9. Add pipeline-aware review/recovery.
10. Raise live depth only after repeated depth-2 success.
