# Project Handoff Guide

GitHub `main` is the source of truth. Read this file first, then fetch current live files before editing. Target is Bitburner v3.x; live testing is v3.0.1.

## Engineering constraints
Prefer small focused modules over monoliths. Ordinary modules aim <=300 lines, review/split around 400, >500 requires a reason. React callbacks stay Netscript-free; async Netscript code owns I/O and process actions.

## Execution modes
`STANDBY`, `HGW`, `BATCH`, `PIPELINE`, `MULTI`. Startup defaults STANDBY; prepper runs independently.

## Dynamic MULTI redesign — ACTIVE WORK
User explicitly wants production to learn per-target overlap depth beyond 2, dynamically tune hack fraction and timing, compare one deep premium target against multiple shallower targets, and automatically borrow idle prep-reserve RAM for validation.

Safety invariants:
- global concurrency proof and per-target overlap proof remain separate;
- RAM availability never grants unproven overlap depth;
- production uses proven depth only; candidate depth is validation-only;
- failed higher-depth validation must preserve lower proven levels;
- target-stream recovery validation is required before tightly interleaved deep overlap is admitted;
- prep owns its reserve whenever real prep demand exists; background validation may only borrow genuinely idle reserve capacity and must yield admission immediately when prep returns.

### Dynamic overlap evidence foundation — IMPLEMENTED
`lib/multi-overlap-evidence.js` now writes model `MULTI_TARGET_OVERLAP_EVIDENCE_V2_DYNAMIC_DEPTH`. It stores evidence independently per tested depth under each target's `depths` map, including clean/failed/consecutive waves, active proof, drift, spacing, hack fraction, stage gap, batch interval, status/reason and timestamps. Two consecutive clean dedicated waves prove a tested depth. A failure at a higher depth invalidates that depth without erasing lower proof.

V1 runtime evidence is migrated in memory on read, preserving existing depth-2 proof. The next V2 write persists the migrated structure. Do not delete `/data/multi-overlap-evidence.txt` during rollout.

`lib/multi-target-tuning.js` is a new pure policy module. It defines the initial promotion ladder `2,3,4,6,8,10,12`, hack candidates `5,7.5,10,12.5,15,20%`, timing candidates `100,125,150,175,200,250ms`, returns target-local proven/effective profiles, proposes conservative next validation experiments, and provides a marginal batch efficiency primitive for the future portfolio allocator. It does not itself authorize production beyond evidence.

### Still to implement in this redesign
1. Generalize the dedicated validator from fixed depth 2 to configurable depth N while preserving conservative non-crossing target streams initially.
2. Replace per-batch final-state assumptions with target-stream recovery validation suitable for deep overlap.
3. Extend real MULTI admission to consume target-local proven depth and rank the next marginal batch opportunity rather than enforcing distinct targets.
4. Compare concentrated vs distributed portfolio configurations using realized/expected money per second and RAM-second under proof/timing constraints.
5. Add bounded hill-climb tuning for depth/hack fraction/stage gap, with cooldown after failed experiments.
6. Add automatic low-priority validator that borrows only idle prep-reserve hosts/RAM, yields immediately to prep demand, and starts automatically through kickstart.
7. Feed learned profiles into AUTOMULTI and expose effective/proven/candidate settings in UI.

Current real `hacking/multi-target-runner.js` is STILL per-target depth 1. Do not remove its uniqueness guard until configurable validator/stream proof is implemented and runtime-validated.

## Concurrency evidence dimensions
Historical global stress was clean through distinct depth 5, but durable machine-readable proof starts separately in `/data/multi-stress-evidence.txt`.

## AUTOMULTI
- `lib/automulti-decision.js`: pure Possible / Proven / Effective decision logic.
- `lib/automulti-live.js`: live adapter.
- `lib/multi-target-ranking.js`: shared MONEY/BALANCED/XP ranking policy.
- `hacking/automulti-controller.js`: supervisory ASSESS -> RUN -> OBSERVE -> ADAPT.
Production must never exceed the relevant proven ceiling.

