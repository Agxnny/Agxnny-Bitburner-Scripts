# Batch Scheduler Design

## Current status

`hacking/batch-scheduler.js` is still **non-executing**: it does not launch H/G/W workers and does not replace the serialized `hacking/batch-runner.js` path.

It now has two dry-run modes:

```text
snapshot   → one host-window/cadence analysis
admission  → persistent live depth-2 admission simulation
```

The purpose is to validate pipeline admission, RAM reservation, timing cadence, and safety-stop logic before any overlapping workers are allowed to execute.

## Two independent timing controls

The scheduler treats timing as two separate knobs:

1. **Stage gap** — H → W1 → G → W2 spacing inside one batch.
2. **Batch interval** — H(N) → H(N+1) spacing between successive batches.

Safe internal HWGW timing does not automatically imply a sustainable or safe cross-batch cadence.

## Commands

One-shot capacity/cadence analysis:

```text
run hacking/batch-scheduler.js <target> [hackFraction] [stageGapMs]
```

Persistent admission simulation:

```text
run hacking/batch-scheduler.js <target> [hackFraction] [stageGapMs] admission
```

Example:

```text
run hacking/batch-scheduler.js phantasy 0.10 200 admission
```

Both modes publish their latest state to **Port 16**.

## V2 host-window capacity model

The planner calculates H/W1/G/W2 sizing, action durations, per-stage RAM, a global landing calendar, timing-safe stage/batch spacing, and host-by-host RAM reservations over each stage execution window:

```text
startAt = landingAt - actionDuration
endAt   = landingAt
```

It reports both **burst depth** and a separate **sustainable batch interval**. These are intentionally different: a fast burst can fit temporarily even when that cadence cannot be maintained through the full weaken/grow residence window.

## V3 depth-2 admission simulation

Admission mode keeps running and applies the same decisions a first executable pipeline scheduler will need, but uses **virtual batches only**.

Hard rules:

- maximum simulated in-flight depth is **2**;
- no H/G/W worker is launched;
- the first admission requires a prepared baseline (`>=99.5%` money and `<=+0.05` security);
- after the pipeline opens, raw target state is not used as a per-batch gate because an active HWGW pipeline intentionally moves money/security between stage landings;
- the tuned sustainable batch interval controls when the second virtual batch may be admitted;
- current live remote RAM is checked host-by-host before each virtual admission;
- when depth 2 is reached, admissions stop until the oldest virtual batch reaches its planned W2 landing;
- recent admission/drain/stop events are retained in the Port 16 snapshot.

This models the first intended executable policy: **depth 2 only, admit conservatively, stop immediately on evidence of a bad batch, and let already-safe work drain**.

## Safety-stop simulation

While admission mode runs, it watches new matching Port 15 completed-batch telemetry. A newly observed completed batch triggers a simulated admission stop if any of these occur:

- landing order is incorrect;
- timing events are missing;
- money recovery error exceeds 0.5 percentage points;
- security recovery error exceeds 0.05;
- final money is below the prepared tolerance;
- final security is above +0.05.

A safety stop prevents new virtual admissions. Existing virtual batches remain in the simulated in-flight set until their planned W2 landing. Restart the simulator to clear the stop; there is deliberately no automatic reset yet.

## Timing tuning

If Port 15 contains a completed batch for the same target, its drift/spread telemetry is used provisionally:

```text
stageGap >= requested gap
stageGap >= maxAbsLandingError + maxAllocationSpread + 25 ms
```

The timing-only batch interval begins at least four stage gaps. The host-window steady-state search may increase that interval further when RAM cannot sustain the timing-only cadence.

Port 15 still holds only one completed batch, so tuning remains conservative. A rolling history is required before automatic gap reduction.

## Current-free-RAM rule

The scheduler uses **currently free remote RAM** as the baseline. RAM occupied by the live serialized system is excluded and is not assumed to become available later. This means admission simulation can be run safely alongside the production single-batch path, although its reported capacity will be conservative while production work is active.

## Important limitations

The scheduler still does **not**:

- launch overlapping workers;
- consume Port 14 as a multi-batch event router;
- own multiple real batch IDs;
- replace the controller's per-batch strategic-review barrier;
- perform live reservation rollback after worker launch failure;
- maintain rolling timing history;
- automatically kill late workers.

## Remaining milestones before live depth-2 execution

1. Continue collecting repeated single-batch landing/recovery samples.
2. Validate admission mode decisions while the serialized system runs.
3. Add rolling timing history.
4. Move Port 14 ownership to one multi-batch-safe consumer; do not clear the queue per batch.
5. Reuse the host-window reservation plan as the actual launch allocation.
6. Add atomic depth-2 live admission and rollback on partial launch failure.
7. Replace the per-batch strategic-review barrier with pipeline-aware review/safety-stop behavior.
8. First executable test remains hard-capped at depth 2.
9. Raise depth only after repeated depth-2 recovery and timing validation.

## Intended landing train

With a 200 ms stage gap, the timing-only pattern is:

```text
H1 → W1-1 → G1 → W2-1 → H2 → W1-2 → G2 → W2-2
     200      200     200      inter-batch safety/capacity gap
```

The actual batch interval must satisfy both timing safety and sustainable RAM capacity. On the first V2 `phantasy` test, the timing-only request was 800 ms while host-window capacity increased the sustainable interval to roughly 6.28 seconds.
