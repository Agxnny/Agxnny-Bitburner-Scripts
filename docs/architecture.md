# Architecture

## Core principle

Game logic and presentation stay separate. The dashboard consumes structured state; it does not decide what HGW should do. Expensive analysis, topology work, progression decisions, and cloud purchasing should run remotely and only when useful, keeping the persistent home control path small.

## Target lifecycle

A target can move through:

```text
DISCOVERED
  -> BLOCKED / ELIGIBLE
  -> SECURITY_PREP
  -> MONEY_PREP
  -> PRODUCTION
```

`MONEY_PREP` does not imply “grow to 100%.” The desired money level is a selected strategy input. Larger targets may become production-ready at 25%, 40%, 55%, 70%, 85%, or 100% of max money depending on current economics, while small targets below the configured floor are forced to full preparation.

A completed `HACK` is a strategic checkpoint. After production completes, the system can reconsider network, RAM, progression, target, and desired-money strategy before settling into another cycle.

Later, `PRODUCTION` can become timed HWGW batching without replacing this lifecycle contract.

## Event-driven network and planner refresh

The heavy target/RAM planner is deliberately not a periodic timer task. Normal operation uses meaningful event classes:

- **HACK completion:** run the full planner, progression/economy refresh, and economic strategy selector.
- **Root-pool expansion:** when a lightweight rooting pass gains new servers, run the full planner immediately, sync runtime files to the new hosts, then recalculate strategy.
- **Cloud-server purchase:** when the progression advisor selects an affordable new cloud server, purchase at most one server in that strategic pass, then immediately refresh planner + sync + economy so the new RAM is visible before target selection finishes.

A lightweight rooting pass runs remotely every 30 seconds. It discovers the network, checks port-opening programs on home, opens available ports, and NUKEs servers whose port requirement is satisfied. Rooting does not depend on hacking level.

Rooting state is published on Port 9. Automated cloud-purchase state is published on Port 10.

## Automated cloud capacity

Cloud purchasing is intentionally separated from the persistent controller. `network/cloud-buy.js` consumes the cached progression goal from Port 7 and only acts when:

- the selected goal type is `PURCHASED_SERVER`;
- the goal is currently affordable;
- the cloud-server limit has not been reached.

The RAM size comes from progression-candidate metadata rather than being inferred from a title string. Automated server names are deterministic:

```text
hgw-001
hgw-002
hgw-003
...
```

The purchaser scans existing cloud-server names and selects the first unused managed name. Existing manually named servers are not renamed. Only one purchase is allowed per strategic refresh so a large cash balance cannot trigger a same-pass purchase loop.

A successful purchase is treated as execution-pool growth. The planner refreshes `executionHosts`, then `network/sync.js` copies the common execution/support files onto the new server.

Automatic cloud-server upgrades are not enabled yet; upgrade candidates remain advisory.

## Adaptive economic strategy

The economic layer selects both **server** and **desired money percentage**.

For targets large enough to justify partial prep, the selector evaluates:

```text
25%, 40%, 55%, 70%, 85%, 100%
```

Small targets at or below the current max-money floor are forced to 100% preparation. Targets can also be filtered when player cash is sufficiently large relative to the target's **maximum** money, provided another viable target remains.

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

Each target keeps its best allowed candidate percentage, then those best per-target strategies compete globally. The winning strategy is published through planner/economic state as `moneyTargetPercent` and `hackFraction`.

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

## Progression-to-purchase handoff

```text
lib/progression.js
    ranks progression candidates
        ↓
hacking/economy-planner.js
    publishes selected goal + metadata on Port 7
        ↓
network/cloud-buy.js
    buys one affordable PURCHASED_SERVER goal
    publishes result on Port 10
        ↓
hacking/refresh.js
    planner -> sync -> economy refresh
        ↓
new server joins distributed RAM pool
```

## Runtime state and telemetry

Important decisions should remain representable as structured data. Current state channels include controller, planner, tactical plan, economy, economic target/strategy, telemetry, diagnostics, root/tool discovery, and automated cloud-purchase state.

The shared state should continue to expose or grow toward:

- active targets and lifecycle phase;
- current/max/desired money;
- current/minimum/desired security;
- selected strategy and alternatives;
- hack/grow/weaken thread requirements;
- queued/running operations and progress;
- usable/committed/free RAM;
- available port-opening tools and newly rooted hosts;
- progression goal and automated purchase outcomes;
- money earned by HGW and income rate;
- predicted versus actual cycle performance;
- reasons for controller decisions;
- warnings/errors and recent events.

## Persistent dashboard

The dashboard should eventually include HGW totals, RAM-pool usage, active target state, selected desired-money strategy, predicted versus actual performance, important events, and progression guidance. Detailed one-off reports remain diagnostics rather than being folded into the dashboard.

## Guidance engine

Guidance remains separate from HGW decision-making. It evaluates blockers and upgrade opportunities such as port programs, hacking level, home RAM, cloud servers, and saving. Recommendations should compare expected automation benefit against cost where practical.

The guidance layer owns **what should be purchased**. Short-lived action scripts own **how to execute an approved automated purchase**. This separation allows future automation for cloud upgrades or port programs without putting purchase APIs into the home controller.

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
- advisor-driven cloud-server purchasing

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
- broader controlled progression automation

### Stage 5 — batching

- timed HWGW batches
- timing/drift monitoring
- batch health
- global optimizer improvements
