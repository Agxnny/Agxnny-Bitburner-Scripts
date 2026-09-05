# Feature Reference

This is the readable inventory of what the repository does **today**. For active development state and the next risky change, read `HANDOFF.md`. Source code wins if a document ever disagrees with it.

## Startup and update flow

- `startup.js` is the normal one-command entrypoint. It delegates GUI startup to `ui/dashboard-launcher.js` so startup RAM is released before the dashboards are admitted, then spawns the quiet kickstart chain.
- `ui/dashboard-launcher.js` starts both the main Control Plane and the stock Market Lab, retries admission, and reports missing-script/RAM information if a dashboard cannot start.
- `kickstart.js` restores the persisted manual savings lock, refreshes planner state, deploys execution files, waits for economic target selection, starts the adaptive prepper, batch-history collector, stock-history recorder, and finally the controller.
- `gitpull.js` performs a clean repository-managed pull and distinguishes `UPDATED`, `REPLACED (unchanged)`, `ADDED`, and stale-file removal. `gitpull-self-update.js` safely hands off updates to the updater itself.

## Production execution modes

The controller supports five modes. Mode changes are scheduling barriers: admitted work drains to a safe boundary before the new mode takes over.

| Mode | Function |
| --- | --- |
| `STANDBY` | No production H/G/W admission. Background prepper may still work. Required for real overlap validation. |
| `HGW` | Normal sequential hack/grow/weaken automation using remote workers. |
| `BATCH` | Serialized synchronized HWGW; one complete batch at a time. |
| `PIPELINE` | Continuous same-target synchronized HWGW with hard live depth 2. |
| `MULTI` | Controller-managed finite multi-target waves. Global live depth is configurable, but production still allows only one live batch per target. |

`hacking/controller.js` owns target/mode orchestration and Port 13 requests. Expensive tactical calculations remain in short-lived planners instead of bloating the persistent controller.

## Target selection and economy

- `hacking/planner.js` discovers the network, execution hosts, and target rankings.
- `hacking/economy-targets.js` evaluates desired-money strategies at 25/40/55/70/85/100%, penalizes long prep, uses remote-only capacity, forces small servers to full preparation, and can filter servers that are trivial relative to player cash when better targets exist.
- `hacking/tactical-planner.js` computes action/thread plans for the controller.
- The Targets GUI supports automatic selection and explicit manual hostname override.

## Adaptive distributed prepper

`hacking/prepper.js` + `hacking/prepper-allocation.js` maintain the eligible target universe independently of production mode.

Current behavior:
- readiness threshold: money >=99.5%, security <= minimum +0.05;
- bounded remote RAM reserve: default 12.5%, minimum 64 GB, maximum 1024 GB;
- refreshes the eligible target universe every 15 seconds;
- money-first policy: GROW is prioritized before security cleanup;
- adaptive concentration: the allocator can focus several reserved hosts on fewer targets when that is faster than spreading work thinly;
- multiple prep jobs may run for the same target across different reserved hosts;
- production excludes fresh prep-reserved hosts;
- Port 18 publishes prepared/below-max counts, active jobs, reserve usage, target states, and full-prep ETA estimates.

The Targets tab exposes a "Servers below max money" table with money %, state, ETA, and host/security information.

## Synchronized batching

All synchronized batches use H → W1 → G → W2 landing order and remote workers. `lib/batch-allocation.js` provides shared batch-template and host/time reservation primitives.

- `hacking/batch-runner.js`: one serialized real HWGW batch, whole-batch reservation before launch, Port 12 state.
- `hacking/batch-scheduler.js`: planning/admission simulator for single-target pipelining; launches no workers.
- `hacking/pipeline-runner.js`: real depth-2 same-target executor. It is the sole Port 14 consumer while active, publishes completion to Port 15 and live state to Port 16, and drains safely on mode changes.
- `hacking/batch-history.js`: watches new Port 15 completions and maintains rolling real safety history on Port 19 without replaying stale completions after restart.

