# Development Roadmap

This roadmap is dependency/risk ordered. The current focus is proving and then safely consuming heterogeneous same-target overlap evidence.

## Completed foundations

### Core automation
- remote-only H/G/W execution pool;
- planner, economic target selector, tactical planner, telemetry, rooting/deployment;
- controller modes STANDBY/HGW/BATCH/PIPELINE/MULTI;
- safe-boundary mode transitions;
- manual target override and persistent savings/spending lock.

### Batch correctness and observability
- synchronized serialized HWGW;
- corrected grow-security compensation;
- whole-batch host/time reservation;
- timing events with planned/actual landing data;
- recovery/order/missing/drift/spacing safety checks;
- Port 15 latest completion and Port 19 rolling real history.

### Pipeline
- real continuous same-target depth-2 executor;
- central Port 14 routing by batch id;
- safe drain on mode switch;
- controller integration and GUI telemetry.

### Multi-target
- shared global host/time calendar;
- planning-only one-shot allocator and persistent simulator;
- real finite multi-target executor with configurable global depth;
- controller-managed repeated finite waves;
- MONEY/BALANCED/XP profiles;
- prep-aware progressive global stress test;
- durable global stress evidence.

### Preparation
- adaptive distributed prepper;
- full eligible-target scans;
- bounded multi-host reserve;
- money-first GROW then security cleanup;
- adaptive concentration vs spread;
- same-target multi-host prep;
- full-prep ETA telemetry and GUI card.

### Target-local overlap validation
- durable V2 evidence keyed by target and depth;
- depth ladder 2–12;
- legacy depth-2 qualification;
- configurable real depth-N validator;
- individual automatic full-depth climb;
- sequential PROVEN2+ set full-depth climb;
- Validation tab with live/evidence visibility.

### GUI and stock research
- modular seven-tab main dashboard with Netscript-free React callbacks;
- diagnostics health/test controls;
- separate stock Market Lab;
- all-new stock history retained with wall-clock timestamps/gaps;
- true 5m/15m/30m/1h/4h candlesticks plus full-history line view;
- stock trading remains disabled.

## Current stage — runtime prove heterogeneous depth

Run individual and PROVEN2+ set full-depth validation across representative prepared targets. Confirm:

- depth evidence persists independently;
- higher failure preserves lower proof;
- RAM ceiling is neutral rather than destructive;
- timing/recovery failure is classified correctly;
- set coordinator continues across targets where appropriate;
- GUI process/telemetry state remains accurate.

Exit condition: enough representative runtime evidence to trust the depth-N validator as the admission authority for the next production experiment.

## Next — target-stream trajectory validation

Deep production overlap cannot rely only on each batch's final target state because later hacks can land before earlier batches are finalized.

Add target-stream validation that checks:
- complete global/target landing sequence;
- expected money/security trajectory or steady-state envelope;
- recovery margin through the stream;
- missing/order/drift/spacing failures;
- clean termination and final recovery.

Exit condition: a validator can safely judge tighter interleaved depth >2 without false failures from legitimate later-batch effects.

## Next — heterogeneous production MULTI

Replace the current production uniqueness guard with evidence-gated target-local admission.

Requirements:
- production uses `provenDepth`, never candidate depth;
- global stress proof remains a separate ceiling;
- batch opportunities are ranked marginally, not one slot per target;
- scheduler can produce A×5 + B×2 + C×1 when evidence/value/capacity justify it;
- target-local failure can pause/fallback that target without unnecessarily erasing other target proof;
- system-wide reservation/timing corruption still triggers global safety stop.

## Next — concentrated vs distributed optimization

Evaluate portfolios such as SINGLE HEAVY, DUAL, and DISTRIBUTED using:
- expected and realized $/sec;
- $/RAM-second;
- global in-flight slot cost;
- target-local recovery margin;
- timing pressure and proof confidence.

Repeated batches on a premium target should win only while their marginal efficiency beats opening/adding a lower-value target.

## Next — parameter tuning

Add bounded, evidence-aware tuning of:
- overlap depth;
- hack fraction;
- stage gap / batch interval.

Use conservative sweeps/hill-climb around the last proven operating point. Higher failed experiments must fall back to the last proven configuration and enter a cooldown instead of being immediately retried.

## Next — continuous refill and AUTOMULTI integration

Move beyond repeated finite waves toward a continuously filled global calendar. AUTOMULTI becomes the supervisory policy choosing objective and safe learned profiles while the scheduler owns admission/timing mechanics.

Expose possible/proven/effective target/global settings in the GUI.

## Next — idle prep-reserve validation borrowing

When the prepper has no real work, allow a low-priority auto-validator to borrow unused prep-reserve capacity. Prep has first claim: stop new validation admission when prep demand returns and let already-admitted validation drain safely. Add debounce to avoid thrashing.

Prioritize valuable prepared/unvalidated targets, then depth promotion, then hack/timing tuning.

## Later — progression supervisor

Build a supervisory progression graph for backdoors, faction invitations/work, reputation, augmentation money/purchases, and reset/install decisions. Specialized subsystems should execute tasks; progression policy should not be mixed into the hacking scheduler.

## Later — stock trading

Continue collecting pre-4S history. Future stock modules should separate signals, allocation, trading, and supervision; support long/short symmetrically; respect the global savings hierarchy; and only enable autonomous orders after deliberate validation.

## Deferred

- automatic worker watchdog termination until deep scheduler timing is stable;
- nonessential UI polish that does not improve observability or control safety.

## Documentation policy

After major behavior/architecture changes update the root README, `FEATURES.md`, `HANDOFF.md`, and whichever reference document owns the changed contract. Avoid leaving old milestone text that describes already-completed stages as future work.
