# Project Handoff Guide

GitHub `main` is the source of truth. Read this file first, then fetch current live files before editing. Target is Bitburner v3.x; live testing is v3.0.1.

## Engineering constraints
Prefer small focused modules over monoliths. Ordinary modules aim <=300 lines, review/split around 400, >500 requires a reason. React callbacks stay Netscript-free; async Netscript code owns I/O and process actions.

## Execution modes
`STANDBY`, `HGW`, `BATCH`, `PIPELINE`, `MULTI`. Startup defaults STANDBY; prepper runs independently.

## Dynamic MULTI redesign — ACTIVE WORK
Safety invariants: global concurrency proof and target-local overlap proof remain separate; RAM never grants unproven depth; production uses proven depth only; failed higher validation preserves lower proof; prep owns its reserve when actual prep exists.

### Dynamic overlap evidence / validation
`lib/multi-overlap-evidence.js` model `MULTI_TARGET_OVERLAP_EVIDENCE_V2_DYNAMIC_DEPTH` stores independent depth evidence per target. Two consecutive clean dedicated waves prove a tested depth. `lib/multi-target-tuning.js` ladder is depths 2..12, hack 5/7.5/10/12.5/15/20%, timing 100/125/150/175/200/250ms.

`diagnostics/multi-depth-validate.js` performs real configurable same-target depth validation. `diagnostics/multi-full-depth-test.js` climbs one target through its remaining depth ladder. `diagnostics/multi-full-depth-set.js` sequentially full-depth tests planner targets already PROVEN2+. Validation UI exposes individual and `PROVEN2+ SET · full-depth each` modes.

Current depth-N validation is conservative serialized landing-stream proof. Target-stream trajectory/steady-state validation is still required before tighter interleaved production overlap. Current production `hacking/multi-target-runner.js` remains per-target depth 1; do not remove uniqueness guard until runtime proof supports the next scheduler.

## Pre-4S stock trading pilot
Goal is to earn while hacking validation occupies STANDBY and accelerate the $25b 4S forecast API purchase.

`stocks/history-keeper.js` remains the source price recorder. `stocks/signals.js` adds a price-only pre-4S signal using 5m/15m/30m momentum, regression trend, tick-direction bias, agreement and realized volatility. It requires multi-window history and returns a bounded signed score/confidence; it does not pretend to know the hidden 4S forecast.

`stocks/pre4s-trader.js` is now part of normal startup. `kickstart.js` stage 2 starts it automatically if it is not already running, alongside the prepper, batch-history collector, and stock-history recorder. The trader polls prices every 50ms but only reevaluates entries on a genuine price change; heartbeat/state refresh remains at least once per second. Stops and exits are checked before new entries.

### Conservative shorts — ENABLED
Pre-4S shorts are enabled by default through persisted trader config, with deliberately stricter admission than longs:
- long entry score >= +0.62, confidence >= 60%;
- short entry score <= -0.72, confidence >= 72%;
- long per-symbol cap 4% of equity;
- short per-symbol cap 1.5% of equity;
- separate short budget default 5% of equity, dashboard-adjustable 0–10%;
- configurable stop loss applies symmetrically to longs and shorts;
- setting short budget to 0 or disabling the dashboard short toggle prevents new shorts.

### Market Lab capital control + stop loss
`lib/stock-trader-config.js` persists `/data/pre4s-trader-config.txt`. `stocks/trader-controls.js` is a focused React component; it emits plain config requests and performs no Netscript I/O. `stocks/dashboard.js` owns async file writes.

Market Lab lets the user choose `% OF PLAYER CASH` capped 0–30% or `FIXED AMOUNT` with k/m/b/t suffixes. The selected value is a maximum total stock exposure. Lowering the cap below current exposure blocks new entries but does not force-liquidate otherwise healthy positions.

Stop loss default is 5%, allowed 0–50%, and 0 disables it. Longs exit when executable bid <= average entry × (1-stopLoss). Shorts exit when executable ask >= average entry × (1+stopLoss). Signal exits remain active independently.

