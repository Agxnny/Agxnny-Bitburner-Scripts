# Runtime State and Command Contract

The project uses Netscript ports as lightweight shared transport between persistent and short-lived services.

`lib/runtime-state.js` is the implementation source of truth. This document explains intended semantics.

## Port map

| Port | Name | Semantics |
| --- | --- | --- |
| 1 | Controller state | Latest-value snapshot |
| 2 | Planner state | Latest-value snapshot |
| 3 | Tactical plan state | Latest-value snapshot |
| 4 | Hack event queue | Event queue |
| 5 | Income telemetry | Latest-value snapshot |
| 6 | Diagnostic request queue | Event queue |
| 7 | Economy/progression state | Latest-value snapshot |
| 8 | Economic target state | Latest-value snapshot |
| 9 | Root/tool state | Latest-value snapshot |
| 10 | Cloud capacity action state | Latest-value snapshot |
| 11 | Manual money-goal state | Latest-value snapshot |
| 12 | Batch state | Latest-value snapshot |
| 13 | Controller requests | Event queue |

Snapshot writers replace the prior value. Port 13 is intentionally consumed as a queue.

## Port 1 — controller state

Published by `hacking/controller.js`.

Important top-level concepts include:

- current target hostname;
- target phase/action;
- observed money/security;
- current strategy values;
- tactical status;
- execution-pool summary;
- prep state;
- manual target state;
- execution mode state.

### `executionMode`

Current fields include concepts equivalent to:

```text
mode: HGW | BATCH
pending: requested mode change, if any
batchGapMs: current synchronized landing gap
batchRunning: whether batch coordinator is active
batchRunnerHost: remote coordinator host
awaitingReview: strict post-batch review barrier
batchCompletedAt: completed batch timestamp used by barrier
lastBatchId: latest completed batch id
lastMessage: user-facing controller explanation
```

The exact object may evolve; read the current controller code before depending on an individual field.

### `targetControl`

Tracks automatic/manual target selection and pending target commands.

### `prep`

Tracks explicit manual prep/hold mode:

```text
GROW → WEAKEN → READY/HOLD
```

Manual prep is separate from automatic batch foundation prep.

## Port 2 — planner state

Published by the network/target planner and augmented by economic selection.

Important data:

- analyzed/ranked targets;
- selected target;
- execution hosts;
- worker RAM information;
- network/root capability summary;
- `economicSelection` with selected desired-money percentage and hack fraction.

Do not assume Port 2 is fresh just because the controller is fresh. Planner refresh is deliberately event-driven.

## Port 3 — tactical plan

Published by `hacking/tactical-planner.js`.

Includes:

- target hostname;
- controller request id;
- requested action;
- calculated threads;
- timing/security/money analysis;
- planner host;
- optional forced tactical mode.

Controller request ids are used to reject stale tactical snapshots.

## Ports 4 and 5 — hack events and income telemetry

Hack workers/telemetry attach batch metadata where applicable.

This distinction is important:

```text
standalone HGW HACK completion
    → may trigger strategic review

batch-associated HACK completion
    → must NOT trigger strategic review yet
    → wait for Port 12 full batch COMPLETE
```

## Port 7 — economy/progression state

Published by `hacking/economy-planner.js`.

Includes player cash, selected progression goal, readiness/remaining cost, and advisor context.

The current progression goal is the authority for automatic cloud spending.

## Port 8 — economic target state

Published by `hacking/economy-targets.js`.

Contains:

- selected target/strategy;
- ranked alternatives;
- prep estimates;
- cash-relative filtering decisions;
- adaptive money-target alternatives;
- timestamp used by the batch controller review barrier.

The controller treats a Port 8 update newer than the completed batch timestamp as evidence that post-batch strategic review has finished.

## Port 9 — root/tool state

Published by `network/root.js`.

Contains current port-opening tool availability and newly rooted hosts.

Root expansion can trigger a heavy planner refresh because execution capacity and target access have changed.

## Port 10 — cloud capacity action state

Published by `network/cloud-buy.js`.

Conceptual fields include:

- action (`PURCHASE_SERVER`, `UPGRADE_SERVER`, `NONE`);
- status;
- hostname;
- previous/target RAM;
- cost;
- whether capacity actually changed;
- user-facing reason.

A failed attempt should publish a reason when the spender itself runs. If the spender cannot be launched due to remote RAM starvation, the refresh coordinator may only know launch failed unless more explicit coordinator state is added later.

## Port 11 — manual money-goal state

Manual savings goal / spending lock.

Important invariant:

**When active, automatic cloud purchases/upgrades are blocked.**

The spender checks this state directly instead of trusting only the economy snapshot.

The goal is also persisted to `/data/manual-money-goal.txt` so it survives restart.

## Port 12 — batch state

Published by `hacking/batch-runner.js`.

Typical status lifecycle:

```text
PLANNING
  ↓
BLOCKED             (target/RAM/math not ready)

or

READY
  ↓
RUNNING
  ↓
COMPLETE
```

Failure state also includes `LAUNCH_FAILED` if a stage cannot launch after reservation/startup; already launched jobs are cancelled.

Useful batch fields include:

- `batchId`;
- target;
- status/reason;
- requested/actual hack fraction;
- gap;
- H/W1/G/W2 thread counts;
- stage allocations;
- landing timestamps;
- total batch RAM;
- final money/security state after all jobs finish.

Port 12 is currently a latest-value snapshot, not a historical batch log.

## Port 13 — controller command queue

Used by the GUI and other lightweight control surfaces.

Current commands:

### `PREP_TARGET`

Request manual full prep of current target:

```text
100% money
  ↓
minimum security
  ↓
hold
```

Optional target field is validated against current controller target to avoid applying a stale GUI request after a target switch.

### `RESUME_AUTO`

Exit manual prep/hold and resume whichever execution mode is active.

### `SET_MANUAL_TARGET`

Queue a runtime manual target override.

Controller validates the requested hostname against current eligible planner rankings and applies the switch only when current tactical/worker/batch work is idle.

### `CLEAR_MANUAL_TARGET`

Return to automatic economic target selection when the controller reaches a safe switch point.

### `SET_EXECUTION_MODE`

Payload mode:

```text
HGW
BATCH
```

Mode changes wait until the controller is idle. Switching modes resets explicit manual prep state and clears stale batch-review barrier state.

## Queue design rule

GUI React callbacks should only construct/assign plain-JS request data. The dashboard main loop writes that data to Port 13.

Do not call Netscript APIs directly inside React event callbacks.

## Freshness and strategic events

Not every state is refreshed on a timer.

Heavy analysis is event-driven where possible. Important events currently include:

- startup;
- standalone HACK completion;
- full batch completion;
- root/execution-pool expansion;
- successful cloud capacity change;
- manual money-goal change.

Cloud capacity execution is a special case: an already-selected affordable cloud action is retried independently every few seconds without rerunning the full planner on every check.
