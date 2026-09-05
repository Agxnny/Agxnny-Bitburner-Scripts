# System Map

This maps the current major files to their responsibilities. For user-facing behavior see `FEATURES.md`; for active work see `HANDOFF.md`.

## Entrypoints and lifecycle

- `startup.js` — one-command startup; launches deferred GUI admission and quiet kickstart.
- `ui/dashboard-launcher.js` — starts/retries `ui/dashboard.js` and `stocks/dashboard.js`, reporting missing-script/RAM admission failures.
- `kickstart.js` — restores manual savings lock; runs planner/deploy/economic-target wait; starts prepper, batch history, stock history, then controller.
- `gitpull.js` / `gitpull-self-update.js` — clean GitHub deployment including safe updater handoff and UPDATED/unchanged distinction.

## Core hacking control

- `hacking/controller.js` — persistent target/mode coordinator for STANDBY/HGW/BATCH/PIPELINE/MULTI; consumes Port 13; publishes Port 1; owns safe mode transitions and safety-stop state.
- `hacking/dispatch.js` — execution dispatch support.
- `hacking/refresh.js` — strategic refresh/root/economy/cloud refresh coordination after relevant runtime events.
- `hacking/planner.js` — network, execution-host, and target planning; Port 2.
- `hacking/tactical-planner.js` / `hacking/thread-plan.js` / `lib/threads.js` — expensive action/thread calculations kept out of the persistent controller.
- `hacking/targets.js` / `lib/targets.js` — target ranking/eligibility helpers and diagnostics.
- `hacking/telemetry.js` / `lib/telemetry.js` — hack/income telemetry.

## Economy and progression

- `hacking/economy-planner.js` — current progression/economy state; Port 7.
- `hacking/economy-targets.js` — adaptive economic target and desired-money strategy selection; Port 8 and selected planner strategy.
- `lib/progression.js` — progression advisor foundation; current builders cover home RAM, cloud-server purchase, and cloud-server upgrade.
- `network/cloud-buy.js` — executes supported advisor-selected cloud capacity actions after affordability and manual-lock checks; Port 10.
- `economy/manual-goal.js` — terminal interface for persistent user savings/spending lock; Port 11 plus `/data/manual-money-goal.txt`.

## Preparation

- `hacking/prepper.js` — persistent adaptive distributed prepper; scans eligible targets, reserves bounded remote RAM, publishes Port 18.
- `hacking/prepper-allocation.js` — pure/advisory focus and ETA calculations; compares concentration widths and supports multiple reserved hosts per target.
- `lib/execution.js` — remote execution pool, thread distribution, home reserve, and exclusion of fresh prep-reserved hosts.

## Synchronized batch stack

- `hacking/batch-runner.js` — real serialized one-shot HWGW; Port 12; whole-batch reservation and recovery/timing telemetry.
- `hacking/batch-scheduler.js` — single-target planning/admission simulator; no workers; Port 16.
- `hacking/pipeline-runner.js` — real continuous same-target depth-2 HWGW; Port 14 consumer; Port 15 completion; Port 16 live state.
- `hacking/batch-history.js` — accepts new Port 15 completions and maintains Port 19 rolling safety history.
- `lib/batch-allocation.js` — shared prepared batch template, batch construction, host/time calendar, reservation and scoring helpers.
- `lib/batch-history.js` — rolling history model/clean criteria.

## Multi-target stack

- `hacking/multi-target-scheduler.js` — one-shot planning-only global allocator; no workers.
- `hacking/multi-target-sim.js` — persistent planning-only global admission simulation.
- `hacking/multi-target-runner.js` — real finite multi-target executor; shared calendar, JIT dispatch, one Port 14 consumer, Port 17 state; current same-target production cap 1.
- `lib/multi-target-ranking.js` — shared MONEY/BALANCED/XP ranking source selection.
- `diagnostics/multi-target-stress.js` — prep-aware progressive real global-concurrency stress test; Port 20.
- `lib/multi-stress-evidence.js` — durable `/data/multi-stress-evidence.txt` global proof.

## Same-target overlap validation