### Manual position close — IMPLEMENTED
`lib/stock-trader-actions.js` persists a single request/response action in `/data/pre4s-trader-action.txt`. `stocks/portfolio.js` renders the Market Lab portfolio and a CLOSE button for every open long or short position. React only queues a plain close request; the async dashboard loop writes it, and the trader executes the actual stock API call.

A successful manual close is recorded in the durable P&L ledger with reason `MANUAL_EXIT`. The trader applies a 60-second symbol re-entry cooldown after a manual close so it does not immediately repurchase/re-short the position the user just exited. The most recent manual action result is shown beneath the portfolio. Manual actions require the trader process to be running; normal startup now ensures that process is admitted automatically.

### Historical trader P&L — IMPLEMENTED
`lib/stock-trade-performance.js` persists `/data/pre4s-trader-performance.txt` using model `PRE4S_TRADER_PERFORMANCE_V1`. Every closed trade records timestamp, symbol, side, shares, average entry, executable exit, realized P&L after the sell/cover commission, and exit reason. Up to the latest 500 closed trades are retained.

Durable summary tracks total/long/short realized P&L, closed trades, wins/losses, win rate, gross profit/loss, profit factor, peak realized P&L and maximum realized-P&L drawdown. `stocks/pre4s-trader.js` publishes this summary and recent closes in its live state; Market Lab renders the historical metrics and latest closed trades inside trader controls.

Historical P&L starts from exits made after this ledger-enabled version is pulled. Earlier already-completed trades cannot be reconstructed reliably from price history alone.

Manifest includes `lib/stock-trader-config.js`, `lib/stock-trader-actions.js`, `lib/stock-trade-performance.js`, `stocks/trader-controls.js`, and `stocks/portfolio.js`.

## Stock research baseline
`lib/stock-history.js` retains all history going forward with `Date.now()` timestamps and recorder gaps. `stocks/history-keeper.js` polls TIX every 200ms and persists actual price-vector changes. Market Lab CANDLES uses 5m/15m/30m/1h/4h lookbacks; HISTORY · LINE provides 15m/1h/3h/6h/12h/24h/ALL. Startup launches recorder, Market Lab, and pre-4S trader.

## AUTOMULTI
`lib/automulti-decision.js`, `lib/automulti-live.js`, `lib/multi-target-ranking.js`, and `hacking/automulti-controller.js` provide the supervisory AUTO foundation. Production must not exceed relevant proof ceilings.

## Prepper
`hacking/prepper.js` + `hacking/prepper-allocation.js`, model `DISTRIBUTED_TARGET_PREPPER_V3_ADAPTIVE_FOCUS`, Port 18. Adaptive money-first prep with bounded reserved RAM. Automatic validation borrowing is not implemented yet.

## Runtime ports
12 serialized batch, 14 timing events (one real coordinator only), 15 latest completed batch, 16 pipeline, 17 multi, 18 prepper, 19 rolling history, 20 global stress. Overlap validation and stocks use files.

## Immediate runtime work
Pull latest and run the normal startup path. Confirm Market Lab shows TRADING LIVE without manually launching `stocks/pre4s-trader.js`. Verify a portfolio CLOSE button removes the selected long/short, records a `MANUAL_EXIT` in historical P&L, and does not re-enter that symbol for roughly 60 seconds. Hacking validation can continue independently.

## Priority
```text
DONE dynamic per-target arbitrary-depth evidence foundation
DONE configurable depth-N + individual/set full-depth validation
DONE pre-4S price signal engine + conservative live trader
DONE Market Lab percent/fixed capital controls + configurable stop loss
DONE 50ms change detector + conservative pre-4S shorts
DONE durable historical trader P&L + long/short performance split
DONE manual Market Lab position closes + 60s re-entry cooldown
DONE normal startup auto-starts pre-4S trader
NOW collect validation and trader performance evidence in parallel
NEXT target-stream trajectory validation
NEXT real MULTI marginal allocator using proven per-target depth
NEXT Market Lab signal/confidence columns + richer performance visualization
NEXT concentrated-vs-distributed selection + hack/timing tuner
NEXT idle prep-reserve auto-validation borrowing
NEXT feed learned profiles into AUTOMULTI + GUI
LATER 4S integration, progression supervisor, watchdog refinements
```
