# Documentation Index

Start here when continuing development in a new chat.

## Recommended reading order

1. [`HANDOFF.md`](HANDOFF.md) — current project state, latest validation, highest-priority known issue, and immediate next steps.
2. [`architecture.md`](architecture.md) — overall architecture, control/execution-plane design, and major data flows.
3. [`SYSTEM_MAP.md`](SYSTEM_MAP.md) — which script/module owns each responsibility.
4. [`RUNTIME_STATE.md`](RUNTIME_STATE.md) — port map, state semantics, and controller command contract.
5. [`TESTING.md`](TESTING.md) — validation procedures, latest observed automatic batch result, and acceptance criteria.
6. [`ROADMAP.md`](ROADMAP.md) — prioritized development stages from single-batch correctness through pipelining and multi-target scheduling.

## New-chat instruction

A useful first prompt for a new development chat is:

```text
Continue my Bitburner automation project from GitHub.
Read docs/HANDOFF.md first, then inspect the current live files before editing anything.
The GitHub main branch is the source of truth.
Work on the highest-priority known issue documented there, and refresh the docs after major changes.
```

## Documentation intent

These files are meant to carry project context that would otherwise be trapped in a long conversation history. They describe architecture and current state, but **current source code always wins if documentation and code disagree**.

Before modifying an existing script, fetch/read the current file from the repository.

## Maintenance rule

After a major architectural or behavior change, update the relevant docs before considering the change complete. In particular, keep `HANDOFF.md` current enough that a fresh chat can resume work without needing the previous conversation transcript.