Healthy batch criteria used by the safety system are: correct order, no missing timing jobs, final money >=99.5%, security <= minimum +0.05, maximum absolute landing drift <=150 ms, and minimum landing spacing >=75 ms.

## Multi-target system

There are separate planning, simulation, production, stress-evidence, and target-local overlap layers.

- `hacking/multi-target-scheduler.js`: one-shot planning-only global allocator. It never launches workers.
- `hacking/multi-target-sim.js`: persistent planning-only admission simulation using the shared calendar and overlap policy.
- `hacking/multi-target-runner.js`: real finite multi-target executor. It uses one shared host/time calendar, JIT dispatch, one Port 14 consumer, and configurable global depth 2–12. **Current production same-target depth remains hard-capped at 1.**
- MONEY/BALANCED/XP profiles change candidate scoring. XP remains a proxy rather than an exact experience model.
- `diagnostics/multi-target-stress.js` progressively tests global distinct-target concurrency, waits for prep when appropriate, and can resume from durable evidence.
- `lib/multi-stress-evidence.js` persists global concurrency proof separately from target-local overlap proof.

Global concurrency proof and target-local overlap proof are intentionally independent. Extra RAM never grants unproven concurrency.

## Same-target overlap validation and learning

Target-local evidence is durable in `/data/multi-overlap-evidence.txt` using `MULTI_TARGET_OVERLAP_EVIDENCE_V2_DYNAMIC_DEPTH`.

For every target and tested depth it retains clean/failed/consecutive waves, proof status, drift, spacing, hack fraction, stage gap, batch interval, status/reason, and timestamps. A higher-depth failure does not erase lower proven depths.

Validation tools:
- `diagnostics/multi-overlap-validate.js`: legacy real depth-2 validator.
- `diagnostics/multi-overlap-mixed.js`: sequential depth-2 qualification for prepared target sets.
- `diagnostics/multi-depth-validate.js`: configurable real target/depth validator.
- `diagnostics/multi-full-depth-test.js`: climbs one target through the configured ladder above its current proof until failure/resource ceiling.
- `diagnostics/multi-full-depth-set.js`: snapshots planner targets already at PROVEN2+ and full-depth tests them sequentially.
- `lib/multi-target-tuning.js`: depth ladder 2–12 plus candidate hack fractions and stage gaps for the future tuner/allocator.

The Validation tab exposes legacy qualification, individual full-depth testing, and `PROVEN2+ SET · full-depth each`. This is designed to learn heterogeneous ceilings such as target A depth 5 while target B remains depth 2.

**Important:** this evidence is currently validation evidence. Production MULTI does not yet consume target-local depth >1.

## AUTOMULTI foundation

`lib/automulti-decision.js`, `lib/automulti-live.js`, `lib/multi-target-ranking.js`, and `hacking/automulti-controller.js` implement the existing supervisory AUTO foundation. It can assess scenarios, run/observe/adapt finite MULTI waves, and optionally park production for global stress validation.

It is not yet the final dynamic same-target scheduler: the next production design must combine proven target-local depths with global proof, marginal batch opportunity scoring, concentrated-vs-distributed portfolio comparison, and safer target-stream recovery validation.

## Economy, progression, and spending safety

- `lib/progression.js` advises on current progression opportunities. Current implemented candidate builders include home RAM, new cloud server, and cloud-server upgrade; enum/foundation space exists for future goal families.
- `network/cloud-buy.js` executes an advisor-selected cloud purchase/upgrade only after rechecking live affordability.
- `economy/manual-goal.js` and the Economy tab provide a persistent user savings target. While active, automated cloud spending is locked.
- The Economy tab shows cash, goal/remaining amount, savings lock, cloud action, and next automatic progression goal.

## Network automation

