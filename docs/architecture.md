# Architecture

## Core principle

Game logic and presentation stay separate. Home is the **control plane**: orchestration, state coordination, GUI/dashboard, updater, and lightweight persistent services belong there. Rooted and cloud servers are the **execution plane**: HGW workers, tactical analysis, and timed batch execution should run remotely whenever possible.

The GUI consumes structured runtime state and sends lightweight command messages. It does not own expensive target analysis or worker scheduling.

## Startup/control-plane entrypoint

```text
startup.js
    starts /ui/dashboard.js on home
        ↓
    spawns /kickstart.js --quiet
        ↓
planner -> deploy remote services -> economy/target ready -> controller
```

## Home/control-plane policy

`lib/execution.js` enforces `REMOTE_ONLY` worker execution. Home is not worker capacity.

Consequences:

- hack/grow/weaken workers never launch on home;
- tactical planning and batch execution are intended for remote hosts;
- if remote capacity is unavailable, automation waits rather than consuming control/UI RAM;
- economic capacity models exclude home worker RAM.

## GUI command architecture

`ui/dashboard.js` uses React only for rendering and plain-JS request assignment inside event callbacks. Netscript APIs are executed by the dashboard's asynchronous main loop.

Port 13 is the controller command queue. Current commands include:

```text
PREP_TARGET
RESUME_AUTO
SET_MANUAL_TARGET
CLEAR_MANUAL_TARGET
SET_EXECUTION_MODE HGW|BATCH
```

The Overview tab exposes the execution selector. Mode changes wait until current tactical/worker/batch work is idle, then the controller switches without restarting the automation stack.

## Automatic vs manual target control

Automatic targeting remains planner/economy driven:

```text
economy-targets.js
    ↓
planner economicSelection / selectedTarget
    ↓
controller
```

Manual targeting is a runtime controller override:

```text
Targets GUI
    ↓ Port 13
SET_MANUAL_TARGET hostname
    ↓
controller validates hostname against planner.rankings
    ↓
manual hostname remains fixed until CLEAR_MANUAL_TARGET
```

Target changes are applied only when current worker jobs, tactical analysis, and batch work are idle. Clearing the override returns the controller to the latest planner-selected automatic target.

Manual target mode currently defaults to 100% desired money and a 10% hack fraction. This intentionally separates hostname override from future manual strategy controls.

## Prep-and-hold lifecycle

Manual prep mode adds an explicit batching preparation path:

```text
PREP_GROW
    grow continuously to ~100% money
        ↓
PREP_WEAKEN
    weaken continuously to minimum security
        ↓
PREPARED_HOLD
```

The tactical planner accepts forced prep modes so security growth during the money-fill phase does not cause normal security-first logic to alternate back and forth.

Resume releases the hold and returns to whichever execution mode is selected: normal HGW or automatic batching.

## Execution modes

### Normal HGW

The controller uses the tactical planner to perform sequential security prep, money prep, and production HACK actions.

### Automatic synchronized HWGW

Batch mode is currently **one complete synchronized batch at a time**. It intentionally does not pipeline overlapping batches yet.

The controller first ensures the target is close enough to its selected strategy baseline:

```text
security within +0.05
money >= 99.5% of selected desired-money baseline
        ↓
launch batch-runner.js remotely
```

`hacking/batch-runner.js` reserves the full worker footprint before launching any stage. If the complete batch does not fit the remote pool, no stage is launched.

Landing order:

```text
HACK              t0
WEAKEN_HACK       t0 + gap
GROW              t0 + 2 × gap
WEAKEN_GROW       t0 + 3 × gap
```

The default gap is 200 ms. Workers use `additionalMsec` so their completion times converge on the planned landing timestamps.

Batch state is published on Port 12 with thread counts, landing timestamps, allocations, RAM requirements, and final recovery state.

## Strict post-batch strategic-review boundary

