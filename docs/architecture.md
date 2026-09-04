# Architecture

## Core principle

Game logic and presentation stay separate. The dashboard will consume structured state; it will not decide what HGW should do. This lets us build the dashboard later without rewriting the hacking engine.

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

Later, `PRODUCTION` can include timed HWGW batching without changing the surrounding state model.

## Strategy tuning

The eventual analyzer should compare candidate strategies instead of relying on one permanent money threshold or hack percentage. Candidate inputs may include:

- desired money level before hacking
- fraction of available money to hack
- desired security level
- hack/grow/weaken thread requirements
- recovery grow cost
- security recovery cost
- operation duration
- RAM-time cost
- expected money per second
- expected money per second per GB

Early-game optimization can favor RAM efficiency. With abundant RAM, the optimizer can favor absolute throughput. An `AUTO` policy can eventually select between those objectives.

The optimizer should eventually consider the entire RAM pool, so multiple smaller targets can beat one individually stronger but RAM-expensive target.

## Runtime state and telemetry

All important controller decisions should be representable as structured data. The shared state should eventually expose:

- active targets and lifecycle phase
- current/max/desired money
- current/minimum/desired security
- selected strategy and alternatives
- hack/grow/weaken thread requirements
- queued/running operations and progress
- usable/committed/free RAM
- money earned by HGW and income rate
- hacking EXP earned by HGW and EXP rate
- predicted versus actual cycle performance
- reasons for controller decisions
- warnings/errors and a small event history

The initial state module is deliberately small, but its shape should grow rather than be replaced.

## Persistent dashboard

The planned dashboard is one persistent window. It should eventually include:

- HGW totals: money, money/sec, EXP, EXP/sec
- RAM pool usage
- active target count
- per-target phase, money %, security delta, current action and progress
- selected strategy (for example `85% -> hack 20%`)
- predicted versus actual performance
- strategy alternatives/tuning information
- important recent events
- one prominent next suggested player action plus lower-priority guidance

## Guidance engine

Guidance is separate from HGW decision-making. It evaluates blockers and upgrade opportunities, then explains both the recommendation and its expected impact.

Possible recommendations include:

- acquire a missing port-opening program
- gain hacking levels to unlock a valuable target
- upgrade home RAM
- buy a purchased server
- upgrade a purchased server
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
- rooting/capability analysis
- RAM pool discovery
- worker deployment

### Stage 3 — adaptive strategy

- thread calculations
- candidate strategy scoring
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
