// Progression advisor foundation.
//
// This module is intentionally candidate-based. Each future progression option
// (home RAM, purchased servers, port openers, programs, etc.) can contribute one
// or more candidate objects. The advisor ranks candidates; rendering and buying
// remain separate concerns.

const BASE_HOME_RAM_COST_PER_GB = 32_000;
const HOME_RAM_COST_GROWTH = 1.58;

export const ProgressionMode = Object.freeze({
    MONEY_FOCUS: "MONEY_FOCUS",
    GOAL_READY: "GOAL_READY",
    OBSERVING: "OBSERVING",
});

export const GoalType = Object.freeze({
    HOME_RAM: "HOME_RAM",
    PURCHASED_SERVER: "PURCHASED_SERVER",
    PORT_OPENER: "PORT_OPENER",
    SAVE: "SAVE",
});

/**
 * Build the current advisory recommendation from a set of candidates.
 * Additional candidate builders can be appended without changing consumers.
 *
 * @param {NS} ns
 * @param {object|null} telemetry
 */
export function buildProgressionAdvice(ns, telemetry) {
    const context = buildContext(ns, telemetry);
    const candidates = [
        buildHomeRamCandidate(context),
    ].filter(Boolean);

    const ranked = rankCandidates(candidates);
    const selected = ranked[0] ?? buildObservationFallback(context);

    return {
        version: 1,
        updatedAt: Date.now(),
        mode: selected.ready ? ProgressionMode.GOAL_READY : selected.mode,
        selected,
        candidates: ranked,
        context,
    };
}

/** @param {NS} ns @param {object|null} telemetry */
function buildContext(ns, telemetry) {
    const cash = Math.max(0, Number(ns.getServerMoneyAvailable("home")) || 0);
    const homeRam = Math.max(0, Number(ns.getServerMaxRam("home")) || 0);
    const income = chooseObservedIncomeRate(telemetry);

    return {
        cash,
        homeRam,
        incomePerSecond: income.rate,
        incomeSource: income.source,
        telemetryHackEvents: Math.max(0, Number(telemetry?.hackEvents ?? 0)),
    };
}

/** @param {object} context */
function buildHomeRamCandidate(context) {
    if (context.homeRam <= 0) return null;

    const currentRam = context.homeRam;
    const nextRam = currentRam * 2;
    const cost = getNextHomeRamUpgradeCost(currentRam);
    const remaining = Math.max(0, cost - context.cash);
    const ready = remaining <= 0;
    const etaSeconds = context.incomePerSecond > 0 ? remaining / context.incomePerSecond : Infinity;

    return {
        id: `home-ram-${currentRam}-to-${nextRam}`,
        type: GoalType.HOME_RAM,
        title: `Upgrade home RAM ${currentRam}GB -> ${nextRam}GB`,
        mode: ready ? ProgressionMode.GOAL_READY : ProgressionMode.MONEY_FOCUS,
        ready,
        cost,
        currentCash: context.cash,
        remaining,
        etaSeconds,
        incomePerSecond: context.incomePerSecond,
        incomeSource: context.incomeSource,
        currentValue: currentRam,
        targetValue: nextRam,
        unit: "GB",
        priority: 100,
        valueScore: nextRam - currentRam,
        reason: ready
            ? "The next home RAM upgrade is affordable now."
            : "Home RAM is the control-node bottleneck; more RAM increases room for persistent automation and local fallback work.",
        recommendation: ready
            ? "Buy the home RAM upgrade when convenient."
            : "Focus on cash generation until the home RAM upgrade is affordable.",
        model: {
            costModel: "HOME_RAM_BN1_V1",
            assumptions: ["BitNode 1 HomeComputerRamCost multiplier = 1"],
        },
    };
}

/** @param {object[]} candidates */
function rankCandidates(candidates) {
    return [...candidates].sort((a, b) => {
        if (a.ready !== b.ready) return a.ready ? -1 : 1;
        return Number(b.priority ?? 0) - Number(a.priority ?? 0)
            || Number(b.valueScore ?? 0) - Number(a.valueScore ?? 0)
            || Number(a.cost ?? Infinity) - Number(b.cost ?? Infinity);
    });
}

/** @param {object} context */
function buildObservationFallback(context) {
    return {
        id: "observe",
        type: GoalType.SAVE,
        title: "Observe progression state",
        mode: ProgressionMode.OBSERVING,
        ready: false,
        cost: 0,
        currentCash: context.cash,
        remaining: 0,
        etaSeconds: Infinity,
        incomePerSecond: context.incomePerSecond,
        incomeSource: context.incomeSource,
        priority: 0,
        valueScore: 0,
        reason: "No actionable progression candidate is currently available.",
        recommendation: "Continue gathering telemetry.",
        model: { costModel: "NONE", assumptions: [] },
    };
}

/**
 * Mirrors Bitburner's home RAM cost formula for BitNode 1.
 * @param {number} currentRamGb
 */
export function getNextHomeRamUpgradeCost(currentRamGb) {
    const ram = Math.max(1, Number(currentRamGb) || 1);
    const upgrades = Math.log2(ram);
    return ram * BASE_HOME_RAM_COST_PER_GB * Math.pow(HOME_RAM_COST_GROWTH, upgrades);
}

/** @param {object|null} telemetry */
export function chooseObservedIncomeRate(telemetry) {
    const fiveMinute = Math.max(0, Number(telemetry?.incomePerSecond5m ?? 0));
    const oneMinute = Math.max(0, Number(telemetry?.incomePerSecond1m ?? 0));
    const lifetime = Math.max(0, Number(telemetry?.incomePerSecond ?? 0));

    if (fiveMinute > 0) return { rate: fiveMinute, source: "5m" };
    if (oneMinute > 0) return { rate: oneMinute, source: "1m" };
    if (lifetime > 0) return { rate: lifetime, source: "lifetime" };
    return { rate: 0, source: "none" };
}
