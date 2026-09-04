# Architecture

## Core principle

Game logic and presentation stay separate. The dashboard consumes structured state; it does not decide what HGW should do. Expensive analysis and topology work should run remotely and only when useful, keeping the persistent home control path small.

## Target lifecycle

A target can move through states such as:

```text
DISCOVERED
  -> BLOCKED / ELIGIBLE
  -> SECURITY_PREP
  -> MONEY_PREP
  -> READY
  -> PRODUCTION
```

A completed `HACK` is also a strategic checkpoint. After that production action finishes, the system can reconsider the target using fresh network, RAM, progression, and economic state before committing to the next cycle.

Later, `PRODUCTION` can include timed HWGW batching without changing the surrounding state model.

## Event-driven network and planner refresh

The heavy target/RAM planner is deliberately not a periodic timer task. Normal operation uses two event classes:

- **HACK completion:** run the full planner, progression/economy refresh, and economic target selector.
- **Root-pool expansion:** when a lightweight rooting pass gains new servers, run the full planner immediately, sync runtime files to the new hosts, then recalculate economy and target priority.

A lightweight rooting pass runs remotely every 30 seconds. It discovers the network, checks which port-opening programs exist on home, opens the available ports, and NUKEs any server whose port requirement is currently satisfied. Rooting does not depend on hacking level.

The rooting result is published on Port 9. If no new server was rooted, no heavy planner run is triggered. This separates cheap capability detection from expensive strategic analysis.

Newly rooted RAM hosts are brought into service by a short-lived remote sync task rather than rerunning the startup deploy script on home. The planner first refreshes `executionHosts`, then the sync task copies the common runtime file set to hosts that are missing the execution probe files.

## Strategy tuning

The target analyzer should compare candidate strategies instead of relying on one permanent money threshold or hack percentage. Candidate inputs include:

- desired money level before hacking
- fraction of available money to hack
- desired security level
- hack/grow/weaken thread requirements
- current distributed thread capacity
- number of required worker waves
- recovery grow cost
- security recovery cost
- operation duration
- RAM-time cost
- expected money per second
- expected money per second per GB
- progression-goal ETA

Current economic selection measures live distributed thread capacity host-by-host, estimates prep and recovery in waves, and exponentially penalizes long preparation commitments. The next strategy step is to evaluate several desired money percentages instead of assuming 100% preparation is always correct.

Early-game optimization can favor fast cash realization and RAM efficiency. With abundant RAM, the optimizer can shift toward absolute throughput. The optimizer should eventually consider the entire RAM pool so multiple smaller targets can beat one individually stronger but RAM-expensive target.

## Runtime state and telemetry

All important controller decisions should be representable as structured data. Current state channels include controller, planner, tactical plan, economy, economic target, telemetry, diagnostic requests, and root/tool discovery.

The shared state should continue to expose or grow toward:

- active targets and lifecycle phase
- current/max/desired money
- current/minimum/desired security
- selected strategy and alternatives
- hack/grow/weaken thread requirements
- queued/running operations and progress
- usable/committed/free RAM
- available port-opening tools and newly rooted hosts
- money earned by HGW and income rate
- predicted versus actual cycle performance
- reasons for controller decisions
- warnings/errors and a small event history

The initial state modules are deliberately small, but their contracts should grow rather than be replaced.

## Persistent dashboard

The planned dashboard is one persistent window. It should eventually include:

- HGW totals and income rate
- RAM pool usage
- active target count
- per-target phase, money %, security delta, current action and progress
- selected strategy
- predicted versus actual performance
- strategy alternatives/tuning information
- important recent events
- one prominent next suggested player action plus lower-priority guidance

Detailed one-off reports remain diagnostics rather than being folded into the dashboard.

## Guidance engine

Guidance is separate from HGW decision-making. It evaluates blockers and upgrade opportunities, then explains both the recommendation and its expected impact.

Possible recommendations include:

- acquire a missing port-opening program
- gain hacking levels to unlock a valuable target
- upgrade home RAM
- buy or upgrade a purchased server
- save money when no current purchase is worthwhile
- transition to a more advanced HGW strategy when resources justify it

Where practical, upgrade recommendations should compare expected HGW benefit against cost rather than merely noticing that an upgrade exists. Home RAM must be considered alongside purchased-server options.

## Development stages

### Stage 1 — foundation

- minimal HGW workers
- shared state contract
- simple controller
- basic target state/preparation

### Stage 2 — network and resources

- recursive discovery
- automatic rooting/capability checks
- event-driven planner refresh
- RAM pool discovery
- startup deployment plus lightweight new-host sync

### Stage 3 — adaptive strategy

- capacity-aware thread calculations
- candidate strategy scoring
- partial-money target evaluation
- RAM-efficiency versus throughput objectives
- multiple-target resource allocation

### Stage 4 — dashboard and guidance

- persistent dashboard
- telemetry and progress
- progression recommendations
- actual versus predicted metrics

### Stage 5 — batching

- timed HWGW batches
- timing/drift monitoring
- batch health in dashboard
- optimizer improvements
