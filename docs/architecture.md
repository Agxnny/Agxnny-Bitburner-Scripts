# Architecture

## Core principle

Game logic and presentation stay separate. Home is the **control plane**: orchestration, state coordination, GUI/dashboard, updater, and lightweight persistent services belong there. Rooted and cloud servers are the **execution plane**: HGW workers, tactical analysis, and timed batch execution should run remotely whenever possible.

The main GUI consumes structured runtime state; it does not perform expensive target analysis or own HGW policy.

## Startup/control-plane entrypoint

`startup.js` is the normal human-facing entrypoint:

```text
startup.js
    starts /ui/dashboard.js on home
        ↓
    spawns /kickstart.js --quiet
        ↓
planner -> deploy remote services -> economy/target ready -> controller
```

Quiet mode is unconditional from `startup.js`.

## Main GUI architecture

`ui/dashboard.js` is the primary control-plane interface. Current views are **Overview, Targets, Economy, Network, and Diagnostics**. Expensive work remains outside the GUI, and interactive operations use lightweight command/state channels rather than importing costly analysis APIs into the home-resident UI.

The Overview tab can request controller prep/resume actions through Port 13. The React handlers only mutate local request variables; the dashboard's async main loop performs the Netscript port write, preserving the same callback-safety rule used for tab switching and diagnostic actions.

`diagnostics/dashboard.js` remains a separate troubleshooting surface.

## Separate stock workspace

Stock trading is intentionally separate from the HGW control plane and normal startup:

```text
stocks/terminal.js   -> future trading-engine logs / decisions / orders
ui/stocks.js         -> future portfolio / signals / risk / controls
```

## Home/control-plane policy

`lib/execution.js` enforces `REMOTE_ONLY` worker execution. Home is not a worker host.

Consequences:

- `hack.js`, `grow.js`, and `weaken.js` never launch on home;
- tactical planning and the batch runner are intended for remote hosts;
- if remote capacity is unavailable, production waits rather than consuming control/UI RAM;
- economic capacity models exclude home worker RAM.

## Target lifecycle

```text
DISCOVERED
  -> BLOCKED / ELIGIBLE
  -> SECURITY_PREP
  -> MONEY_PREP
  -> PRODUCTION
```

Larger targets can use 25%, 40%, 55%, 70%, 85%, or 100% desired-money strategies, while small targets below the configured floor are forced to full preparation.

## Sequential production path

The current automatic controller still uses the existing sequential tactical path while the batch path is validated:

```text
controller
    ↓
tactical-planner.js
    ↓
WEAKEN or GROW or HACK
    ↓
wait for completion
```

This remains the safe fallback production mechanism.

## Manual prep-and-hold path

The controller now has an explicit prep mode requested through the GUI/controller command queue.

```text
GUI "Prep target to 100%"
        ↓ Port 13
controller enters PREP_GROW
        ↓
forced GROW tactical plans until money ≈ 100%
        ↓
controller enters PREP_WEAKEN
        ↓
forced WEAKEN tactical plans until security ≈ minimum
        ↓
PREPARED_HOLD
```

The key behavior is that **security does not interrupt the grow phase**. The normal tactical calculator remains security-first, so `tactical-planner.js` accepts an optional forced mode (`PREP_GROW` or `PREP_WEAKEN`) and replaces only the `next` action in the calculated plan. Thread analysis still runs remotely through the existing calculator.

This allows a target to fill to 100% in one continuous grow phase, even though growth increases security, and then clean up security afterward without grow/weaken oscillation.

When prep is complete, the controller intentionally holds the target instead of immediately resuming hacking. This is useful for manual HWGW validation because the target remains at approximately 100% money and minimum security until the GUI sends `RESUME_AUTO`.

If prep is requested while a worker action is already in flight, that action is allowed to finish. Any stale tactical request id is invalidated, and the next tactical calculation uses the prep mode.

## Synchronized HWGW batch path

The first batching milestone is `hacking/batch-runner.js`. It executes exactly one full batch against an already prepared target.

Landing order:

```text
HACK              t0
WEAKEN_HACK       t0 + gap
GROW              t0 + 2 × gap
WEAKEN_GROW       t0 + 3 × gap
```

The default gap is **200 ms**.

All four action families are launched before the first effect lands. Each worker receives an `additionalMsec` value and passes it to the v3 HGW API. This is preferable to sleeping before calling `hack`, `grow`, or `weaken` because the action duration is established immediately and the game itself owns the added wait.

The runner calculates:

- requested hack fraction and actual integer-thread fraction;
- grow recovery multiplier from the actual hack fraction;
- hack-security compensation weaken threads;
- grow-security compensation weaken threads;
- hack/grow/weaken base action times;
- absolute landing timestamps for all four stages;
- full remote-host RAM reservation before launch.

