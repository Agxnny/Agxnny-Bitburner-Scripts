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
The user is saving toward the $25b 4S forecasting API and requested observation/history first, no autonomous trading yet.

### Persistent compact history
```text
lib/stock-history.js
/data/stock-history.txt
model STOCK_HISTORY_V1_COMPACT
```
History stores one shared timestamp array plus a compact price array per symbol. Timestamps use JavaScript `Date.now()` wall-clock epoch time.

Retention is now `ALL`: new samples are no longer trimmed to the former 1,800-sample / ~3-hour rolling cap. Existing data that had already been trimmed before this change cannot be reconstructed, but all new observations remain persisted across normal pulls/restarts until the user explicitly deletes/resets the data file.

Recorder gaps use wall-clock continuity. `appendStockSample()` can record an explicit restart gap from the last persisted market heartbeat to the first new changed-price sample. Gap records include `from`, `to`, `durationMs`, and endpoint price jumps by symbol. The dashboard never fabricates intermediate prices.

`stockSeriesStats()` excludes returns crossing a detected outage from tick volatility.

### Stock history keeper
```text
stocks/history-keeper.js
```
Observation-only, never trades. Bitburner v3 stock access methods:
```text
ns.stock.hasWseAccount()
ns.stock.hasTixApiAccess()
ns.stock.has4SData()
ns.stock.has4SDataTixApi()
```

The keeper now polls TIX every 200ms to detect market changes as soon as practical. It does not persist duplicate unchanged prices every 200ms: it fingerprints the full symbol price set and writes a new historical sample only when prices actually change. Current market state/portfolio heartbeat is refreshed roughly once per second even if prices are unchanged. Observed market-tick interval is learned from recent changed-price timestamps and retained as `history.intervalMs` for gap/volatility logic.

`kickstart.js` starts `stocks/history-keeper.js` quietly. The stock dashboard also guards/starts it.

### Separate React Market Lab dashboard
```text
stocks/dashboard.js
stocks/candles.js
stocks/styles.js
run stocks/dashboard.js
```
The dashboard is separate from the hacking control plane and refreshes cached file state at 250ms. React callbacks remain Netscript-free.

Two chart tabs now exist:
```text
CANDLES
HISTORY · LINE
```

`CANDLES` is only for fixed OHLC timeframe views. Current selectors:
```text
1m / 5m / 15m / 30m / 1h / 4h
```
Candles are aligned to real wall-clock timeframe buckets and calculated only from observed samples. Direction is truthful: close > open is green, close < open is red, close == open is neutral grey. Wicks use the candle's actual observed high/low. Recorder gaps force a new candle and display an amber dashed discontinuity marker; candles never bridge missing data.

The candle tab deliberately does not have an ALL-HISTORY mode. It shows a recent window of roughly 70 candles at the chosen timeframe so old history is not compressed into misleading candles.

`HISTORY · LINE` preserves the original line-graph style and is the only place where historical-range selection appears:
```text
15m / 1h / 3h / 6h / 12h / 24h / ALL
```
`ALL` displays all retained observations. The line is broken at recorder gaps with an amber dashed marker rather than connecting pre-gap and post-gap prices as though they were continuously observed.

Header/hero/portfolio/market-watch remain read-only. Long and short holdings are accounted separately for future bidirectional trading support.

### Startup behavior
`startup.js` launches both dashboards on home before spawning the quiet kickstart chain:
```text
/ui/dashboard.js
/stocks/dashboard.js
```
Each is guarded with `ns.isRunning()`.

### Stock next steps
Do not build autonomous orders yet. Continue collecting a meaningful pre-4S baseline and inspect runtime/file growth. After 4S becomes available, signal source can switch to native forecast + volatility while preserving history/portfolio/dashboard layers.

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
```
Restart the already-running stock keeper and dashboard (or restart the normal startup stack) because Bitburner running scripts do not hot-reload imports.

Validate:
```text
- CANDLES tab has only fixed 1m/5m/15m/30m/1h/4h timeframe buttons
- green candles only when close > open; red only when close < open; neutral when equal
- wick high/low matches observed data
- HISTORY · LINE has 15m..24h plus ALL
- ALL line uses all retained observations and breaks at gaps
- recorder continues collecting with the dashboard closed
- history sample count grows only when stock prices actually change
```

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
