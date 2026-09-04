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
```

This keeps GUI interaction responsive while avoiding Netscript calls directly from React handlers.

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

Target changes are applied only when current worker jobs and tactical analysis are idle. Clearing the override immediately returns the controller to the latest planner-selected automatic target.

Manual target mode currently defaults to 100% desired money and a 10% hack fraction. This intentionally separates hostname override from future manual strategy controls.

## Prep-and-hold lifecycle

Normal controller lifecycle is still security/money/production oriented. Prep mode adds an explicit batching preparation path:

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

Once prep is complete, the controller holds instead of hacking immediately. This provides a deterministic starting state for HWGW validation.

## Progression and cloud capacity

`lib/progression.js` evaluates independent progression candidates including:

```text
HOME_RAM
PURCHASED_SERVER
CLOUD_SERVER_UPGRADE
```

The selected automatic progression goal remains the spending authority. `network/cloud-buy.js` is now a cloud-capacity executor rather than a purchase-only script:

```text
PURCHASED_SERVER
    -> ns.cloud.purchaseServer()

CLOUD_SERVER_UPGRADE
    -> ns.cloud.upgradeServer()
```

The spender checks live cash/cost immediately before acting. It also independently reads Port 11; an active manual money goal blocks both purchases and upgrades even if economy state is stale.

After a successful purchase or upgrade, `hacking/refresh.js` runs planner + sync + economy refresh before final target selection so changed RAM capacity is incorporated into the remote execution pool.

The spender does not override non-cloud progression priorities. If home RAM or another future goal is selected, cloud spending remains idle and publishes a clear status reason on Port 10.

## Synchronized HWGW batch path

`hacking/batch-runner.js` executes one synchronized batch against a prepared target.

Landing order:

```text
HACK              t0
WEAKEN_HACK       t0 + gap
GROW              t0 + 2 × gap
WEAKEN_GROW       t0 + 3 × gap
```

The default gap is 200 ms. Workers accept `additionalMsec`, and the runner reserves the complete remote RAM requirement before launch.

Batch state is published on Port 12 with thread counts, landing timestamps, allocations, RAM requirements, and final recovery state.

## Strategic-review boundary

The current refresh coordinator still reacts to raw hack completion. Before automatic batching replaces sequential production, this must move to a **full batch completion acknowledgment**:

```text
batch COMPLETE
    ↓
verify money/security recovery
    ↓
strategic planner/economy review
    ↓
next batch
```

That prevents planners from inspecting a target after the hack lands but before grow/weaken recovery finishes.

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
- manual money-goal spending lock

### Stage 3 — target/control ergonomics
- adaptive economic targeting
- manual runtime target override
- prep-and-hold mode
- GUI command channel

### Stage 4 — synchronized batching
- timing-capable workers
- one-shot HWGW runner
- full-batch RAM reservation
- batch runtime state
- timing/recovery validation

### Stage 5 — automatic batching
- controller batch handoff
- strict post-batch review barrier
- drift monitoring
- adaptive landing gaps
- overlapping batches
- collision-free RAM reservation
- multi-target scheduling

### Stage 6 — future systems
- controller/dispatcher RAM split
- predicted-versus-actual calibration
- stock runtime state and independent stock GUI
