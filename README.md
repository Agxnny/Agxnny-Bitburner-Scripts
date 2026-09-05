# Agxnny Bitburner Scripts

A modular Bitburner v3.x automation stack with a home-based control plane, remote HGW/HWGW execution, adaptive target preparation, real multi-target batching, durable concurrency validation, economy/progression automation, diagnostics, and an observation-only stock Market Lab.

## Quick start

```text
run startup.js
```

Startup launches the main Control Plane and stock Market Lab, restores the manual savings lock, refreshes planning/deployment, starts the prepper/history services, and starts the controller in **STANDBY**. The prepper is independent and may still run GROW/WEAKEN maintenance while production is in STANDBY.

Update from GitHub `main` with:

```text
run gitpull.js
run startup.js
```

For development continuity read `docs/HANDOFF.md` first. For a readable inventory of implemented behavior read `docs/FEATURES.md`.

## Production modes

| Mode | Function |
| --- | --- |
| `STANDBY` | Production admission off; safe state for real validation. |
| `HGW` | Sequential remote hack/grow/weaken automation. |
| `BATCH` | Serialized synchronized HWGW. |
| `PIPELINE` | Continuous same-target synchronized HWGW, hard live depth 2. |
| `MULTI` | Controller-managed real multi-target finite waves. Global depth is configurable; same-target production depth is still 1 pending validation rollout. |

Mode changes drain admitted synchronized work to a safe boundary.

## Main features

- Adaptive economic target selection with partial/full preparation strategies.
- Distributed money-first prepper with bounded reserved RAM, adaptive concentration, multi-host same-target prep, and ETA telemetry.
- Serialized HWGW and real continuous depth-2 pipeline execution.
- Real finite multi-target execution with one shared host/time calendar and central timing-event routing.
- Persistent global stress evidence and independent per-target/per-depth overlap evidence.
- Validation tab with depth-2 qualification, configurable depth-N validation, individual full-depth climb, and sequential `PROVEN2+ SET` full-depth testing.
- AUTOMULTI supervisory foundation for scenario selection and global validation; final heterogeneous same-target production scheduling is still under development.
- Manual savings/spending lock plus advisor-driven home/cloud capacity progression.
- Automatic rooting/deployment/synchronization of remote execution capacity.
- Seven-tab React Control Plane with collapsible cards and Netscript-free React callbacks.
- Observation-only stock Market Lab with retained wall-clock history, true 5m/15m/30m/1h/4h candlesticks, full-history line view, recorder-gap handling, and portfolio display.
- Integrated health/tests plus terminal diagnostics and RAM audit.

## Current dynamic MULTI boundary

Validation can learn different safe overlap depths for different targets and retains evidence independently, for example `target A = depth 5` and `target B = depth 2`. Production MULTI **does not consume those higher target-local depths yet**. The next production stage is target-stream validation plus a marginal allocator that combines target-local proof with separate global concurrency proof.

## Documentation

- `docs/FEATURES.md` — implemented features and what each subsystem does.
- `docs/HANDOFF.md` — current development state, runtime evidence, and immediate next work.
- `docs/architecture.md` — architecture and safety boundaries.
- `docs/SYSTEM_MAP.md` — file/module responsibility map.
- `docs/RUNTIME_STATE.md` — ports, durable files, and command/state contracts.
- `docs/GUI_ARCHITECTURE.md` — main GUI structure and callback rules.
- `docs/BATCH_SCHEDULER.md` — synchronized scheduling and dynamic MULTI design.
- `docs/TESTING.md` — current validation procedures and regression checklist.
- `docs/ROADMAP.md` — completed/current/next development stages.

## Useful commands

```text
run startup.js
run diagnostics/mem-audit.js
run hacking/pipeline-runner.js phantasy 0.10 200 2
run hacking/multi-target-runner.js money 6 0.10 200 3
run diagnostics/multi-target-stress.js mixed 8 2 12 0.10 200 10 resume
run diagnostics/multi-depth-validate.js phantasy 3 2 0.10 200
run diagnostics/multi-full-depth-test.js phantasy 2 0.10 200
run diagnostics/multi-full-depth-set.js 2 0.10 200
```

Real overlap/stress validation requires the controller to be fully STANDBY. Do not manually rerun a failed higher depth before inspecting the failure evidence.

## Core safety rules

Home remains the control/UI plane; normal workers execute remotely. Only one real synchronized coordinator owns Port 14 at a time. RAM availability never overrides proven concurrency. Global distinct-target proof and target-local overlap proof are separate. Higher-depth failure preserves lower proof. Manual savings locks override automated spending. Stock trading is currently disabled.
