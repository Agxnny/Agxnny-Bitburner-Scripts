# Architecture

## Source of truth

GitHub `main` is the source of truth. Read `docs/HANDOFF.md` first, then fetch current files before editing.

## Core principle

Home is the control/UI plane. Rooted and cloud servers are the remote execution plane. The GUI consumes published state and sends commands; it does not own hacking logic. React callbacks remain Netscript-free.

## Startup and controller modes

`startup.js → dashboard → kickstart → planner/deploy/economy → controller`

The controller starts in **STANDBY**. Current modes are STANDBY, HGW, serialized BATCH, and controller-managed single-target PIPELINE. Mode changes are safe-boundary scheduling barriers.

## Single-target pipeline

`hacking/pipeline-runner.js` is the current live synchronized executor. Its coordinator runs on home; H/G/W workers run remotely. It uses just-in-time stage launches, host/time RAM reservations, one Port 14 timing-event consumer routed by `batchId`, Port 15 completion telemetry, and Port 16 live state.

Live depth remains fixed at 2 while integration is validated. Two manual `phantasy` runs completed four overlapping batches with 100% money recovery, +0.000 security, correct H → W1 → G → W2 order, and ~6262 ms cadence under the then-current pool.

## Global multi-target direction

The intended end-state is **one global scheduler**, not one independent runner per target:

```text
controller
   ↓
global scheduler on home
   ├── target context A
   ├── target context B
   └── target context C...
        ↓
shared host/time reservation calendar
        ↓
remote H/G/W workers
        ↑
central Port 14 router by target + batchId
```

Target depth will be dynamic. A high-value target may receive many concurrent batches while secondary targets still receive work when their marginal value and reservation fit justify it. RAM percentages are not permanently partitioned; every new complete batch competes for the next feasible global reservation.

## Multi-target allocator scaffold

`hacking/multi-target-scheduler.js` is the first **dry-run-only** implementation of this model. It considers several targets simultaneously and repeatedly admits the highest-value feasible virtual HWGW batch into one shared host/time calendar.

Profiles:

```text
MONEY     normalized cash efficiency per reserved RAM-time
BALANCED  70% money + 30% XP proxy
XP        action-thread/difficulty proxy per reserved RAM-time
```

A diminishing-returns fairness penalty is applied after each target admission. This intentionally allows stronger targets to receive greater depth without defaulting to total starvation of all secondary targets.

The planner also applies a global landing spacing floor between target pipelines, so cross-target events are modeled as one timing stream rather than independent clocks.

It publishes to **Port 17**, leaving Port 16 free for the active single-target pipeline. It launches no workers and does not consume Port 14.

## Future multi-target safety model

Failures should be classified as target-local versus global:

```text
target-local: bad recovery/order/prep → pause/repair that target
system-wide: reservation corruption / shared timing failure → stop global admissions
```

The first real multi-target test should remain conservative: two targets, global live depth 2, per-target depth 1. Dynamic higher per-target depth comes only after rolling timing history and shared planner/executor code are in place.

## Runtime ports

| Port | Purpose |
| --- | --- |
| 1 | controller snapshot |
| 2 | planner / selected strategy |
| 3 | tactical plan |
| 4 | hack completion event queue |
| 5 | income telemetry |
| 6 | diagnostic request queue |
| 7 | progression/economy state |
| 8 | economic target state |
| 9 | root/tool state |
| 10 | cloud capacity automation state |
| 11 | manual money goal / spending lock |
| 12 | current serialized batch state |
| 13 | controller command queue |
| 14 | batch landing-timing event queue |
| 15 | latest completed serialized/pipeline batch |
| 16 | single-target pipeline planner/simulation/executor |
| 17 | global multi-target allocation planner |

## Current limitations

- Live single-target pipeline depth is fixed at 2.
- Multi-target scheduling is planning-only.
- Port 15 is latest-only, not rolling history.
- Multi-target XP is currently a proxy metric, not exact XP.
- Batch-template/reservation math is still duplicated and should be extracted before real multi-target execution.
- Automatic worker watchdog termination remains deferred.
