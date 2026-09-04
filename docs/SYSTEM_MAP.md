# System Map

This document maps the main files to their responsibilities. It is intended to reduce rediscovery time when continuing development in a new chat.

## Entrypoints and startup

### `startup.js`

Primary user entrypoint. Opens the main GUI and starts the automation stack quietly through `kickstart.js`.

### `kickstart.js`

Bootstraps fresh runtime state after a pull/restart:

```text
planner
  ↓
deploy
  ↓
wait for economic target
  ↓
controller
```

It also restores the persisted manual money-goal lock before automated spending can begin.

## Main control plane

### `hacking/controller.js`

Persistent high-level hacking controller.

Responsibilities:

- owns the current controller target;
- applies automatic or manual target selection;
- tracks prep/hold state;
- accepts runtime commands from Port 13;
- supports `HGW` and `BATCH` execution modes;
- launches short-lived tactical analysis remotely;
- dispatches sequential HGW worker phases;
- launches the remote single-batch coordinator;
- blocks the next batch behind the post-batch strategic review barrier;
- publishes controller state on Port 1.

It should remain a coordinator, not become the home for expensive analysis.

### `hacking/refresh.js`

Persistent remote strategic refresh coordinator.

Responsibilities:

- lightweight port-tool/root checks;
- strategy refresh after standalone HACK completion;
- strategy refresh after full batch completion;
- strategy refresh after execution-pool expansion;
- economy refresh after manual money-goal changes;
- independent retry of affordable advisor-selected cloud capacity actions;
- ignores batch-associated hack completion until full batch `COMPLETE`.

## Target selection and economics

### `hacking/planner.js`

Short-lived network/target planner. Discovers the network, execution hosts, target analyses, and publishes planner state on Port 2.

### `hacking/economy-planner.js`

Short-lived progression/economy planner. Produces the selected progression goal and economy state on Port 7.

### `hacking/economy-targets.js`

Short-lived economic target/strategy selector.

Current important behavior:

- remote-only execution capacity model;
- adaptive desired-money candidates: `25/40/55/70/85/100%`;
- targets with max money at or below `$5,000,000` are forced to 100%;
- long prep receives a nonlinear/exponential penalty;
- low-value filtering compares **player cash to server maximum money**, not current server money;
- selected strategy is copied into planner state for controller consumption.

### `hacking/tactical-planner.js`

Short-lived expensive per-action thread planner.

Supports forced modes used by controller lifecycle, including explicit prep/batch preparation modes so a tactical pass cannot accidentally choose HACK while batch preparation still requires GROW/WEAKEN.

## Batch system

### `hacking/batch-runner.js`

Remote one-shot synchronized HWGW coordinator.

Current milestone: **one batch at a time**, not pipelined.

Responsibilities:

- validate target readiness;
- calculate H/W1/G/W2 threads;
- calculate landing timestamps;
- reserve the **entire batch RAM requirement before launch**;
- distribute stages across remote execution hosts;
- use worker `additionalMsec` timing;
- cancel partially launched batches if a launch fails;
- publish batch state on Port 12;
- measure final money/security after all jobs exit.

Landing order:

```text
HACK
  + gap
WEAKEN_HACK
  + gap
GROW
  + gap
WEAKEN_GROW
```

Default landing gap is currently 200 ms.

**Known defect:** current security compensation can under-weaken. See `docs/HANDOFF.md` and `docs/TESTING.md` before extending batching.

## Workers

### `hacking/workers/hack.js`
### `hacking/workers/grow.js`
### `hacking/workers/weaken.js`

Minimal workers. Keep them dumb and low-RAM.

They accept timing/batch metadata so the batch coordinator can schedule synchronized landings while preserving compatibility with sequential HGW dispatch.

## Thread and execution libraries

### `lib/threads.js`

HGW tactical thread calculations. Intentionally kept out of the persistent controller because the analysis APIs are RAM-expensive.

### `lib/execution.js`