## Existing same-target overlap rollout
Shared policy: `lib/multi-overlap-policy.js`, currently still conservative depth-2 production policy. Pipeline history creates `VALIDATE2`; dedicated overlap evidence creates production proof.

Dedicated validator currently remains fixed depth 2:
```text
run diagnostics/multi-overlap-validate.js [target|auto] [waves] [hackFraction] [stageGapMs]
```
Controller must be fully STANDBY. Validator owns Port 14 and records evidence.

Validation UI is integrated in the main dashboard under `ui/views/validation.js`. Dashboard launches are quiet. Runtime truth comes from actual validator process state plus file telemetry.

Latest runtime evidence from the user: joesguns validated cleanly; screenshot later showed phantasy, sigma-cosmetics, and joesguns already `PROVEN2` while a mixed pass continued through silver-helix and remaining candidates.

## Stock research baseline
User is saving toward the $25b 4S forecasting API; stock subsystem remains observation/history only, no autonomous trading yet.

Persistent history: `lib/stock-history.js` -> `/data/stock-history.txt`, model `STOCK_HISTORY_V1_COMPACT`. Retention is ALL going forward. Timestamps use `Date.now()` wall-clock time and recorder gaps are preserved rather than reconstructed.

`stocks/history-keeper.js` polls TIX every 200ms, persists a historical sample only when the price set changes, and refreshes market/portfolio heartbeat about once per second. Bitburner v3 access methods are `hasWseAccount`, `hasTixApiAccess`, `has4SData`, `has4SDataTixApi`.

`stocks/dashboard.js` is a separate React Market Lab. CANDLES uses `1m/5m/15m/30m/1h/4h` as chart lookback windows, not candle widths. Longer windows intentionally render more candles: current mapping is approximately 1m→10s OHLC (~6), 5m→30s (~10), 15m→1m (~15), 30m→1m (~30), 1h→1m (~60), 4h→2m (~120), limited naturally by retained observations. Direction is truthful (close>open green, close<open red, equal neutral) and wicks use observed high/low only.

Candle and line charts only show recorder gaps that actually intersect the currently visible chart range. Older retained gaps remain in history and the header may still report the latest historical gap, but stale gaps outside the selected window no longer render dashed markers or the chart continuity warning. HISTORY · LINE alone provides `15m/1h/3h/6h/12h/24h/ALL`; ALL intentionally includes all retained gaps. Inactive chart/timeframe buttons now use a black border instead of the previous grey border; active buttons retain the blue accent border.

Startup launches both main and stock dashboards.

## Prepper
`hacking/prepper.js` + `hacking/prepper-allocation.js`, model `DISTRIBUTED_TARGET_PREPPER_V3_ADAPTIVE_FOCUS`, Port 18. Adaptive money-first prep with bounded reserved RAM. Current reserve selection is host-based and the prepper owns those hosts. Automatic validation borrowing is NOT implemented yet; it must coordinate ownership explicitly rather than simply launching the existing validator against the general execution pool.

## Runtime ports
12 serialized batch, 14 timing events (one real coordinator only), 15 latest completed batch, 16 pipeline, 17 multi, 18 prepper, 19 rolling history, 20 global stress. Overlap and stock research state are file-based.

## Immediate next work
Continue dynamic MULTI implementation with the configurable depth-N validator and target-stream validation. Preserve the existing depth-2 runtime evidence through the V1->V2 migration. Only after depth-N proof is runtime-safe should production MULTI consume dynamic per-target depth. Then implement marginal portfolio allocation and idle prep-reserve auto-validation.

## Priority
```text
IN PROGRESS dynamic MULTI: arbitrary per-target evidence + tuning foundation DONE
NEXT configurable depth-N validator + target-stream recovery proof
NEXT real MULTI marginal allocator using proven per-target depth
NEXT concentrated-vs-distributed portfolio selection + hack/timing tuner
NEXT automatic idle prep-reserve validation borrowing
NEXT feed learned profiles into AUTOMULTI + GUI
PARALLEL collect pre-4S stock history
LATER progression supervisor, stock trading after signal/4S work, watchdog/UI refinements
```
