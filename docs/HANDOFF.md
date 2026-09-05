# Project Handoff Guide

GitHub `main` is the source of truth. Read this file first, then fetch current live files before editing. Target is Bitburner v3.x; live testing is v3.0.1.

## Engineering constraints
Prefer small focused modules over monoliths. Ordinary modules aim <=300 lines, review/split around 400, >500 requires a reason. React callbacks stay Netscript-free; async Netscript code owns I/O and process actions.

## Execution modes
`STANDBY`, `HGW`, `BATCH`, `PIPELINE`, `MULTI`. Startup defaults STANDBY; prepper runs independently.

## Dynamic MULTI redesign — ACTIVE WORK
User wants production to learn per-target overlap depth beyond 2, dynamically tune hack fraction/timing, compare deep premium targets against distributed targets, and eventually borrow idle prep-reserve RAM for validation.

Safety invariants:
- global concurrency proof and per-target overlap proof remain separate;
- RAM availability never grants unproven overlap depth;
- production uses proven depth only; validation may probe higher;
- failed higher-depth validation preserves lower proven levels;
- prep owns its reserve whenever real prep demand exists.

### Dynamic overlap evidence — IMPLEMENTED
`lib/multi-overlap-evidence.js` model `MULTI_TARGET_OVERLAP_EVIDENCE_V2_DYNAMIC_DEPTH` stores independent records under each target's `depths` map: clean/failed/consecutive waves, proof, drift, spacing, hack fraction, stage gap, batch interval, status/reason and timestamps. Two consecutive clean dedicated waves prove a tested depth. V1 depth-2 evidence migrates in memory and persists on the next write. Do not delete `/data/multi-overlap-evidence.txt`.

`lib/multi-target-tuning.js` exposes depth ladder `2,3,4,5,6,7,8,9,10,11,12`, hack candidates `5,7.5,10,12.5,15,20%`, and timing candidates `100,125,150,175,200,250ms`. Evidence can therefore retain target A proven depth 5 while target B remains proven depth 2.

### Configurable/full-depth validation — IMPLEMENTED, RUNTIME PROOF REQUIRED
`diagnostics/multi-depth-validate.js` is a real configurable same-target validator:
```text
run diagnostics/multi-depth-validate.js TARGET DEPTH WAVES HACK_FRACTION STAGE_GAP_MS [--quiet]
```
It builds DEPTH HWGW batches in a conservative non-crossing landing stream, reserves the whole calendar before launch, owns Port 14 during the test, validates timing events/order/spacing/drift/final recovery, and records the result at that exact target/depth in V2 evidence. RAM reservation ceiling is BLOCKED/neutral rather than destructive failure.

`diagnostics/multi-full-depth-test.js` automatically climbs one individual target from the next depth above its durable proven ceiling through depth 12. Default two waves/depth. It stops on RAM ceiling, timing/recovery failure, or controller leaving STANDBY. Every clean level remains independently retained.

`diagnostics/multi-full-depth-set.js` snapshots current planner targets with durable `provenDepth >= 2` and sequentially runs the individual full-depth climb for each target. It deliberately runs one target at a time so Port 14 remains single-owner. One target reaching its own failure/resource ceiling does not erase evidence or prevent later set members from being attempted; controller-leave-STANDBY aborts the set. This produces heterogeneous evidence such as target A depth 5 and target B depth 2.

Validation target selector now includes `PROVEN2+ SET · full-depth each`. Selecting it changes the action to `FULL DEPTH · PROVEN2+ SET`; individual target full-depth testing remains available. Set progress is exposed through validation state/runtime. `START VALIDATION` is disabled for the set selector because the set path is specifically full-depth.

Important: depth-N validation still uses conservative serialized batch landing streams and final stream recovery. It is proof-stage evidence before tighter production interleaving. Runtime validation across multiple targets is required before production consumes depth >1.

### Still to implement
1. Runtime-test individual and PROVEN2+ set full-depth validation and inspect failure/ceiling semantics.
2. Add target-stream trajectory/steady-state recovery validation for tighter deep overlap, beyond final recovery alone.
3. Extend real `hacking/multi-target-runner.js` to consume target-local proven depth and rank marginal batch opportunities rather than enforcing distinct targets.
4. Compare concentrated vs distributed portfolios using realized/expected $/sec and RAM-second under proof/timing constraints.
5. Add bounded hack/timing hill-climb with cooldown after failed experiments.
6. Add low-priority auto-validator borrowing only idle prep reserve, yielding admission when prep returns.
7. Feed learned profiles into AUTOMULTI and expose effective/proven/candidate settings.

