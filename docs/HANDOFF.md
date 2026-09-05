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

Validation UI is integrated in the main dashboard under `ui/views/validation.js`. It supports MIXED VALIDATE2, ALL PREPARED including DEPTH1, and explicit targets. Dashboard launches are quiet. Runtime truth comes from actual validator process state plus file telemetry, so stale state is shown as `VALID STALE` rather than pretending work is still healthy.

Latest runtime evidence from the user: joesguns validated cleanly; screenshot later showed phantasy, sigma-cosmetics, and joesguns already `PROVEN2` while a mixed pass continued through silver-helix and remaining candidates.

Real `hacking/multi-target-runner.js` is still per-target depth 1. Do not remove its uniqueness guard until the current multi-target overlap evidence pass is reviewed.

## Stock research baseline
The user is currently saving toward the $25b 4S forecasting API and requested observation/history first, no autonomous trading yet.

### Persistent compact history
```text
lib/stock-history.js
/data/stock-history.txt
model STOCK_HISTORY_V1_COMPACT
```
History stores one shared timestamp array plus a compact price array per symbol. Default cadence is 6 seconds, max 1,800 samples, roughly a 3-hour rolling window.

Timestamps use normal JavaScript `Date.now()` wall-clock epoch time, so recorder downtime is detectable even when the script is not running. `appendStockSample()` compares the new wall-clock timestamp with the last persisted timestamp. A gap greater than 2.25x the expected sample interval is recorded in `history.gaps` with `from`, `to`, `durationMs`, and the net endpoint price jump for every symbol. Up to 24 recent gap records are retained.

Important limitation: after downtime we know exactly how long the recorder was absent and the net price change between the last pre-gap and first post-gap sample, but we cannot reconstruct the path or intermediate prices during that missing interval.

`stockSeriesStats()` excludes returns that cross detected recorder gaps from the normal tick-volatility calculation so an hours-long outage jump is not misclassified as a 6-second return. It also reports per-series gap count and largest gap.

### Stock history keeper
```text
stocks/history-keeper.js
```
Observation-only, never trades. It records every TIX-visible symbol, current price, bid/ask, max shares, and current long/short positions. Current market/portfolio snapshot is persisted separately:
```text
/data/stock-market-state.txt
model STOCK_MARKET_STATE_V1
```

Bitburner v3 stock access methods in use:
```text
ns.stock.hasWseAccount()
ns.stock.hasTixApiAccess()
ns.stock.has4SData()
ns.stock.has4SDataTixApi()
```
Do not use the removed v2-era names `hasWSEAccount`, `hasTIXAPIAccess`, or `has4SDataTIXAPI`.

If TIX API access is unavailable, the keeper publishes WAITING state and parks until access becomes available rather than crashing.

`kickstart.js` starts `stocks/history-keeper.js` quietly alongside prepper and batch-history collection. The dedicated stock dashboard also starts the keeper quietly if it is not already running.

### Separate React Market Lab dashboard
```text
stocks/dashboard.js
stocks/candles.js
stocks/styles.js
run stocks/dashboard.js
```
This is separate from the main hacking control plane. One React tree is mounted; the async Netscript loop refreshes plain JS cache. React callbacks only change local selected-symbol state.

Price history now renders stereotypical OHLC candlesticks instead of a simple line. `stocks/candles.js` aggregates sampled prices into up to 60 candles, with at least five recorded samples per candle. Candles show open/high/low/close; green is up and red is down. Candle aggregation will not bridge detected recorder gaps; a gap forces a new candle and the chart renders a dashed amber gap marker.

Current dashboard sections:
```text
Header: recorder/TIX/4S/trading-off status plus latest gap/continuous badge
Hero: cash, progress toward $25b 4S API, long value, short value, unrealized P&L
Price history: selectable symbol, OHLC candlestick chart, sample count, window change, tick volatility, observed price range
Continuity note: most recent recorder gap, wall-clock start/end, gap duration, and selected-symbol endpoint jump
Portfolio: current LONG/SHORT positions, shares, value, unrealized P&L, exposure summary
Market watch: every stock with price, rolling-window change, volatility, samples; clicking a row changes the chart
```
Trading is explicitly OFF. The old `stocks/terminal.js` placeholder remains but `stocks/dashboard.js` is the preferred stock research surface.

Long and short portfolio accounting are separate in the snapshot/dashboard so future execution logic can support both directions without changing the data model.

### Startup behavior
`startup.js` launches both dashboards on home before spawning the quiet kickstart chain:
```text
/ui/dashboard.js
/stocks/dashboard.js
```
Each is guarded with `ns.isRunning()`, so running `startup.js` again does not create duplicate dashboard processes.

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
run startup.js
```
This will start the main control-plane dashboard, the stock Market Lab dashboard, and the normal quiet kickstart chain. The stock history keeper will come up through kickstart/dashboard guard logic.

For gap testing, allow some samples to collect, stop `stocks/history-keeper.js` for at least ~15 seconds, then restart it. The dashboard should show a LAST GAP badge, a dashed chart gap marker, and the selected symbol's net endpoint change across the missing interval. Existing `/data/stock-history.txt` data is preserved by normal git pulls.

If the previous keeper/dashboard processes are still running old code after pulling, restart them; Bitburner running scripts do not hot-reload imported code.

## Priority
```text
IN PROGRESS runtime validate depth 2 across multiple targets
NEXT review mixed/all overlap evidence
NEXT extend real MULTI planner to evidence-backed per-target depth 2
NEXT separate total global in-flight cap from distinct-target count
PARALLEL collect pre-4S stock price history and validate Market Lab runtime/file growth + gap tracking
LATER add stock signal/allocator/trader/controller after baseline and 4S access
LATER feed overlap capacity into AUTOMULTI and GUI
LATER tighter target-local cadence, failed-global-depth cooldown, UI refinements, watchdog
```
