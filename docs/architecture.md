# Architecture

## Core principle

Game logic and presentation stay separate. Home is the **control plane**: orchestration, state coordination, GUI/dashboard, updater, and other lightweight persistent services belong there. Rooted and cloud servers are the **execution plane**: HGW workers and expensive short-lived analysis should run remotely whenever possible.

The dashboard consumes structured state; it does not decide what HGW should do. Expensive analysis, topology work, progression decisions, and cloud purchasing should run remotely and only when useful, keeping the persistent home control path small.

## Home/control-plane policy

`lib/execution.js` now enforces `REMOTE_ONLY` worker execution. The worker pool excludes `home` completely rather than merely reserving a few GB.

Consequences:

- `hack.js`, `grow.js`, and `weaken.js` never launch on home;
- tactical planning uses the same remote execution pool and therefore also avoids home;
- if no remote host has enough RAM, the controller waits instead of falling back to home;
- controller RAM totals represent remote execution capacity rather than mixed control + worker capacity;
- economic strategy calculations exclude home from hack/grow/weaken thread capacity so predicted waves match real dispatch behavior.

This makes home RAM available for the controller, GUI/dashboard, future scheduling services, and other orchestration features. A later controller/dispatcher split should reduce home RAM further without weakening this boundary.

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

## Event-driven network and economy refresh

The heavy target/RAM planner is deliberately not a periodic timer task. Normal operation uses meaningful event classes:

- **HACK completion:** run the full planner, progression/economy refresh, and economic strategy selector.
- **Root-pool expansion:** run the full planner, sync newly available RAM hosts, then recalculate strategy.
- **Cloud-server purchase:** purchase at most one approved server per strategic pass, then refresh planner + sync + economy before target selection finishes.
- **Manual money-goal change:** refresh only economy, purchase-lock state, and target economics; do not rerun the heavy network planner unless another event already requires it.

A lightweight rooting pass runs remotely every 30 seconds. Rooting state is published on Port 9, cloud-purchase state on Port 10, and manual money-goal state on Port 11.

## Manual money-goal safety interlock

The user can set an explicit total-cash target with `economy/manual-goal.js`. This is both an economic objective and a spending lock.

While active:

```text
manual-goal.js
    publishes target cash on Port 11
        ↓
hacking/economy-planner.js
    replaces automatic progression goal with MANUAL_MONEY
        ↓
hacking/economy-targets.js
    optimizes cash generation toward remaining manual target
        ↓
network/cloud-buy.js
    independently reads Port 11 and refuses all automated purchases
```

The purchaser checks Port 11 directly rather than trusting only Port 7. This is a deliberate safety interlock: a stale automatic `PURCHASED_SERVER` recommendation cannot spend money after the user has activated a manual savings goal.

Reaching the manual target does not clear the lock. The user must explicitly clear it before automated spending resumes. This prevents the system from reaching a savings milestone and immediately consuming those funds on an unrelated automatic purchase.

Automatic progression candidates continue to be calculated and published while the manual goal is active so the advisor remains observable without being authoritative for spending.

## Automated cloud capacity

Cloud purchasing is intentionally separated from the persistent controller. `network/cloud-buy.js` only acts when:

- no manual money goal is active;
- the selected automatic goal type is `PURCHASED_SERVER`;
- the goal is currently affordable;
- the cloud-server limit has not been reached.

Automated server names are deterministic:

```text
hgw-001
hgw-002
hgw-003
...
```

The purchaser scans existing cloud-server names and selects the first unused managed name. Existing manually named servers are not renamed. Only one purchase is allowed per strategic refresh so a large cash balance cannot trigger a same-pass purchase loop.

A successful purchase is treated as execution-pool growth. The planner refreshes `executionHosts`, then `network/sync.js` copies execution/support files onto the new server. The new server can then enter the remote-only worker pool.

Automatic cloud-server upgrades are not enabled yet; upgrade candidates remain advisory.

## Adaptive economic strategy

The economic layer selects both **server** and **desired money percentage**.

For targets large enough to justify partial prep, the selector evaluates:

```text
25%, 40%, 55%, 70%, 85%, 100%
```

Small targets at or below the current max-money floor are forced to 100% preparation. Targets can also be filtered when player cash is sufficiently large relative to the target's **maximum** money, provided another viable target remains.

Each server/percentage strategy uses live state and includes required prep/recovery threads, distributed thread capacity, worker waves, raw and exponentially weighted prep time, production cycle time, expected cash rate, and progression-goal ETA.

When a manual money goal is active, that remaining amount becomes the progression-goal distance used by the selector. This means manual savings mode changes target economics without changing the tactical execution interfaces.

Thread capacity is measured host-by-host across **remote execution hosts only** after subtracting their current used RAM. Home contributes zero worker capacity. Long prep uses a 30-minute exponential penalty.

## Strategy handoff

```text
economy-targets.js
    selects hostname + moneyTargetPercent + hackFraction
        ↓
Port 2 planner economicSelection
        ↓
controller.js on home
    adopts desired money percentage
        ↓
tactical-planner.js on remote host
    receives target, request id, hack fraction, money target
        ↓
lib/threads.js
    calculates WEAKEN / GROW / HACK requirements
        ↓
remote-only worker pool
```

## Progression-to-purchase handoff

```text
lib/progression.js
    ranks automatic progression candidates
        ↓
hacking/economy-planner.js
    automatic goal OR manual override on Port 7
        ↓
network/cloud-buy.js
    hard-checks Port 11
        ↓
    if unlocked, may buy one affordable PURCHASED_SERVER goal
        ↓
Port 10 purchase result
        ↓
hacking/refresh.js
    planner -> sync -> economy refresh
```

## Runtime state and telemetry

Current state channels include controller, planner, tactical plan, economy, economic target/strategy, telemetry, diagnostics, root/tool discovery, automated cloud-purchase state, and manual money-goal state.

The shared state should continue to expose or grow toward active targets, selected strategy, **remote worker capacity**, progression objectives, purchase outcomes, spending locks, predicted/actual performance, reasons, and warnings.

## Guidance engine

Guidance remains separate from HGW decision-making. It evaluates blockers and upgrade opportunities such as port programs, hacking level, home RAM, cloud servers, and saving. The guidance layer owns **what should be purchased**; short-lived action scripts own **how to execute an approved automated purchase**; the manual money-goal layer can temporarily revoke automatic spending authority entirely.

Home RAM and remote RAM now have distinct economic roles: home upgrades create control/UI headroom, while rooted/cloud RAM directly expands HGW execution throughput.

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
- remote-only worker RAM pool
- startup deployment plus lightweight new-host sync
- advisor-driven cloud-server purchasing
- manual money-goal spending lock

### Stage 3 — adaptive strategy

- capacity-aware thread calculations
- adaptive desired-money percentages
- exponentially weighted prep cost
- target/strategy hysteresis
- hack-fraction optimization
- predicted-versus-actual calibration
- multiple-target remote resource allocation

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