Current production `hacking/multi-target-runner.js` is STILL per-target depth 1. Do not remove its uniqueness guard until the new validator has runtime proof.

## Concurrency evidence dimensions
Historical global stress was clean through distinct depth 5, but durable global proof is separate in `/data/multi-stress-evidence.txt`. Target-local proof never overrides this global ceiling.

## AUTOMULTI
`lib/automulti-decision.js`, `lib/automulti-live.js`, `lib/multi-target-ranking.js`, and `hacking/automulti-controller.js` provide the existing supervisory AUTO foundation. Production must never exceed relevant proven ceilings.

## Existing depth-2 rollout
Legacy `diagnostics/multi-overlap-validate.js` and `diagnostics/multi-overlap-mixed.js` remain for depth-2 qualification/mixed flows. Latest user runtime evidence before depth-N rollout: joesguns validated cleanly; screenshot showed phantasy, sigma-cosmetics, and joesguns `PROVEN2`, with mixed validation continuing through other candidates.

## Stock research baseline
Observation/history only; no autonomous trading yet. `lib/stock-history.js` retains all history going forward with `Date.now()` timestamps and explicit recorder gaps. `stocks/history-keeper.js` polls TIX every 200ms and persists only price-vector changes.

`stocks/dashboard.js` CANDLES uses true wall-clock lookback windows `5m/15m/30m/1h/4h` (1m removed). Mapping is approximately 5m→30s OHLC, 15m→1m, 30m→1m, 1h→1m, 4h→2m, so longer views naturally contain more candles. HISTORY · LINE provides `15m/1h/3h/6h/12h/24h/ALL`. Chart gap markers only render when a retained gap intersects the visible time window. Inactive chart/timeframe buttons use black borders; active uses blue accent.

Startup launches both main and stock dashboards.

### Startup GUI admission/parser fix
`startup.js` delegates GUI startup to low-RAM `/ui/dashboard-launcher.js`, which retries dashboard admission and reports required/free/max RAM on failure. A subsequent runtime report of `need 0.00 GB` revealed the actual issue was a parser error in `ui/views/validation.js` line 70. The nested landing-stream expression was rewritten into smaller `landingStream`/`landingBatch` functions in commit `391a58b19a2bf2ce814db2d9cf843fe611b3f7b4`. Runtime parser recheck is required after pulling.

## Prepper
`hacking/prepper.js` + `hacking/prepper-allocation.js`, model `DISTRIBUTED_TARGET_PREPPER_V3_ADAPTIVE_FOCUS`, Port 18. Adaptive money-first prep with bounded reserved RAM. Automatic validation borrowing is NOT implemented yet.

## Runtime ports
12 serialized batch, 14 timing events (one real coordinator only), 15 latest completed batch, 16 pipeline, 17 multi, 18 prepper, 19 rolling history, 20 global stress. Overlap/validation and stock research state are file-based.

## Immediate runtime test
Pull, confirm `run ui/dashboard.js` parses/opens, put controller fully STANDBY, then in Validation choose `PROVEN2+ SET · full-depth each`, leave Waves=2 / Hack=10% / Gap=200ms, and press `FULL DEPTH · PROVEN2+ SET`. Send final Validation screenshot/output or the first abnormal result. Do not manually rerun a failed depth before inspection.

## Priority
```text
DONE dynamic per-target arbitrary-depth evidence foundation
DONE configurable depth-N validator + individual FULL DEPTH TEST
DONE sequential PROVEN2+ SET full-depth coordinator + UI
NEXT runtime prove full-depth climb/set on representative targets
NEXT target-stream trajectory validation for tighter overlap
NEXT real MULTI marginal allocator using proven per-target depth
NEXT concentrated-vs-distributed selection + hack/timing tuner
NEXT idle prep-reserve auto-validation borrowing
NEXT feed learned profiles into AUTOMULTI + GUI
PARALLEL collect pre-4S stock history
LATER progression supervisor, stock trading, watchdog/UI refinements
```
