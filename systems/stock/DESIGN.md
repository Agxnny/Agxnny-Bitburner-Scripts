# Stock System — Design

## Authority

This document refines the root repository `DESIGN.md` for the Stock System. The root `DESIGN.md` remains authoritative if the two conflict.

Exact signal generation, sizing, entry/exit rules, risk thresholds, and manipulation strategy remain intentionally deferred until implementation and validation.

## Purpose

> Manage stock-market capital to generate profit while respecting scheduler capital policy and yielding decision authority when another approved subsystem temporarily controls a symbol or strategy.

## Ownership Boundary

The Stock System owns normal autonomous trading decisions and trade execution behavior.

It owns:

- market opportunity evaluation;
- long/short strategy decisions;
- position sizing within granted capital;
- position management;
- trade execution;
- reconciliation with observed portfolio state;
- stock telemetry and validation.

The Scheduler owns global capital availability and cross-system authority policy.

## Internal Structure

```text
Stock System
├── Market State Consumer
├── Opportunity Evaluator
├── Position Manager
├── Long Strategy
├── Short Strategy
├── Trade Executor
├── Capital Request / Allocation Interface
├── Authority-Aware Symbol Controller
└── Telemetry / Validation
```

## Shared-State Dependency

The Stock System should consume normalized market and portfolio state from Data Collection when sufficiently fresh and valid.

It must not duplicate expensive acquisition without an explicit latency/correctness reason.

## Capital Contract

Stock may open or enlarge positions only within capital explicitly available under scheduler policy.

Conceptually:

```text
Stock → capital demand / opportunity summary
Scheduler → allocation / permission
Stock → select and execute trades within allocation
```

The Scheduler must not choose symbols or implement trading strategy.

## Symbol Authority

By default, Stock owns autonomous decision authority for stock symbols.

Another approved subsystem, such as future Stock Manipulation, may temporarily claim authority over a symbol through the global authority mechanism.

While a symbol is externally controlled:

- normal Stock strategy must not autonomously buy, sell, short, cover, or rebalance it;
- the authority holder may issue explicit directed actions through the normal Stock execution path;
- executing a directed action does not return autonomous authority to Stock.

When authority returns, Stock must refresh market and position state before resuming autonomous decisions.

> Authority over a symbol governs autonomous decision-making, not necessarily execution capability.

## Capability-Aware Strategy

Unavailable capabilities should disable or block only the affected strategy where practical. For example, lack of shorting capability should not fail the entire Stock System if long trading remains valid.

## Operating Modes

### Low-RAM

Low-RAM behavior should use simple, low-overhead evaluation, conservative capital usage, and reduced refresh frequency. The system may be disabled or constrained when its overhead or capital use threatens the protected hacking-income baseline.

### Full Stack

Full Stack may support multiple positions, long/short operation, more frequent evaluation, dynamic sizing, richer capital-efficiency analysis, authority transfers, and future manipulation coordination where justified.

## Failure Behavior

Rejected trades, stale market state, changed prices, or changed positions must trigger state refresh and re-evaluation rather than blind retry.

Observed portfolio state is authoritative after trade attempts and manual player intervention.

## Telemetry

Potential telemetry includes:

- allocated capital;
- invested capital;
- reserved cash;
- long exposure;
- short exposure;
- realized P&L;
- unrealized P&L;
- active positions;
- externally controlled symbols;
- recent trades;
- rejected/failed trades;
- strategy health.

## Validation Expectations

Validation should prove that:

- trades remain within granted capital policy;
- externally controlled symbols are not autonomously traded;
- directed actions do not restore autonomous authority;
- portfolio state is reconciled after execution or manual intervention;
- unavailable capabilities degrade only affected strategies;
- Low-RAM and Full-Stack behavior respect their resource goals.

## Deferred Implementation Details

Intentionally deferred:

- opportunity scoring/signals;
- position sizing formulas;
- entry/exit thresholds;
- diversification/exposure limits;
- realized/unrealized risk thresholds;
- exact closing-position capital rules;
- stock-manipulation algorithms;
- exact authority message schema.
