# GUI Architecture

The main dashboard is intentionally modular. `ui/dashboard.js` is only the shell and async bridge; feature logic lives in focused modules.

## Module layout

```text
ui/
  dashboard.js              shell, tabs, header, async loop
  state.js                  cached snapshot + version counter
  actions.js                plain-JS request model + Netscript action processor
  styles.js                 shared style object
  components/
    format.js               display formatting helpers
    layout.js               cards, hero metrics, buttons, grids, badges
  views/
    overview.js
    targets.js
    economy.js
    batch.js
    network.js
    diagnostics.js
```

## Core safety rule

React callbacks must remain Netscript-free.

```text
async Netscript loop
    -> reads ports/files/process state
    -> refreshes cached plain-JS snapshot
    -> executes queued plain-JS requests

React tree
    -> mounted once
    -> reads cached plain-JS state
    -> owns tab/collapse local state
    -> only queues plain-JS requests
```

This separation exists because earlier direct Netscript interaction from React callbacks caused unstable tab switching and could terminate the dashboard process.

## Refresh model

- state snapshots refresh every 1 second
- the React bridge checks the JS version counter every 100 ms
- the async loop ticks every 25 ms for queued actions
- tab switching and collapse controls remain React-local and do not wait for Netscript

## Views and feature parity

The refactor preserves the pre-refactor feature set:

```text
Overview     hero metrics, quick mode controls, target/economy health, active workers
Targets      manual override, selected strategy, top rankings, prep-progress card
Economy      manual savings goal, cloud/progression state
Batch        MULTI controls/activity, pipeline state, serialized batch, completion timing
Network      discovered/rooted/execution-host state
Diagnostics  health, tests, commands, state ages, safety notes
```

All normal cards and hero metrics remain collapsible.

## Prep-progress card

The Targets view consumes fresh Port 18 `DISTRIBUTED_TARGET_PREPPER_V2` state. The card shows tracked servers below max money with:

```text
hostname
money percentage
current/queued GROW or WEAKEN state
ETA to 100% money (estimate)
active reserved host or security delta
```

It also shows prepared-target count, active prep count, reserved prep RAM, and reserved host count.

The ETA is advisory. It is derived by the prepper from current grow/weaken timings, queue position, and reserved prep-host capacity; target state or competing work can change it.

## Maintainability guardrails

Follow the engineering constraints in `docs/HANDOFF.md`: prefer focused modules, normally keep files below ~300 lines, review files around ~400 lines for decomposition, and avoid growing `ui/dashboard.js` back into a feature monolith.