- `network/root.js`: discovers owned port tools and roots newly eligible servers.
- `network/deploy.js`: copies managed execution/support files to remote hosts and starts required remote services.
- `network/sync.js`: refreshes deployed files after topology/capacity changes.
- `network/inspect.js`: manual network inspection.
- The Network tab shows discovered/rooted counts, execution hosts, port tools, and remote RAM usage.

## Main Control Plane GUI

`ui/dashboard.js` is a single-mounted React shell with seven tabs:

| Tab | Main purpose |
| --- | --- |
| Overview | Target/income/RAM/execution hero metrics, STANDBY/HGW/resume controls, health, active workers. |
| Targets | Manual/auto target control, selected strategy, prep progress, economic rankings. |
| Economy | Manual savings lock, progression and cloud-capacity state. |
| Batch | Serialized batch, pipeline, real MULTI controls/activity, completion timing diagnostics. |
| Validation | Depth-2 qualification, individual full-depth tests, PROVEN2+ set tests, durable per-depth evidence. |
| Network | Discovery/rooting/remote execution-host status. |
| Diagnostics | Overall health verdict, useful test buttons, diagnostic activity, state ages, safety notes. |

All normal cards/hero cards are collapsible. React callbacks never call Netscript: they mutate/queue plain JS state in `ui/actions.js`; the async dashboard loop performs all Netscript I/O. This rule exists to keep tab switching responsive and prevent callback-driven script termination.

## Diagnostics

The GUI exposes smoke tests, progression test, memory audit, income, economy-target, progression, and target-ranking diagnostics. Additional terminal tools include overlap advisors/validators, AUTOMULTI advisor, global stress test, validation dashboard, and general diagnostics/test launchers.

`diagnostics/mem-audit.js` should be used after meaningful architecture changes instead of estimating RAM by inspection.

## Stock research / Market Lab

Stock research is **observation-only**. No autonomous orders are placed.

- `stocks/history-keeper.js` polls TIX every 200 ms, writes market heartbeat state, and persists history only when the price vector actually changes.
- `lib/stock-history.js` uses wall-clock `Date.now()` timestamps, retains all new history, records recorder gaps, and avoids fabricating missing paths.
- `stocks/dashboard.js` is the active Market Lab started by `startup.js`.
- Candlestick views are true wall-clock lookbacks: 5m, 15m, 30m, 1h, 4h. OHLC buckets are 30s/1m/1m/1m/2m respectively, so longer views naturally show more candles.
- `HISTORY · LINE` supports 15m/1h/3h/6h/12h/24h/ALL.
- Gaps are shown only when they intersect the visible chart window; historical gaps outside the selected range are not drawn.
- Candle direction is literal close vs open; wick high/low uses observed prices only.
- Portfolio/position state is displayed, but trading remains disabled while the pre-4S baseline is collected.
- `ui/stocks.js` and `stocks/terminal.js` are older isolated placeholders and are not the active Market Lab.

## Persistent files

Important durable files on home:

```text
/data/manual-money-goal.txt          user savings/spending lock
/data/multi-stress-evidence.txt      global distinct-target concurrency evidence
/data/multi-overlap-evidence.txt     per-target/per-depth overlap evidence
/data/multi-overlap-validation-state.txt live validation telemetry
/data/automulti-controller-state.txt AUTOMULTI supervisor state
/data/stock-history.txt              retained stock price history
/data/stock-market-state.txt         current stock market/portfolio heartbeat
```

## Safety boundaries that must remain true

1. Home is the control/UI plane; normal H/G/W workers use remote execution capacity.
2. Exactly one real synchronized coordinator consumes Port 14 at a time.
3. Production never exceeds durable proof merely because RAM is available.
4. Per-target overlap proof and global distinct-target concurrency proof are separate.
5. Higher-depth validation failure preserves lower valid proof.
6. Prep-reserved capacity is excluded from production while the prepper heartbeat is fresh.
7. Manual savings lock remains authoritative over automated spending.
8. React callbacks remain Netscript-free.
9. Stock trading remains disabled until a deliberate trading engine is implemented and reviewed.