The batch is rejected unless the target is already close to minimum security and at the selected desired-money level. Prep-and-hold mode provides the conservative 100% / minimum-security starting state for current manual batch tests.

### Full-batch RAM reservation

A batch must be all-or-nothing. Before launching, the runner simulates allocations across the current remote pool. The largest RAM stages are reserved first to reduce fragmentation risk.

If any stage cannot fit, batch state becomes `BLOCKED` and **nothing launches**.

If an unexpected `ns.exec` failure happens after launch begins, all already-started allocations from that batch are killed and state becomes `LAUNCH_FAILED`. This is intentionally conservative: a partial HWGW batch can leave the target in a badly desynchronized state.

### Timed worker interface

Workers remain backward compatible with sequential execution. Their argument shape reserves:

```text
arg[0] target
arg[1] job id
arg[2] local allocation thread count
arg[3] optional additionalMsec
arg[4] optional batch id
arg[5] optional batch stage
```

`hack.js` includes batch metadata in telemetry events. Grow/weaken currently only need the timing value.

### Batch runtime state

Port 12 stores the latest synchronized batch snapshot. Expected states include:

```text
PLANNING
BLOCKED
READY
RUNNING
LAUNCH_FAILED
COMPLETE
```

The snapshot includes thread counts, actual hack fraction, timing window, per-stage landing timestamps, remote allocations, total RAM, runner host, and final target money/security when complete.

This is the contract the GUI and controller can consume next without importing batch-analysis APIs into home.

## Why one batch first

A synchronized one-shot batch already removes the large inefficiency of waiting for H, then W, then G, then W serially. However, it is deliberately not yet a pipeline.

Before overlapping multiple batches, we need to validate:

- actual landing order;
- timing drift between remote hosts;
- money recovery accuracy;
- security recovery accuracy;
- safe gap size;
- planner/refresh interactions around batch completion.

Only after those are stable should the scheduler allow multiple batches in flight.

## Event-driven network and economy refresh

The heavy target/RAM planner remains event-driven. Current strategic events include HACK completion, root-pool expansion, cloud purchase, and manual money-goal changes.

For the final automatic batching architecture, strategic review should move from raw hack completion to **completed batch/cycle acknowledgement** so the economy planner does not inspect a target halfway through its recovery stages. This is an important integration step before automatic batching replaces sequential production.

## Manual money-goal safety interlock

The user can set an explicit total-cash target with `economy/manual-goal.js` or the GUI. While active it becomes the economic objective and independently blocks automatic cloud purchasing.

## Automated cloud capacity

`network/cloud-buy.js` can buy one advisor-approved server per strategic refresh using deterministic names `hgw-001`, `hgw-002`, ... . Successful purchases are followed by planner + sync so the server joins the remote execution pool.

## Adaptive economic strategy

For sufficiently large targets the economic selector evaluates:

```text
25%, 40%, 55%, 70%, 85%, 100%
```

Economic estimates use remote-only capacity. The batch runner receives the chosen desired-money percentage and hack fraction explicitly, so later controller integration can preserve economic strategy decisions.

## Runtime state

Current channels include controller, planner, tactical plan, telemetry, economy, target strategy, rooting, cloud purchasing, manual spending lock, diagnostics, synchronized batch state on Port 12, and controller commands on Port 13.

Port 13 is a queue rather than a latest-value snapshot. Current commands are:

```text
PREP_TARGET
RESUME_AUTO
```

The shared state model remains the contract between automation and presentation.

## Development stages

### Stage 1 — foundation
- minimal HGW workers
- shared state contract
- controller and target lifecycle

### Stage 2 — network and resources
- recursive discovery and automatic rooting
- event-driven planner refresh
- remote-only worker pool
- new-host sync
- controlled cloud-server purchasing
- manual money-goal lock

### Stage 3 — adaptive strategy
- capacity-aware targeting
- adaptive money percentages
- exponential prep cost
- target hysteresis
- hack-fraction optimization
- predicted-versus-actual calibration

### Stage 4 — control-plane GUI
- unified GUI
- one-command quiet startup
- safe GUI command channels
- prep-and-hold controls
- progression/network/economy visibility

### Stage 5 — synchronized batching
- timing-capable workers using `additionalMsec`
- one-shot remote HWGW batch runner
- full-batch RAM reservation
- batch runtime state
- timing/recovery validation

### Stage 6 — automatic/pipelined batching
- controller batch handoff
- strict post-batch strategic review barrier
- drift monitoring
- adaptive landing gaps
- multiple overlapping batches
- collision-free RAM reservation
- multi-target global scheduling

### Stage 7 — stock subsystem
- dedicated stock runtime state
- independent stock terminal and GUI
- risk controls and trading execution
