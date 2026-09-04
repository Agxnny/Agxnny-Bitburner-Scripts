# Architecture

## Core principle

Game logic and presentation stay separate. The dashboard consumes structured state; it does not decide what HGW should do. Expensive analysis and topology work should run remotely and only when useful, keeping the persistent home control path small.

## Target lifecycle

A target can move through:

```text
DISCOVERED
  -> BLOCKED / ELIGIBLE
  -> SECURITY_PREP
  -> MONEY_PREP
  -> PRODUCTION
```

`MONEY_PREP` no longer implies “grow to 100%.” The desired money level is a selected strategy input. A target may therefore become production-ready at 25%, 40%, 55%, 70%, 85%, or 100% of max money depending on current economics.

A completed `HACK` is a strategic checkpoint. After production completes, the system can reconsider network, RAM, progression, target, and desired-money strategy before settling into another cycle.

Later, `PRODUCTION` can become timed HWGW batching without replacing this lifecycle contract.

## Event-driven network and planner refresh

The heavy target/RAM planner is deliberately not a periodic timer task. Normal operation uses two event classes:

- **HACK completion:** run the full planner, progression/economy refresh, and economic strategy selector.
- **Root-pool expansion:** when a lightweight rooting pass gains new servers, run the full planner immediately, sync runtime files to the new hosts, then recalculate strategy.

A lightweight rooting pass runs remotely every 30 seconds. It discovers the network, checks port-opening programs on home, opens available ports, and NUKEs servers whose port requirement is satisfied. Rooting does not depend on hacking level.

The rooting result is published on Port 9. If no new server was rooted, no heavy planner run is triggered.

## Adaptive economic strategy

The economic layer now selects both **server** and **desired money percentage**.

For every eligible server, the selector evaluates:

```text
25%, 40%, 55%, 70%, 85%, 100%
```

Each server/percentage strategy uses live state and includes:

- desired money before hacking;
- fixed current hack fraction (currently 10%);
- live current/max money;
- live current/minimum security;
- required security-prep weaken threads;
- grow threads needed only to reach the candidate money target;
- grow security and recovery weaken work;
- current distributed hack/grow/weaken thread capacity;
- number of required worker waves;
- raw prep time;
- exponentially weighted prep time;
- production recovery cycle time;
- expected cash per cycle;
- expected steady cash/sec;
- progression-goal ETA and weighted economic ETA.

Thread capacity is measured host-by-host after subtracting used RAM and the home reserve. This preserves fragmentation effects instead of pretending the whole RAM pool is one server.

Long prep uses a 30-minute exponential penalty. Short preparation stays close to real time, while multi-hour grow commitments become rapidly less attractive.

Each target keeps its best candidate percentage, then those best per-target strategies compete globally. The winning strategy is published through planner/economic state as `moneyTargetPercent` and `hackFraction`.

The persistent controller imports no expensive economic APIs. It reads the chosen strategy, sets its desired money level, and passes both values to the remote tactical planner. `lib/threads.js` performs the actual live thread calculation for that strategy.

## Strategy handoff

The current handoff is:

```text
economy-targets.js
    selects hostname + moneyTargetPercent + hackFraction
        ↓
Port 2 planner economicSelection
        ↓
controller.js
    adopts desired money percentage
        ↓
tactical-planner.js
    receives target, request id, hack fraction, money target
        ↓
lib/threads.js
    calculates WEAKEN / GROW / HACK requirements
```

This keeps policy selection separate from tactical execution.

## Runtime state and telemetry

Important decisions should remain representable as structured data. Current state channels include controller, planner, tactical plan, economy, economic target/strategy, telemetry, diagnostics, and root/tool discovery.

The shared state should continue to expose or grow toward:

- active targets and lifecycle phase;
- current/max/desired money;
- current/minimum/desired security;
- selected strategy and alternatives;
- hack/grow/weaken thread requirements;
- queued/running operations and progress;
- usable/committed/free RAM;
- available port-opening tools and newly rooted hosts;
- money earned by HGW and income rate;
- predicted versus actual cycle performance;
- reasons for controller decisions;
- warnings/errors and recent events.

## Persistent dashboard

The dashboard should eventually include HGW totals, RAM-pool usage, active target state, selected desired-money strategy, predicted versus actual performance, important events, and progression guidance. Detailed one-off reports remain diagnostics rather than being folded into the dashboard.

## Guidance engine

Guidance remains separate from HGW decision-making. It evaluates blockers and upgrade opportunities such as port programs, hacking level, home RAM, purchased servers, and saving. Recommendations should compare expected automation benefit against cost where practical.

## Development stages

### Stage 1 — foundation

- minimal HGW workers
- shared state contract
- simple controller
- basic target lifecycle

### Stage 2 — network and resources

- recursive discovery
- automatic rooting/capability checks
- event-driven planner refresh
- RAM pool discovery
- startup deployment plus lightweight new-host sync

### Stage 3 — adaptive strategy

- capacity-aware thread calculations
- adaptive desired-money percentages
- exponentially weighted prep cost
- target/strategy hysteresis
- hack-fraction optimization
- predicted-versus-actual calibration
- multiple-target resource allocation

### Stage 4 — dashboard and guidance

- persistent dashboard
- telemetry and progress
- progression recommendations
- actual versus predicted metrics

### Stage 5 — batching

- timed HWGW batches
- timing/drift monitoring
- batch health
- global optimizer improvements
