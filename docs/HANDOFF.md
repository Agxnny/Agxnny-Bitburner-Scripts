# Project Handoff Guide

GitHub `main` is the source of truth. Read this file first, then fetch current live files before editing. Target is Bitburner v3.x; live testing is v3.0.1.

## Engineering constraints
Prefer small focused modules over monoliths. Ordinary modules aim <=300 lines, review/split around 400, >500 requires a reason. React callbacks stay Netscript-free; async Netscript code owns I/O and process actions.

## Execution modes
`STANDBY`, `HGW`, `BATCH`, `PIPELINE`, `MULTI`. Startup defaults STANDBY; prepper runs independently.

## Concurrency evidence dimensions
Global distinct-target concurrency and same-target overlap are separate safety dimensions. Historical global stress was clean through distinct depth 5, but durable machine-readable proof starts separately in `/data/multi-stress-evidence.txt`.

## AUTOMULTI
- `lib/automulti-decision.js`: pure Possible / Proven / Effective decision logic.
- `lib/automulti-live.js`: live adapter.
- `lib/multi-target-ranking.js`: one shared MONEY/BALANCED/XP ranking policy.
- `hacking/automulti-controller.js`: supervisory ASSESS -> RUN -> OBSERVE -> ADAPT, with controlled validation.
Production must never exceed the relevant proven ceiling.

## Same-target overlap rollout
Durable proof:
```text
lib/multi-overlap-evidence.js
/data/multi-overlap-evidence.txt
model MULTI_TARGET_OVERLAP_EVIDENCE_V1
```
Two consecutive clean dedicated validation waves prove target depth 2. A later failed dedicated validation makes active policy fall back to depth 1 until revalidated.

Policy:
```text
lib/multi-overlap-policy.js
model MULTI_TARGET_OVERLAP_POLICY_V2_SEPARATE_PROOF
```
Pipeline history creates a `VALIDATE2` candidate. Dedicated evidence creates `PROVEN2`. Port 19's older 4/8 ladder is not production overlap proof.

Latest runtime evidence: `joesguns` completed the dedicated two-wave depth-2 validator cleanly and is user-confirmed validated. A mixed VALIDATE2 pass was then started across the remaining qualified targets. Screenshot evidence showed phantasy, sigma-cosmetics, and joesguns already PROVEN2 while silver-helix was being validated.

Read-only advisor:
```text
run diagnostics/multi-overlap-advisor.js money 0.10 12
```
Earlier runtime showed 32,588 GB production RAM / 68 hosts and five prepared candidate targets: phantasy, silver-helix, omega-net, sigma-cosmetics, joesguns.

Persistent simulator:
```text
hacking/multi-target-sim.js
model MULTI_TARGET_ADMISSION_SIM_V4_SHARED_OVERLAP_POLICY
```
Simulation uses `candidateDepth`; real production must use `provenDepth`.

### Dedicated real depth-2 validator
```text
diagnostics/multi-overlap-validate.js
run diagnostics/multi-overlap-validate.js [target|auto] [waves] [hackFraction] [stageGapMs]
```
Defaults auto / 2 waves / 10% / 200ms. Controller must be fully STANDBY. Validator owns Port 14, plans two same-target HWGW batches in one calendar, checks timing/order/spacing/drift/recovery, and records each completed wave.

Manual/automatic `auto` validation still requires normal pipeline qualification. Dashboard-selected explicit targets can pass `--allow-unqualified`, which permits a prepared DEPTH1 target to use the dedicated controlled validator itself as the qualification test. This does not grant production depth 2 unless the dedicated evidence actually passes the normal two-clean-wave requirement.

Live state:
```text
lib/overlap-validation-state.js
/data/multi-overlap-validation-state.txt
model MULTI_OVERLAP_VALIDATION_STATE_V1
```
Validator publishes target/status/PID/wave progress, clean waves, hack %, gap, interval, expected/reported jobs, stage progress, both active batches, planned/actual landings, and last result roughly every 250ms.

### Main dashboard Validation tab
```text
ui/views/validation.js
```
Main tabs: Overview / Targets / Economy / Batch / Validation / Network / Diagnostics.

Validation target selector provides:
```text
MIXED · prepared VALIDATE2 only
ALL PREPARED · includes DEPTH1
individual planner targets
```
`ALL PREPARED` snapshots every currently prepared target that still lacks dedicated depth-2 proof, including targets with no prior pipeline qualification, and validates them sequentially. Already-PROVEN2 targets are skipped. Unprepared targets are not admitted and must be prepared before they can be validated.

