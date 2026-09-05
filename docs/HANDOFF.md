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
- `lib/multi-target-ranking.js`: shared MONEY/BALANCED/XP ranking policy.
- `hacking/automulti-controller.js`: supervisory ASSESS -> RUN -> OBSERVE -> ADAPT.
Production must never exceed the relevant proven ceiling.

## Same-target overlap rollout
Durable proof: `lib/multi-overlap-evidence.js` -> `/data/multi-overlap-evidence.txt`, model `MULTI_TARGET_OVERLAP_EVIDENCE_V1`.
Shared policy: `lib/multi-overlap-policy.js`, model `MULTI_TARGET_OVERLAP_POLICY_V2_SEPARATE_PROOF`.
Pipeline history creates `VALIDATE2`; two clean dedicated overlap waves create `PROVEN2`. Port 19's older 4/8 ladder is never direct production overlap proof.

Dedicated validator:
```text
run diagnostics/multi-overlap-validate.js [target|auto] [waves] [hackFraction] [stageGapMs]
```
Controller must be fully STANDBY. Validator owns Port 14, schedules two same-target HWGW batches, validates timing/order/spacing/drift/recovery, and records evidence.

Validation UI is integrated in the main dashboard under `ui/views/validation.js`. It supports MIXED VALIDATE2, ALL PREPARED including DEPTH1, and explicit targets. Dashboard launches are quiet. Runtime truth now comes from actual validator process state plus file telemetry, so stale state is shown as `VALID STALE` rather than pretending work is still healthy.

Latest runtime evidence from the user: joesguns validated cleanly; screenshot later showed phantasy, sigma-cosmetics, and joesguns already `PROVEN2` while a mixed pass continued through silver-helix and remaining candidates.

Real `hacking/multi-target-runner.js` is still per-target depth 1. Do not remove its uniqueness guard until the current multi-target overlap evidence pass is reviewed.

## Stock research baseline — NEW
The user is currently saving toward the $25b 4S forecasting API and requested observation/history first, no autonomous trading yet.

### Persistent compact history
```text
lib/stock-history.js
/data/stock-history.txt
model STOCK_HISTORY_V1_COMPACT
```
History stores one shared timestamp array plus a compact price array per symbol. Default cadence is 6 seconds, max 1,800 samples, roughly a 3-hour rolling window. This avoids a large object-per-symbol-per-tick file while still giving enough baseline data for pre-4S volatility research.

The helper also exposes `stockSeries()` and `stockSeriesStats()`. Current volatility proxy is standard deviation of recorded tick-to-tick returns. This is intentionally descriptive only; no forecast/trading signal is produced yet.

### Stock history keeper
```text
stocks/history-keeper.js
```
Observation-only, never trades. It records every TIX-visible symbol, current price, bid/ask, max shares, and current long/short positions. Current market/portfolio snapshot is persisted separately:
```text
/data/stock-market-state.txt
model STOCK_MARKET_STATE_V1
```
The snapshot includes TIX/4S access flags, cash, symbol prices, long/short holdings, long value, short value, and gross exposure.

If TIX API access is unavailable, the keeper publishes WAITING state and parks until access becomes available rather than crashing.

`kickstart.js` now starts `stocks/history-keeper.js` quietly alongside prepper and batch-history collection. The dedicated stock dashboard also starts the keeper quietly if it is not already running, so collection begins immediately when the dashboard is opened.

### Separate React Market Lab dashboard
```text
stocks/dashboard.js
stocks/styles.js
run stocks/dashboard.js
```
This is intentionally separate from the main hacking control plane. One React tree is mounted; the async Netscript loop refreshes plain JS cache. React callbacks only change local selected-symbol state.

Current dashboard sections:
```text
Header: recorder/TIX/4S/trading-off status
Hero: cash, progress toward $25b 4S API, long value, short value, unrealized P&L
Price history: selectable symbol, SVG stock-style line chart, sample count, window change, tick volatility, observed price range
Portfolio: current LONG/SHORT positions, shares, value, unrealized P&L, exposure summary
Market watch: every stock with price, rolling-window change, volatility, samples; clicking a row changes the chart
```
Trading is explicitly OFF. The old `stocks/terminal.js` placeholder remains but `stocks/dashboard.js` is now the preferred stock research surface.

Long and short portfolio accounting are already separate in the snapshot/dashboard so future execution logic can support both directions without changing the data model.

### Stock next steps
Do not build autonomous orders yet. First collect a meaningful pre-4S baseline and inspect runtime behavior/file growth. After 4S becomes available, signal source can switch to native forecast + volatility while preserving the same history/portfolio/dashboard layers.

Likely future focused modules:
```text
stocks/signals.js
stocks/allocator.js
stocks/trader.js
stocks/controller.js
```
Economy/manual-goal cash reservation must remain authoritative over future stock deployment.

## Prepper
`hacking/prepper.js` + `hacking/prepper-allocation.js`, model `DISTRIBUTED_TARGET_PREPPER_V3_ADAPTIVE_FOCUS`, Port 18. Adaptive money-first prep with bounded reserved RAM.

## Runtime ports
12 serialized batch, 14 timing events (one real coordinator only), 15 latest completed batch, 16 pipeline, 17 multi, 18 prepper, 19 rolling history, 20 global stress. Overlap and stock research state are file-based.

## Immediate stock test
After pulling:
```text
run gitpull.js
run stocks/history-keeper.js --quiet
run stocks/dashboard.js
```
The dashboard itself will start the keeper if needed, so manually starting the keeper is optional. Let it collect for at least several minutes before judging volatility; longer collection makes the baseline more useful.

## Priority
```text
IN PROGRESS runtime validate depth 2 across multiple targets
NEXT review mixed/all overlap evidence
NEXT extend real MULTI planner to evidence-backed per-target depth 2
NEXT separate total global in-flight cap from distinct-target count
PARALLEL collect pre-4S stock price history and validate Market Lab runtime/file growth
LATER add stock signal/allocator/trader/controller after baseline and 4S access
LATER feed overlap capacity into AUTOMULTI and GUI
LATER tighter target-local cadence, failed-global-depth cooldown, UI refinements, watchdog
```