Remote execution-pool and thread-distribution utilities.

Important policy: worker execution is `REMOTE_ONLY`; home is not worker fallback capacity.

### `lib/deployment.js`

Defines files that need to be copied to remote execution hosts.

## Runtime state

### `lib/runtime-state.js`

Shared port transport for controller/planner/economy/root/cloud/batch state and the controller command queue.

See `docs/RUNTIME_STATE.md` for the port map and command contract.

### `lib/state.js`

Core target/action state structures and shared enums/constants.

### `lib/telemetry.js`

Shared telemetry helpers.

## Telemetry

### `hacking/telemetry.js`

Persistent remote telemetry collector. Tracks hack events and rolling income state.

Batch hack events include batch metadata so refresh logic can distinguish them from standalone HGW hacks.

## Progression and cloud capacity

### `lib/progression.js`

Progression advisor. Current candidate families include:

- `HOME_RAM`
- `PURCHASED_SERVER`
- `CLOUD_SERVER_UPGRADE`
- `PORT_OPENER`
- `SAVE`

The advisor selects the goal; the executor should not silently override that authority.

### `network/cloud-buy.js`

Short-lived cloud-capacity executor.

Handles both:

- `ns.cloud.purchaseServer(...)`
- `ns.cloud.upgradeServer(...)`

Important safeguards:

- reads live cash/cost immediately before spending;
- checks manual money-goal lock independently;
- publishes exact status/reason on Port 10.

### `economy/manual-goal.js`

Terminal interface for persistent manual savings target/spending lock.

The main GUI exposes equivalent controls.

## Network services

### `network/root.js`

Discovers owned port-opening tools, roots newly eligible servers, and publishes root/tool state on Port 9.

### `network/deploy.js`

Copies worker/support scripts to remote execution hosts and starts persistent remote support services.

### `network/sync.js`

Synchronizes current support/execution files after topology or capacity changes.

### `network/inspect.js`

Manual network diagnostic output.

## GUI

### `ui/dashboard.js`

Primary day-to-day control plane GUI.

Tabs:

- Overview
- Targets
- Economy
- Network
- Diagnostics

Key controls:

- choose normal HGW vs batched HWGW;
- manual prep to 100% / minimum security;
- resume automatic execution;
- manual target override;
- manual money-goal spending lock.

Important implementation rule: React callbacks must not call Netscript APIs. Callbacks only queue plain-JS actions; the main async loop performs Netscript work.

### `ui/stocks.js`

Separate stock GUI placeholder/subsystem. It is intentionally independent of the main HGW control plane.

### `stocks/terminal.js`

Separate stock terminal subsystem placeholder. Do not auto-start it with the main hacking stack unless the architecture is deliberately changed.

## Diagnostics

### `diagnostics/mem-audit.js`

Measures RAM usage of managed scripts. Use after significant controller/GUI/service changes rather than guessing RAM cost.

### `diagnostics/economy-targets.js`

Detailed target/economic selection diagnostics.

### `diagnostics/income.js`

Income telemetry report.

### `diagnostics/progression.js`

Progression advisor diagnostics.

### `diagnostics/dashboard.js`

Keep this focused on live function tests, not as a giant duplicate status dashboard.

### `diagnostics/test-launcher.js`

Remote low-RAM launcher for GUI-triggered manual tests. This exists so GUI buttons do not need direct high-RAM `ns.run` usage.

## Updater

### `gitpull.js`
### `gitpull-self-update.js`

Pull repository-managed files into Bitburner.

After code changes that affect remotely executed scripts, use the normal pull/restart/deploy flow so remote hosts do not retain stale copies.

## Design boundaries to preserve

Avoid collapsing these responsibilities together:

```text
planner != controller
controller != scheduler math
GUI != hacking logic
advisor != spender
telemetry != decision logic
workers != strategy
```

The project is expected to grow into pipelined/multi-target scheduling, so keeping these boundaries clean now is intentional.
