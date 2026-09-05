# Documentation Index

The repository documentation is split by purpose so current state, architecture, feature descriptions, and testing do not get mixed together.

## Recommended reading order

1. [`FEATURES.md`](FEATURES.md) — readable inventory of implemented features and subsystem functions.
2. [`HANDOFF.md`](HANDOFF.md) — current development state, latest runtime evidence, immediate test, and next risky change.
3. [`architecture.md`](architecture.md) — control plane/execution plane architecture and safety boundaries.
4. [`SYSTEM_MAP.md`](SYSTEM_MAP.md) — which script/module owns each responsibility.
5. [`RUNTIME_STATE.md`](RUNTIME_STATE.md) — ports, state semantics, durable files, and controller command contract.
6. [`GUI_ARCHITECTURE.md`](GUI_ARCHITECTURE.md) — React/Netscript separation and current seven-tab layout.
7. [`BATCH_SCHEDULER.md`](BATCH_SCHEDULER.md) — synchronized batching, real MULTI, evidence dimensions, and dynamic scheduler direction.
8. [`TESTING.md`](TESTING.md) — current runtime validation procedures and regression checklist.
9. [`ROADMAP.md`](ROADMAP.md) — completed/current/next work in dependency order.

## Which document should I update?

| Change | Documents |
| --- | --- |
| User-visible feature or behavior | `FEATURES.md`, root `README.md` |
| Current work / latest runtime evidence | `HANDOFF.md` |
| Architecture or safety invariant | `architecture.md`, `SYSTEM_MAP.md` |
| Port/state/file contract | `RUNTIME_STATE.md` |
| GUI module/tab behavior | `GUI_ARCHITECTURE.md` |
| Batch/MULTI scheduling semantics | `BATCH_SCHEDULER.md` |
| Test procedure/acceptance criteria | `TESTING.md` |
| Priority/dependency change | `ROADMAP.md` |

## New-chat instruction

```text
Continue my Bitburner automation project from GitHub.
Read docs/HANDOFF.md first, then inspect the current live files before editing anything.
GitHub main is the source of truth.
Work on the highest-priority known issue documented there, and refresh the docs after major changes.
```

## Source-of-truth rule

Documentation carries project context, but current source code always wins if documentation and code disagree. Before editing an existing script, fetch the current file from GitHub `main`.

`HANDOFF.md` should stay concise enough to resume development. Long-lived explanations belong in the reference documents rather than being duplicated indefinitely in the handoff.
