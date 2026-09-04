// Progression advisor foundation.
//
// Candidate builders are intentionally independent. New progression options can
// be added without changing consumers: each builder emits the same schema and
// rankCandidates decides which goal currently looks best.

const BASE_HOME_RAM_COST_PER_GB = 32_000;
const HOME_RAM_COST_GROWTH = 1.58;
const DEFAULT_CLOUD_SERVER_RAM_GB = 8;

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
 * Build the current advisory recommendation from independently generated
 * progression candidates.
 *
 * @param {NS} ns
 * @param {object|null} telemetry
 */
export function buildProgressionAdvice(ns, telemetry) {
    const context = buildContext(ns, telemetry);
    const candidates = [
        buildHomeRamCandidate(context),
        buildCloudServerCandidate(ns, context),
    ].filter(Boolean);

    const ranked = rankCandidates(candidates);
    const selected = ranked[0] ?? buildObservationFallback(context);

    return {
        version: 2,
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
    const addedRam = nextRam - currentRam;
    const cost = getNextHomeRamUpgradeCost(currentRam);

    return makeRamCandidate({
        id: `home-ram-${currentRam}-to-${nextRam}`,
        type: GoalType.HOME_RAM,
        title: `Upgrade home RAM ${currentRam}GB -> ${nextRam}GB`,
        context,
        cost,
        addedRam,
        currentValue: currentRam,
        targetValue: nextRam,
        roleWeight: 1.5,
        priority: 100,
        reason: "Home RAM expands the control node, leaving more room for persistent automation and local fallback work.",
        readyReason: "The next home RAM upgrade is affordable now.",
        recommendation: "Focus on cash generation for the home RAM upgrade while it remains the best-ranked progression value.",
        readyRecommendation: "Buy the home RAM upgrade when convenient.",
        model: {
            costModel: "HOME_RAM_BN1_V1",
            valueModel: "RAM_PER_DOLLAR_V1",
            assumptions: ["BitNode 1 HomeComputerRamCost multiplier = 1", "Home RAM receives a 1.5x control-node utility weight"],
        },
    });
}

/**
 * Add one execution-pool expansion candidate using Bitburner v3's Cloud API.
 * Later this builder can branch into NEW_SERVER vs UPGRADE_SERVER candidates.
 *
 * @param {NS} ns
 * @param {object} context
 */
function buildCloudServerCandidate(ns, context) {
    const owned = ns.cloud.getServerNames();
    const limit = Math.max(0, Number(ns.cloud.getServerLimit()) || 0);
    if (owned.length >= limit) return null;

    const ram = Math.min(DEFAULT_CLOUD_SERVER_RAM_GB, Math.max(1, Number(ns.cloud.getRamLimit()) || DEFAULT_CLOUD_SERVER_RAM_GB));
    const cost = Math.max(0, Number(ns.cloud.getServerCost(ram)) || 0);
    if (!(cost > 0)) return null;

    return makeRamCandidate({
        id: `cloud-server-new-${ram}gb`,
        type: GoalType.PURCHASED_SERVER,
        title: `Buy ${ram}GB cloud server`,
        context,
        cost,
        addedRam: ram,
        currentValue: owned.length,
        targetValue: owned.length + 1,
        roleWeight: 1.0,
        priority: 90,
        reason: `A new ${ram}GB cloud server adds dedicated worker RAM to the distributed execution pool (${owned.length}/${limit} owned).`,
        readyReason: `A new ${ram}GB cloud server is affordable now and would immediately expand the execution pool.`,
        recommendation: "Save for this cloud server if its execution-RAM value outranks the home upgrade.",
        readyRecommendation: "Buy the cloud server when convenient if the advisor continues to rank it first.",
        model: {
            costModel: "CLOUD_API_V3",
            valueModel: "RAM_PER_DOLLAR_V1",
            assumptions: ["New cloud server RAM is valued as execution-pool capacity", `Starter comparison size = ${ram}GB`],
        },
        metadata: {
            ownedServers: owned.length,
            serverLimit: limit,
            serverRam: ram,
        },
    });
}

function makeRamCandidate(options) {
    const remaining = Math.max(0, options.cost - options.context.cash);
    const ready = remaining <= 0;
    const etaSeconds = options.context.incomePerSecond > 0 ? remaining / options.context.incomePerSecond : Infinity;
    const rawRamPerDollar = options.cost > 0 ? options.addedRam / options.cost : 0;
    const valueScore = rawRamPerDollar * options.roleWeight * 1e6;

    return {
        id: options.id,
        type: options.type,
        title: options.title,
        mode: ready ? ProgressionMode.GOAL_READY : ProgressionMode.MONEY_FOCUS,
        ready,
        cost: options.cost,
        currentCash: options.context.cash,
        remaining,
        etaSeconds,
        incomePerSecond: options.context.incomePerSecond,
        incomeSource: options.context.incomeSource,
        currentValue: options.currentValue,
        targetValue: options.targetValue,
        addedRam: options.addedRam,
        unit: "GB",
        priority: options.priority,
        valueScore,
        valueMetrics: {
            addedRam: options.addedRam,
            ramPerMillionDollars: rawRamPerDollar * 1e6,
            roleWeight: options.roleWeight,
        },
        reason: ready ? options.readyReason : options.reason,
        recommendation: ready ? options.readyRecommendation : options.recommendation,
        model: options.model,
        metadata: options.metadata ?? {},
    };
}

/** @param {object[]} candidates */
function rankCandidates(candidates) {
    return [...candidates].sort((a, b) => {
        // Readiness matters, but among goals in the same readiness state we want
        // value to drive the recommendation rather than a permanently hardcoded
        // HOME_RAM priority.
        if (a.ready !== b.ready) return a.ready ? -1 : 1;
        return Number(b.valueScore ?? 0) - Number(a.valueScore ?? 0)
            || Number(b.priority ?? 0) - Number(a.priority ?? 0)
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
        model: { costModel: "NONE", valueModel: "NONE", assumptions: [] },
    };
}

/** Mirrors Bitburner's home RAM cost formula for BitNode 1. */
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
