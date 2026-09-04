# Development Roadmap

This roadmap is ordered by dependency and risk, not by novelty. Correctness of the single-batch path comes before higher throughput.

## Stage A — current: single automatic HWGW correctness

Status: **in progress**.

Already implemented:

- timing-capable H/G/W workers;
- one-shot synchronized HWGW batch runner;
- whole-batch RAM pre-reservation;
- Port 12 batch state;
- controller `HGW` / `BATCH` runtime modes;
- GUI execution-mode selector;
- automatic batch foundation prep;
- full-batch strategic review barrier;
- batch-associated hack telemetry ignored until full completion;
- safety correction prep when a completed batch leaves money/security off baseline.

Current blocker:

- security compensation can be under-calculated. Latest automatic `sigma-cosmetics` batch used `25H / 1W / 298G / 1W` and ended at `+1.13` security.

Exit criteria:

- several consecutive automatic batches recover money and security without standalone correction phases;
- predicted security effects agree with observed recovery;
- batch failure states remain safe.

## Stage B — batch observability and calibration

After security math is fixed:

- publish predicted final money/security alongside actual final state;
- record per-stage predicted security contributions;
- capture planned vs actual landing timing if practical;
- expose batch health/recovery clearly in GUI;
- add batch history or rolling aggregate telemetry if useful without bloating persistent RAM;
- classify failures: target not prepared, RAM insufficient, launch failure, recovery drift, timing drift.

Goal: make batch behavior explainable before increasing concurrency.

## Stage C — adaptive timing

Current fixed landing gap: 200 ms.

Once measured drift exists:

- calculate safe minimum gap from observed timing variance;
- optionally maintain conservative per-session gap tuning;
- avoid overfitting to one target or one machine/session;
- retain a minimum safety floor.

Goal: improve throughput without sacrificing stage ordering.

## Stage D — overlapping/pipelined batches

Only start after Stages A–C are stable.

Required scheduler capabilities:

- multiple batch ids in flight;
- complete RAM reservation across all in-flight stages;
- collision-free landing slots;
- maximum safe batch depth based on RAM and weaken time;
- no strategic review after each individual batch hack;
- controlled review boundary after an appropriate production window or scheduler checkpoint;
- failure cancellation/recovery rules;
- scheduler visibility in GUI/state.

The current `batch-runner.js` is a useful correctness primitive, but a pipelined scheduler may eventually become a separate orchestration layer rather than repeatedly spawning isolated runners.

## Stage E — controller / dispatcher split

Persistent home RAM should remain small.

High-value refactor:

```text
home controller
    = target/mode/state orchestration

remote scheduler/dispatcher
    = ns.exec, RAM reservations, batch timing, worker placement
```

Benefits:

- lowers controller RAM on home;
- centralizes execution reservations;
- makes service-RAM reservation easier;
- reduces contention between HGW workers and remote control services such as refresh/cloud buyer;
- prepares architecture for pipelining and multi-target scheduling.

## Stage F — service RAM reservation

Current remote worker pool can consume most free RAM and potentially starve short-lived support services.

Add an explicit remote control-plane reserve or service host policy so these can reliably launch:

- refresh coordinator children;
- planner/economy jobs;
- cloud spender;
- diagnostics launcher;
- scheduler/batch coordinator.

This should integrate with the future dispatcher rather than become scattered per-script hacks.

## Stage G — target/strategy stability and calibration

Add:

- target-selection hysteresis;
- strategy hysteresis;
- predicted-vs-actual income calibration;
- predicted-vs-actual prep duration calibration;
- batch-specific steady-state income model rather than only sequential HGW assumptions.

Goal: prevent unnecessary target thrashing and improve economic decisions with real runtime data.

## Stage H — multi-target optimization

Long-term objective:

- evaluate multiple profitable targets;
- allocate the whole remote RAM pool across them;
- schedule independent pipelines without landing collisions;
- prioritize progression ETA / income rather than simply choosing one best hostname;
- preserve manual target mode as an explicit override.

This should be built on the dispatcher/reservation layer, not bolted directly into the current controller loop.

## Stage I — progression expansion

The advisor is intentionally structured for future goal types.

Possible future additions:

- more upgrade categories;
- richer ROI/value scoring;
- player-progression milestones;
- tool/program acquisition guidance/automation when capabilities allow;
- configurable economic priorities.

Keep the distinction:

```text
advisor selects goal
executor performs supported action
```

Do not make individual executors override advisor policy silently.

## Stage J — stock subsystem

Keep stock work separate from hacking control plane.

Future stock work:

- independent terminal strategy/reporting;
- independent stock GUI;
- structured stock runtime state;
- optional integration with global cash/progression planning only when clearly defined.

Do not auto-start unfinished stock systems with the HGW stack.

## Documentation policy

After major changes, update at least:

- `README.md`
- `docs/HANDOFF.md`
- `docs/architecture.md`
- the relevant reference document (`SYSTEM_MAP`, `RUNTIME_STATE`, `TESTING`, or this roadmap).

The purpose is to make a new chat/contributor able to recover the current architecture from the repository itself rather than relying on conversation history.
