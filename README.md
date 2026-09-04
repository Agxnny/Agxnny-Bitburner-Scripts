# Agxnny Bitburner Scripts

A from-scratch Bitburner automation project built around an adaptive HGW system, shared runtime state, a future persistent dashboard, and progression guidance.

## Design goals

- Keep `hack`, `grow`, and `weaken` workers minimal.
- Keep target selection, strategy tuning, thread calculation, scheduling, and RAM allocation out of the workers.
- Produce structured runtime state from the beginning so a persistent dashboard can be added without rewriting the hacking engine.
- Allow strategies to be tuned rather than hardcoded: grow target %, hack %, prep rules, RAM efficiency, and total throughput can all become optimization inputs.
- Track predicted versus actual HGW performance.
- Treat the full RAM pool as a resource that can eventually be optimized across multiple targets.
- Provide player guidance such as port-opening tools, hacking-level gates, home RAM, purchased servers, server upgrades, or saving money.

## Planned layers

1. **Workers** — perform one assigned `hack`, `grow`, or `weaken` action.
2. **Network / capability discovery** — know reachable servers, rooting requirements, player tools, and available RAM.
3. **Target analyzer** — evaluate candidate targets and candidate strategies.
4. **Scheduler** — allocate threads/RAM and launch workers.
5. **Runtime state / telemetry** — publish target phases, progress, money, EXP, RAM usage, predictions, and decisions.
6. **Guidance engine** — evaluate progression blockers and recommend a useful next player action.
7. **Dashboard** — one persistent control-centre window that reads shared state rather than owning game logic.

See [`docs/architecture.md`](docs/architecture.md) for the working design.

## Initial repository layout

```text
hacking/
  controller.js
  workers/
    hack.js
    grow.js
    weaken.js
lib/
  state.js
docs/
  architecture.md
```

The first implementation will stay intentionally simple. More advanced strategy tuning and batching will be layered onto the same interfaces instead of replacing them.
