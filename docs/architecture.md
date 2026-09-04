# Architecture

## Core principle

Game logic and presentation stay separate. Home is the **control plane**: orchestration, state coordination, GUI/dashboard, updater, and other lightweight persistent services belong there. Rooted and cloud servers are the **execution plane**: HGW workers and expensive short-lived analysis should run remotely whenever possible.

The main GUI consumes structured runtime state; it does not perform expensive target analysis or own HGW policy. That keeps visibility cheap and lets the same planner/controller state feed both diagnostics and future interfaces.

## Startup/control-plane entrypoint

`startup.js` is now the normal human-facing entrypoint:

```text
startup.js
    starts /ui/dashboard.js on home
        ↓
    spawns /kickstart.js --quiet
        ↓
planner -> deploy remote services -> economy/target ready -> controller
```

This deliberately separates startup UX from automation bootstrap internals. `kickstart.js` remains the staged engine used after clean pulls or for low-level testing, while `startup.js` is the simple day-to-day command.

## Main GUI architecture

`ui/dashboard.js` is the primary control-plane interface. It reads cached state only and currently exposes five views:

- **Overview** — live controller phase/action, target state, remote RAM, telemetry, economy, and system health.
- **Targets** — economic winner, selected money percentage, prep/ETA reasoning, rankings, and filtered targets.
- **Economy** — progression goal, manual savings lock, cloud-purchase result, and common goal commands.
- **Network** — discovered/rooted state, port tools, recent rooting result, and remote execution hosts.
- **Diagnostics** — live state health, test-request buttons via Port 6, state ages, and common diagnostic commands.

The GUI uses the same cached Ports 1/2/3/5/7/8/9/10/11 already produced by the automation stack. Interactive diagnostic buttons write requests to Port 6 rather than importing expensive test APIs into the GUI.

`diagnostics/dashboard.js` remains a focused troubleshooting panel. It is not replaced by the main GUI because diagnostics and daily operation have different presentation goals.

## Home/control-plane policy

`lib/execution.js` enforces `REMOTE_ONLY` worker execution. The worker pool excludes `home` completely rather than merely reserving a few GB.

Consequences:

- `hack.js`, `grow.js`, and `weaken.js` never launch on home;
- tactical planning uses the same remote execution pool and therefore also avoids home;
- if no remote host has enough RAM, the controller waits instead of falling back to home;
- controller RAM totals represent remote execution capacity rather than mixed control + worker capacity;
- economic strategy calculations exclude home from hack/grow/weaken thread capacity so predicted waves match real dispatch behavior.

This leaves home RAM for controller/orchestration, the GUI, updater, and future lightweight scheduling/control services. A later controller/dispatcher split should reduce persistent home RAM further.

## Target lifecycle

```text
DISCOVERED
  -> BLOCKED / ELIGIBLE
  -> SECURITY_PREP
  -> MONEY_PREP
  -> PRODUCTION
```

`MONEY_PREP` does not imply “grow to 100%.” Larger targets can use 25%, 40%, 55%, 70%, 85%, or 100% desired-money strategies, while small targets below the configured floor are forced to full preparation.

A completed `HACK` is a strategic checkpoint. The intended next hardening step is a strict post-HACK review barrier so another production action cannot begin until the strategic refresh has acknowledged the completed cycle.

## Event-driven network and economy refresh

The heavy target/RAM planner is not a periodic timer task. Important refresh events are:

- **HACK completion** — full planner, progression/economy, and target-strategy review;
- **Root-pool expansion** — planner, sync, then strategy review;
- **Cloud-server purchase** — at most one approved server per pass, then planner + sync + economy refresh;
- **Manual money-goal change** — economy/purchase-lock/target refresh without unnecessary network analysis.

A lightweight rooting pass runs remotely every 30 seconds. Rooting state is Port 9, cloud-purchase state Port 10, and manual money-goal state Port 11.

## Manual money-goal safety interlock

The user can set an explicit total-cash target with `economy/manual-goal.js`. This is both an economic objective and a spending lock.

```text
manual-goal.js -> Port 11
        ↓
economy-planner.js -> MANUAL_MONEY goal on Port 7
        ↓
economy-targets.js -> optimize toward remaining cash
        ↓
cloud-buy.js -> independently checks Port 11 and refuses purchases
```

The direct Port 11 check prevents stale progression state from spending after the user has enabled a savings goal. Reaching the target does not clear the lock automatically.

## Automated cloud capacity

`network/cloud-buy.js` acts only when no manual goal is active, the advisor-selected goal is an affordable `PURCHASED_SERVER`, and a server slot is available.

Automated names are deterministic:

```text
hgw-001
hgw-002
hgw-003
...
```

Only one purchase is allowed per strategic refresh. Successful purchases are followed by planner + sync so the new host joins the remote execution pool before final target selection.

## Adaptive economic strategy

For sufficiently large targets, the selector evaluates:

```text
25%, 40%, 55%, 70%, 85%, 100%
```

Small targets at or below the current max-money floor are forced to 100%. Targets can also be filtered when player cash is large relative to a target's **maximum** money, provided another viable target remains.

Each strategy includes prep/recovery threads, remote capacity, worker waves, raw and exponentially weighted prep time, production-cycle time, expected cash rate, and progression-goal ETA. When a manual money goal is active, its remaining amount becomes the goal distance.

## Strategy handoff

```text
economy-targets.js
    selects hostname + moneyTargetPercent + hackFraction
        ↓
Port 2 planner economicSelection
        ↓
controller.js on home
        ↓
tactical-planner.js on remote host
        ↓
lib/threads.js
        ↓
remote-only worker pool
```

## Runtime state and telemetry

The shared state model is the contract between automation and presentation. Current channels cover controller, planner, tactical plan, telemetry, economy, target strategy, rooting, cloud purchasing, manual spending lock, and diagnostic requests.

New GUI features should prefer extending structured state or low-cost command queues instead of directly importing expensive APIs into home-resident presentation scripts.

## Guidance engine

Guidance owns **what should be purchased**. Short-lived action scripts own **how to execute approved purchases**. The manual money-goal layer can revoke automatic spending authority entirely. Home RAM represents control/UI headroom; rooted/cloud RAM represents worker throughput.

## Development stages

### Stage 1 — foundation
- minimal HGW workers
- shared state contract
- controller and target lifecycle

### Stage 2 — network and resources
- recursive discovery and automatic rooting
- event-driven planner refresh
- remote-only worker RAM pool
- new-host sync
- controlled cloud-server purchasing
- manual money-goal lock

### Stage 3 — adaptive strategy
- capacity-aware targeting
- adaptive money percentages
- exponential prep cost
- strict post-HACK review barrier
- strategy hysteresis
- hack-fraction optimization
- predicted-versus-actual calibration
- multi-target resource allocation

### Stage 4 — control-plane GUI and guidance
- unified tabbed GUI
- one-command startup
- richer target/progression/network presentation
- safe GUI command channels
- progression recommendations and controlled actions
- actual-versus-predicted metrics

### Stage 5 — batching
- timed HWGW batches
- timing/drift monitoring
- batch health
- global optimizer improvements
