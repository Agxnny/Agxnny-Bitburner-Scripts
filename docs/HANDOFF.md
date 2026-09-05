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
Pipeline history only creates a `VALIDATE2` candidate. Dedicated evidence creates `PROVEN2`. Port 19's older 4/8 ladder is not production overlap proof.

Read-only advisor:
```text
run diagnostics/multi-overlap-advisor.js money 0.10 12
```
Latest runtime before validation showed 32,588 GB production RAM / 68 hosts, five prepared targets, all five `VALIDATE2`: phantasy, silver-helix, omega-net, sigma-cosmetics, joesguns.

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
Defaults auto / 2 waves / 10% / 200ms. Controller must be fully STANDBY. Validator blocks other real coordinators, owns Port 14, plans two same-target HWGW batches in one calendar, and initially uses non-crossing adjacent landing streams: A H/W1/G/W2 then B H/W1/G/W2. It checks every timing event, order, spacing >=75ms, drift <=150ms, final money >=99.5%, security <=min+0.05, and records each completed wave.

Live state:
```text
lib/overlap-validation-state.js
/data/multi-overlap-validation-state.txt
model MULTI_OVERLAP_VALIDATION_STATE_V1
```
Validator publishes target/status/PID/wave progress, clean waves, hack %, gap, interval, expected/reported jobs, stage progress, both active batches, planned/actual landings, and last result roughly every 250ms.

### Main dashboard Validation tab
The validation UI is now integrated into the normal control-plane dashboard:
```text
ui/views/validation.js
```
Main tabs are now Overview / Targets / Economy / Batch / Validation / Network / Diagnostics.

Validation tab provides:
```text
- target dropdown with MIXED plus planner targets
- waves, hack %, and stage-gap controls
- START VALIDATION button
- launch safety lock unless controller is fully STANDBY
- live target/status/wave/clean count
- live stage and timing-job progress bars
- per-batch H/W1/G/W2 landing-state cards
- last-wave spacing/drift/money/security result
- durable per-target table: DEPTH1 / VALIDATE2 / PROVEN2
```
React callbacks only queue plain-JS requests; `ui/actions.js` performs the actual Netscript launches.

### Mixed validation coordinator
```text
diagnostics/multi-overlap-mixed.js
```
Selecting `MIXED` in the Validation tab snapshots every currently prepared target that is `VALIDATE2` and not already `PROVEN2`, then runs the dedicated validator sequentially on each target. It does not run validators concurrently and therefore preserves single Port-14 ownership. Default per-target settings are the values chosen in the tab (normally 2 waves, 10%, 200ms).

The older standalone `diagnostics/validation-dashboard.js` remains optional and was updated to Bitburner 3.0 `ns.ui.openTail()/resizeTail()`, but the main-dashboard Validation tab is now the preferred interface.

## Prepper
`hacking/prepper.js` + `hacking/prepper-allocation.js`, model `DISTRIBUTED_TARGET_PREPPER_V3_ADAPTIVE_FOCUS`, Port 18. Adaptive money-first prep with bounded reserved RAM.

## Dashboard architecture
Main dashboard remains one mounted React tree with separate view modules. `ui/state.js` now caches Port 19 history plus overlap evidence/live-validation state. The async action bridge owns validator launches.

## Runtime contracts
Real `hacking/multi-target-runner.js` remains finite and per-target depth 1. Do not remove the uniqueness guard until multiple targets have dedicated `PROVEN2` evidence and runtime output is reviewed.

Ports: 12 serialized batch, 14 timing events (one real coordinator only), 15 latest completed batch, 16 pipeline, 17 multi, 18 prepper, 19 rolling history, 20 global stress. Overlap validation live/evidence state is file-based.

## Immediate validation
Pull and restart the main dashboard so the new tab/module is loaded:
```text
run gitpull.js
```
Then restart the normal dashboard/startup path and open the new `Validation` tab.

For the safest first pass select `joesguns`, leave 2 waves / 10% / 200ms, park controller fully STANDBY, and press START VALIDATION. After that, `MIXED` can sequentially validate all currently prepared `VALIDATE2` targets.

After clean proof:
```text
cat /data/multi-overlap-evidence.txt
run diagnostics/multi-overlap-advisor.js money 0.10 12
```
Validate at least joesguns plus two other good targets before enabling production overlap.

## Priority
```text
DONE global stress evidence + AUTOMULTI decision/supervisor
DONE shared ranking cleanup
DONE overlap candidate policy/advisor
DONE simulator shared overlap policy
DONE dedicated depth-2 validator + durable evidence
DONE live validation telemetry
DONE main-dashboard Validation tab + target/MIXED launcher
NEXT runtime validate depth 2 on multiple targets
NEXT extend real MULTI planner to evidence-backed per-target depth 2
NEXT separate total global in-flight cap from distinct-target count
NEXT feed overlap capacity into AUTOMULTI and GUI
LATER tighter target-local cadence only after non-crossing depth 2 is stable
LATER failed-global-depth cooldown, UI refinements, watchdog
```