Batch-internal HACK telemetry is not treated as a standalone strategic checkpoint. `hacking/refresh.js` waits for Port 12 to report the entire batch as `COMPLETE` before running the strategic chain.

The controller now enforces the other half of this boundary: when its batch runner exits successfully, it enters `BATCH_REVIEW` and refuses to launch another batch until Port 8 has a newer economic-target snapshot than the completed batch.

```text
batch COMPLETE
    ↓
controller: BATCH_REVIEW
    ↓
refresh: planner -> sync -> economy -> economic target
    ↓
Port 8 updated after batch completion
    ↓
controller releases review barrier
    ↓
next batch may launch
```

This prevents a second batch from launching using strategy state calculated before the previous batch finished recovering.

## Progression and cloud capacity

`lib/progression.js` evaluates independent progression candidates including:

```text
HOME_RAM
PURCHASED_SERVER
CLOUD_SERVER_UPGRADE
```

The selected automatic progression goal remains the spending authority. `network/cloud-buy.js` is a cloud-capacity executor:

```text
PURCHASED_SERVER
    -> ns.cloud.purchaseServer()

CLOUD_SERVER_UPGRADE
    -> ns.cloud.upgradeServer()
```

The spender checks live cash/cost immediately before acting. It also independently reads Port 11; an active manual money goal blocks both purchases and upgrades even if economy state is stale.

### Independent cloud-capacity retry loop

Cloud spending is intentionally decoupled from HACK completion. `hacking/refresh.js` checks the current cached economy goal every 5 seconds. If the selected goal is `PURCHASED_SERVER` or `CLOUD_SERVER_UPGRADE`, no manual money lock is active, and live home cash has reached the cached goal cost, the coordinator retries `network/cloud-buy.js`.

```text
cached cloud goal
    + live cash >= goal cost
        ↓
cloud-buy.js retry
        ↓
capacity changed?
    no  -> return to lightweight loop
    yes -> planner -> sync -> economy -> economic target
```

This means long prep phases and batch execution do not need a raw standalone HACK completion just to execute an already-approved RAM purchase or upgrade.

The expensive planner/economy/target analysis is not run on each 5-second check. It is triggered after the capacity action actually succeeds, or by strategic events such as standalone HACK completion, full batch completion, root expansion, and manual-goal changes.

The spender does not override non-cloud progression priorities. If home RAM or another future goal is selected, cloud spending remains idle and publishes a clear status reason on Port 10.

## Runtime ports

| Port | Purpose |
| --- | --- |
| 1 | controller snapshot |
| 2 | planner / selected strategy |
| 3 | tactical plan |
| 4 | hack completion event queue |
| 5 | income telemetry |
| 6 | diagnostic request queue |
| 7 | progression/economy state |
| 8 | economic target state |
| 9 | root/tool state |
| 10 | cloud capacity automation state |
| 11 | manual money goal / spending lock |
| 12 | synchronized batch state |
| 13 | controller command queue |

## Development stages

### Stage 1 — foundation
- minimal HGW workers
- shared state contract
- controller and target lifecycle

### Stage 2 — network/resources
- recursive discovery and rooting
- remote-only execution pool
- host synchronization
- progression advisor
- cloud purchases and upgrades
- independent affordable cloud-capacity retries
- manual money-goal spending lock

### Stage 3 — target/control ergonomics
- adaptive economic targeting
- manual runtime target override
- prep-and-hold mode
- GUI command channel
- runtime HGW/BATCH execution selector

### Stage 4 — synchronized batching
- timing-capable workers
- one-shot HWGW runner
- full-batch RAM reservation
- batch runtime state
- timing/recovery validation
- controller automatic single-batch handoff
- strict post-batch review barrier

### Stage 5 — pipelined batching
- landing drift monitoring
- adaptive landing gaps
- overlapping batches
- collision-free RAM reservation
- batch depth / throughput tuning
- multi-target scheduling

### Stage 6 — future systems
- controller/dispatcher RAM split
- predicted-versus-actual calibration
- stock runtime state and independent stock GUI