- `lib/multi-overlap-evidence.js` — durable V2 per-target/per-depth evidence in `/data/multi-overlap-evidence.txt`.
- `lib/multi-overlap-policy.js` — separates historical pipeline qualification from dedicated production overlap proof.
- `lib/multi-target-tuning.js` — depth/hack/gap candidate ladder and target tuning profile helpers.
- `lib/overlap-validation-state.js` — file-based live validation telemetry transport.
- `diagnostics/multi-overlap-advisor.js` — read-only overlap qualification/proof report.
- `diagnostics/multi-overlap-validate.js` — legacy dedicated real depth-2 validator.
- `diagnostics/multi-overlap-mixed.js` — sequential prepared-target depth-2 qualification.
- `diagnostics/multi-depth-validate.js` — configurable real same-target depth-N validator.
- `diagnostics/multi-full-depth-test.js` — climbs one target above its current proven depth until failure/resource ceiling.
- `diagnostics/multi-full-depth-set.js` — sequential full-depth climb for all current planner PROVEN2+ targets.

## AUTOMULTI foundation

- `lib/automulti-decision.js` — pure scenario chooser using possible/proven/effective global depth.
- `lib/automulti-live.js` — builds live scenarios/rankings for the decision engine.
- `hacking/automulti-controller.js` — supervisory ASSESS/RUN/OBSERVE/ADAPT loop with optional global stress validation; does not own Port 14.
- `diagnostics/automulti-advisor.js` — read-only AUTO recommendation.

## Network

- `network/root.js` — tool discovery/rooting; Port 9.
- `network/deploy.js` — deploy managed worker/support files and services.
- `network/sync.js` — synchronize deployed files after topology/capacity changes.
- `network/inspect.js` — manual network report.
- `lib/network.js` / `lib/deployment.js` — shared discovery/deployment helpers.

## Main GUI

- `ui/dashboard.js` — single React root, seven tabs, header/footer, async state/action loop.
- `ui/state.js` — cached port/file/process snapshot, including actual validation process activity.
- `ui/actions.js` — plain-JS UI fields/requests and async Netscript action bridge.
- `ui/styles.js`, `ui/components/format.js`, `ui/components/layout.js` — shared presentation helpers.
- `ui/views/overview.js` — hero metrics, generic execution controls, health, workers.
- `ui/views/targets.js` — target override, strategy, prep progress, rankings.
- `ui/views/economy.js` — savings lock, cash/progression/cloud state.
- `ui/views/batch.js` — serialized/pipeline/MULTI controls and timing telemetry.
- `ui/views/validation.js` — qualification/full-depth controls and durable evidence display.
- `ui/views/network.js` — network/root/execution-host view.
- `ui/views/diagnostics.js` — health verdict, tests/diagnostics, state ages/safety.

React callbacks must remain Netscript-free.

## Stock research

- `stocks/history-keeper.js` — 200 ms TIX polling, change-only historical persistence, 1 s heartbeat; no trading.
- `lib/stock-history.js` — retained wall-clock history, gaps, series/stats, current market snapshot.
- `stocks/candles.js` — fixed wall-clock OHLC bucket construction without bridging gaps.
- `stocks/dashboard.js` / `stocks/styles.js` — active Market Lab with candle/history views and portfolio display.
- `ui/stocks.js` / `stocks/terminal.js` — older isolated placeholders; not the active Market Lab.

## Diagnostics

- `diagnostics/test.js` / `test-launcher.js` / `dashboard.js` — smoke/function-test infrastructure.
- `diagnostics/mem-audit.js` — managed script RAM audit.
- `diagnostics/income.js` — income report.
- `diagnostics/economy-targets.js` — economic selection report.
- `diagnostics/progression.js` — progression advisor report.
- `diagnostics/validation-dashboard.js` — standalone validation display; integrated Validation tab is preferred.

## Boundaries to preserve

```text
planner != controller
controller != scheduler math
GUI != hacking logic
advisor != spender
telemetry != decision logic
workers != strategy
global proof != target-local proof
stock research != hacking control plane
```
