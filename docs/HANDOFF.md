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

`stocks/pre4s-trader.js` is a conservative LIVE pilot and is deliberately not auto-started yet. Entry remains score >=0.62 with confidence >=0.60; long signal exit remains score <0.22; shorts are disabled unless explicitly launched with `--short`. Minimum trade remains $5m, per-symbol entry ceiling remains 4% of equity, and the cash floor remains $100m.

### Market Lab capital control + stop loss — IMPLEMENTED
`lib/stock-trader-config.js` persists `/data/pre4s-trader-config.txt`. `stocks/trader-controls.js` is a focused React component; it emits plain config requests and performs no Netscript I/O. `stocks/dashboard.js` owns the async file writes.

Market Lab lets the user choose:
- `% OF PLAYER CASH`, capped 0–30%; or
- `FIXED AMOUNT`, accepting plain numbers or k/m/b/t suffixes.

The selected value is a maximum total stock exposure. Lowering the cap below current exposure blocks new entries but does not force-liquidate otherwise healthy positions. The trader rereads config every cycle, so saved changes apply without restarting it once the config file exists.

A configurable stop loss is also exposed in Market Lab. Default is 5%, allowed range 0–50%, and 0 disables it. Longs exit when executable bid <= average entry × (1-stopLoss). Shorts exit when executable ask >= average entry × (1+stopLoss). Signal exits remain active independently. Trader state model is `PRE4S_TRADER_V3_STOP_LOSS` and records capital mode/limit, exposure, stop-loss percent and stop-loss exits per cycle.

Manifest includes `lib/stock-trader-config.js` and `stocks/trader-controls.js`.

Launch after pull with:
```text
run stocks/pre4s-trader.js 0.15
```
The CLI fraction is only a fallback before `/data/pre4s-trader-config.txt` exists; after saving Market Lab controls, the persistent dashboard config is authoritative. Do not enable `--short` for the first runtime pilot. Profitability is not guaranteed; review positions/P&L before increasing allocation.

Future stock work: durable trade ledger/performance statistics, Market Lab signal/position/P&L panel, adaptive thresholds from observed results, then 4S forecast/volatility integration once purchased.

## Stock research baseline
`lib/stock-history.js` retains all history going forward with `Date.now()` timestamps and recorder gaps. `stocks/history-keeper.js` polls TIX every 200ms and persists actual price-vector changes. Market Lab CANDLES uses 5m/15m/30m/1h/4h lookbacks; HISTORY · LINE provides 15m/1h/3h/6h/12h/24h/ALL. Startup launches recorder/dashboard, but not the live trader.

## AUTOMULTI
`lib/automulti-decision.js`, `lib/automulti-live.js`, `lib/multi-target-ranking.js`, and `hacking/automulti-controller.js` provide the supervisory AUTO foundation. Production must not exceed relevant proof ceilings.

## Prepper
`hacking/prepper.js` + `hacking/prepper-allocation.js`, model `DISTRIBUTED_TARGET_PREPPER_V3_ADAPTIVE_FOCUS`, Port 18. Adaptive money-first prep with bounded reserved RAM. Automatic validation borrowing is not implemented yet.

## Runtime ports
12 serialized batch, 14 timing events (one real coordinator only), 15 latest completed batch, 16 pipeline, 17 multi, 18 prepper, 19 rolling history, 20 global stress. Overlap validation and stocks use files.

## Immediate runtime work
Allow the currently-running full-depth validation set to finish naturally. Pull latest scripts, reopen Market Lab, choose percentage or fixed-amount trading capital plus stop loss, press SAVE, then run `stocks/pre4s-trader.js 0.15` if it is not already active. Confirm TRADING LIVE and that Live limit / Exposure / Stop loss update as expected. Validation can continue independently.

## Priority
```text
DONE dynamic per-target arbitrary-depth evidence foundation
DONE configurable depth-N + individual/set full-depth validation
DONE pre-4S price signal engine + conservative manual live trader pilot
DONE Market Lab percent/fixed capital controls + configurable stop loss
NOW collect validation evidence and pre-4S trading results in parallel
NEXT target-stream trajectory validation
NEXT real MULTI marginal allocator using proven per-target depth
NEXT durable stock trade ledger/performance + Market Lab signals
NEXT concentrated-vs-distributed selection + hack/timing tuner
NEXT idle prep-reserve auto-validation borrowing
NEXT feed learned profiles into AUTOMULTI + GUI
LATER 4S integration, progression supervisor, watchdog refinements
```
