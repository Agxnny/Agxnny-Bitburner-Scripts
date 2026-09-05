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

## Pre-4S stock trading pilot — NEW
Goal is to earn while hacking validation occupies STANDBY and accelerate the $25b 4S forecast API purchase.

`stocks/history-keeper.js` remains the source price recorder. `stocks/signals.js` adds a price-only pre-4S signal using 5m/15m/30m momentum, regression trend, tick-direction bias, agreement and realized volatility. It requires multi-window history and returns a bounded signed score/confidence; it does not pretend to know the hidden 4S forecast.

`stocks/pre4s-trader.js` is a conservative LIVE pilot. It is deliberately NOT started automatically yet. Defaults:
- 15% total portfolio capital ceiling;
- 4% equity ceiling per symbol;
- $100m cash floor;
- $5m minimum trade value;
- score >=0.62 and confidence >=0.60 to enter;
- score <0.22 to exit a long;
- longs only by default;
- optional `--short` enables symmetric shorts;
- accounts for $100k commission in sizing/realized-cycle estimates;
- state written to `/data/pre4s-trader-state.txt`.

Launch after pull with:
```text
run stocks/pre4s-trader.js 0.15
```
Do NOT enable `--short` for the first runtime pilot. This is an inferred-signal strategy and profitability is not guaranteed; review positions/P&L before increasing allocation. It can operate while hacking validation is running because it uses the stock API/cash rather than hacking worker RAM or Port 14.

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
Allow the currently-running full-depth validation set to finish naturally. The pre-4S trader can be started independently after pull without changing controller mode. First live pilot should be long-only at 15% allocation. Report trader errors, unexpected positions, or cash drawdown before raising risk.

## Priority
```text
DONE dynamic per-target arbitrary-depth evidence foundation
DONE configurable depth-N + individual/set full-depth validation
DONE pre-4S price signal engine + conservative manual live trader pilot
NOW collect validation evidence and pre-4S trading results in parallel
NEXT target-stream trajectory validation
NEXT real MULTI marginal allocator using proven per-target depth
NEXT durable stock trade ledger/performance + Market Lab signals
NEXT concentrated-vs-distributed selection + hack/timing tuner
NEXT idle prep-reserve auto-validation borrowing
NEXT feed learned profiles into AUTOMULTI + GUI
LATER 4S integration, progression supervisor, watchdog refinements
```