Selecting an individual target from the dashboard is also an explicit qualification request: if it is prepared, the dedicated validator may test it even when it currently shows DEPTH1. The normal validator safety/recovery criteria still apply before proof is persisted.

Dashboard-launched validation is always quiet. `ui/actions.js` passes `--quiet` to single-target and mixed/all launchers. Manual terminal launches keep printed output unless `--quiet` is supplied.

### Validation stale-state fix
A runtime screenshot revealed a stale-state mismatch: the Validation tab could keep showing `VALIDATING…` from an old state-file status while the header correctly stopped showing a live validation badge after telemetry became stale. `Status` and `Telemetry` also rendered `[object Object]` because `kv()` stringifies React elements.

Fix:
```text
ui/state.js
```
now snapshots actual `ns.scriptRunning()` state for `/diagnostics/multi-overlap-validate.js` and `/diagnostics/multi-overlap-mixed.js` as `validationRuntime`.

`ui/views/validation.js` now:
```text
- decides whether validation is really running from validationRuntime.active, not stale state-file status
- releases START VALIDATION once the actual processes are gone
- reports RUNNING · STALE TELEMETRY when a process exists but state updates stop
- renders Status and Telemetry as plain text through kv(), removing [object Object]
```

`ui/dashboard.js` header now uses the same real process truth. If validation is active and telemetry is fresh it shows `VALID <status>`; if process is active but telemetry is stale it shows `VALID STALE`. If no validator/mixed process exists, no live validation badge is shown regardless of old state-file contents.

This makes the header, Validation tab button, and stale telemetry indication use one consistent runtime truth.

### Mixed validation coordinator
```text
diagnostics/multi-overlap-mixed.js
```
It supports:
```text
validate2   prepared VALIDATE2 targets needing proof
all         every prepared target needing proof, including DEPTH1
```
It runs validators strictly sequentially so only one Port-14 owner exists. Quiet mode propagates to child validators.

## Prepper
`hacking/prepper.js` + `hacking/prepper-allocation.js`, model `DISTRIBUTED_TARGET_PREPPER_V3_ADAPTIVE_FOCUS`, Port 18. Adaptive money-first prep with bounded reserved RAM.

## Dashboard architecture
Main dashboard remains one mounted React tree with separate view modules. `ui/state.js` caches Port 19 history plus overlap evidence/live-validation state and now actual validation process status. The async action bridge owns validator launches.

## Runtime contracts
Real `hacking/multi-target-runner.js` remains finite and per-target depth 1. Do not remove the uniqueness guard until multiple targets have dedicated `PROVEN2` evidence and runtime output is reviewed.

Ports: 12 serialized batch, 14 timing events (one real coordinator only), 15 latest completed batch, 16 pipeline, 17 multi, 18 prepper, 19 rolling history, 20 global stress. Overlap validation live/evidence state is file-based.

## Immediate validation
The user's currently running mixed validation should not be interrupted solely for the UI fix. After it completes:
```text
run gitpull.js
```
Then restart/reload the main dashboard so `ui/state.js`, `ui/dashboard.js`, and `ui/views/validation.js` are re-imported.

If a future validator genuinely stalls, the dashboard will now distinguish `VALID STALE` from an old completed/stopped process. Once the process exits, the launch button will recover automatically even if the last state-file status remains RUNNING/MIXED_NEXT.

Use `MIXED` for qualified VALIDATE2 targets. Use `ALL PREPARED` for all prepared, not-yet-PROVEN2 targets including DEPTH1.

## Priority
```text
DONE global stress evidence + AUTOMULTI decision/supervisor
DONE shared ranking cleanup
DONE overlap candidate policy/advisor
DONE simulator shared overlap policy
DONE dedicated depth-2 validator + durable evidence
DONE live validation telemetry
DONE main-dashboard Validation tab + quiet launch
DONE MIXED VALIDATE2 + ALL PREPARED scopes
DONE validation stale-state/runtime-truth dashboard fix
IN PROGRESS runtime validate depth 2 across multiple targets
NEXT review mixed/all runtime evidence
NEXT extend real MULTI planner to evidence-backed per-target depth 2
NEXT separate total global in-flight cap from distinct-target count
NEXT feed overlap capacity into AUTOMULTI and GUI
LATER tighter target-local cadence only after non-crossing depth 2 is stable
LATER failed-global-depth cooldown, UI refinements, watchdog
```
