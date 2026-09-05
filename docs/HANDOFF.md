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

## Pre-4S stock trading — V7 ADAPTIVE
Goal is to earn while hacking validation occupies STANDBY and accelerate the $25b 4S forecast API purchase.

`stocks/history-keeper.js` remains the source price recorder. `stocks/signals.js` provides the price-only 5m/15m/30m pre-4S signal. `stocks/pre4s-trader.js` is part of normal startup and polls prices every 50ms while doing meaningful entry work only on genuine market changes.

### Entry persistence
`lib/stock-trader-policy.js` now requires three consecutive qualifying market changes before opening a position. Long qualification remains score >= +0.62/confidence >=60%; conservative short qualification remains score <= -0.72/confidence >=72%.

### Profit-aware exits and adaptive emergency stops
The old fixed-stop/weak-score exit path produced poor early evidence (many `LONG_STOP` losses), so V7 changes the exit model:
- emergency stop is volatility-aware and clamped to roughly 4–10%, using the configured dashboard stop as a floor;
- once a position has reached >=4% peak profit, trailing-profit protection activates;
- trailing giveback is 1.5% after 4% peak, 2% after 7% peak, and 2.5% after 10% peak;
- positions at >=8% current profit take profit when momentum is no longer strongly supportive;
- genuine opposite-direction reversal exits immediately;
- a weak signal may exit after two minutes rather than immediately churn;
- automatic exits get a 60-second re-entry cooldown.

`lib/stock-position-state.js` persists `/data/pre4s-position-state.txt`, tracking opened time, entry score/confidence, peak profit (MFE proxy), worst profit (MAE proxy), and current profit for each open position. Closed-trade records now retain entry signal, peak/worst excursion and holding time when available.

### Evidence-scaled capital
`lib/stock-performance-analysis.js` grades durable realized results. While fewer than 20 closes exist, the trader uses 50% of the dashboard-configured capital limit. Clearly poor evidence after 20 closes reduces effective allocation to 35%; positive PF/expectancy can promote to 75% and eventually 100% after stronger evidence. This changes the *effective* cap only; the user-configured cap remains the absolute maximum.

### Conservative shorts
Shorts remain deliberately stricter than longs: max 1.5% equity per short, separate short budget default 5% and dashboard range 0–10%. The same adaptive emergency-stop and profit-taking framework applies to shorts.

### Market Lab controls/manual exits
`lib/stock-trader-config.js` persists `/data/pre4s-trader-config.txt`. Market Lab supports percent or fixed total capital, configured emergency-stop floor, short budget, and short enable/disable. `lib/stock-trader-actions.js` + `stocks/portfolio.js` provide manual CLOSE; successful manual closes are ledgered as `MANUAL_EXIT` and apply a 60-second re-entry cooldown.

### Historical P&L
`lib/stock-trade-performance.js` persists `/data/pre4s-trader-performance.txt` and keeps up to 500 closes. Summary includes realized/long/short P&L, wins/losses, win rate, gross profit/loss, profit factor and max realized drawdown. New V7 records may also include entry score/confidence, peak/worst excursion and holding time.

## Stock research baseline
`lib/stock-history.js` retains all history going forward with `Date.now()` timestamps and recorder gaps. Market Lab CANDLES uses 5m/15m/30m/1h/4h lookbacks; HISTORY · LINE provides 15m/1h/3h/6h/12h/24h/ALL. Startup launches recorder, Market Lab, and pre-4S trader.

## AUTOMULTI
`lib/automulti-decision.js`, `lib/automulti-live.js`, `lib/multi-target-ranking.js`, and `hacking/automulti-controller.js` provide the supervisory AUTO foundation. Production must not exceed relevant proof ceilings.

## Prepper
`hacking/prepper.js` + `hacking/prepper-allocation.js`, model `DISTRIBUTED_TARGET_PREPPER_V3_ADAPTIVE_FOCUS`, Port 18. Adaptive money-first prep with bounded reserved RAM. Automatic validation borrowing is not implemented yet.

## Runtime ports
12 serialized batch, 14 timing events (one real coordinator only), 15 latest completed batch, 16 pipeline, 17 multi, 18 prepper, 19 rolling history, 20 global stress. Overlap validation and stocks use files.

## Immediate runtime work
Pull latest and restart the pre-4S trader so model `PRE4S_TRADER_V7_ADAPTIVE` is loaded. Existing open positions are adopted into position tracking on first evaluation, so their precise original entry timestamp/signal cannot be reconstructed, but current/peak/worst profit starts tracking from V7 startup. Observe whether profitable positions now close via `LONG_TRAIL`, `LONG_TAKE_PROFIT`, or `SIGNAL_REVERSAL` rather than repeatedly reaching fixed `LONG_STOP`.

## Priority
```text
DONE dynamic per-target arbitrary-depth evidence foundation
DONE configurable depth-N + individual/set full-depth validation
DONE pre-4S live trader + conservative shorts + manual closes
DONE durable historical P&L
DONE V7 persistent entries + adaptive emergency stops + trailing/take-profit exits
DONE V7 evidence-scaled capital + position excursion tracking
NOW collect V7 trader evidence and hacking validation in parallel
NEXT target-stream trajectory validation
NEXT real MULTI marginal allocator using proven per-target depth
NEXT Market Lab signal/confidence/action columns + richer cohort visualization
NEXT concentrated-vs-distributed selection + hack/timing tuner
NEXT idle prep-reserve auto-validation borrowing
NEXT feed learned profiles into AUTOMULTI + GUI
LATER 4S integration, progression supervisor, watchdog refinements
```
