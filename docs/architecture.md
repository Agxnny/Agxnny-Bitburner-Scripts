# Architecture

## Source of truth

GitHub `main` is the source of truth. Read `HANDOFF.md` for active work and `FEATURES.md` for implemented behavior, then fetch current files before editing.

## Control plane vs execution plane

Home is the control/UI plane. Rooted, purchased, and cloud servers form the remote execution plane. Normal H/G/W workers remain remote; home coordinates planning, state, GUIs, schedulers, and validation.

```text
home
├─ Control Plane GUI
├─ stock Market Lab
├─ controller / planners / prepper
├─ synchronized coordinators
└─ runtime ports + durable evidence
        │
        ▼
remote execution pool
└─ minimal hack / grow / weaken workers
```

The persistent controller should orchestrate rather than absorb expensive analysis. Tactical/thread math and specialized planning remain in focused modules.

## Startup

```text
startup.js
├─ ui/dashboard-launcher.js
│  ├─ ui/dashboard.js
│  └─ stocks/dashboard.js
└─ kickstart.js
   ├─ restore manual savings lock
   ├─ planner
   ├─ deployment
   ├─ wait for economic target
   ├─ prepper + batch history + stock history
   └─ controller (starts STANDBY)
```

The deferred dashboard launcher exists so startup can release its own RAM before GUI admission retries.

## Controller modes

`STANDBY | HGW | BATCH | PIPELINE | MULTI`

Mode changes are admission barriers. Existing synchronized work drains to a safe boundary before the transition is applied. The prepper is independent of production mode.

## Scheduling layers

### Sequential HGW

The controller uses short-lived tactical planning and remote workers for ordinary sequential H/G/W automation.

### Serialized batch

`hacking/batch-runner.js` reserves and launches one synchronized H → W1 → G → W2 batch. Port 12 is current serialized state.

### Single-target pipeline

`hacking/pipeline-runner.js` is the real continuous same-target executor. Live depth remains hard-capped at 2. It owns Port 14 while active, routes timing events by batch id, publishes latest completion on Port 15, and live pipeline state on Port 16.

### Real MULTI

`hacking/multi-target-runner.js` is a real finite-wave multi-target executor. It uses one shared host/time reservation calendar, JIT dispatch, central Port 14 routing, and configurable global live depth 2–12. Controller MULTI repeats finite waves.

Current production safety boundary: only distinct prepared targets are admitted, so same-target production depth remains 1 even when validation has proven a higher target-local depth.

## Two independent concurrency dimensions

The dynamic scheduler must respect both:

```text
global proof       = how many real batches/targets the whole system has safely carried
local proof        = how many overlapping batches a specific target has safely carried
```

Global evidence lives in `/data/multi-stress-evidence.txt`. Target/depth evidence lives in `/data/multi-overlap-evidence.txt`. Neither proof dimension overrides the other, and available RAM is never permission to exceed proof.

## Target-local depth learning

The depth-N validator currently uses conservative batch landing streams and records each tested depth independently. Two consecutive clean dedicated waves prove that tested depth. Higher failure preserves lower proof.

`multi-full-depth-test.js` climbs one target; `multi-full-depth-set.js` sequentially climbs every planner target already PROVEN2+. This can learn heterogeneous ceilings such as A×5, B×3, C×2.

The next safety step before production consumes those depths is target-stream trajectory/steady-state validation suitable for tighter interleaving. Per-batch "ended at full money" is not sufficient once later overlapping hacks may land before an earlier batch is finalized.

## Future dynamic MULTI allocator

The intended production scheduler ranks **batch opportunities**, not just hostnames. A target can therefore win several marginal slots when that is better than opening a weaker target.

```text
proven target profiles
        +
global concurrency proof
        +
prepared targets / shared RAM calendar
        ↓
score next batch opportunity
        ↓
compare concentrated vs distributed portfolio
        ↓
admit best safe complete batch
        ↓
continuous refill as capacity opens
```

The allocator should optimize realized/expected money rate and RAM-seconds while rejecting recovery/order/missing/drift/spacing failures.

## Prep architecture

The distributed prepper owns a bounded remote reserve and scans the full eligible target universe. It prioritizes money restoration, may concentrate multiple hosts on one target, and publishes Port 18 telemetry. Production capacity excludes fresh prep reservations.

Future validation borrowing is lower priority than real prep demand: production > actual prep > validator borrowing unused prep reserve.

## Economy/progression architecture

Economic target selection, progression advice, and spending execution are separate responsibilities. The advisor chooses the goal; the spender executes only supported selected actions and independently respects the manual savings lock.

## GUI architecture

The main GUI is a single React tree. React callbacks are Netscript-free: they only update/queue plain JavaScript requests. The async Netscript loop reads ports/files/processes and performs actions. This boundary is required for responsive/stable tab switching.

Stock research is a separate dashboard and data model so future trading logic does not bloat the hacking control plane.

## Safety invariants

- one real synchronized Port 14 consumer at a time;
- workers remain minimal and remote;
- production uses proven concurrency only;
- global and target-local proof remain separate;
- higher failed validation does not erase lower proof;
- fresh prep reservations are excluded from production;
- manual savings lock overrides automated spending;
- React callbacks never call Netscript;
- stock trading remains disabled until deliberately implemented;
- automatic worker watchdog killing remains deferred while scheduler timing is still evolving.
