// Progression advisor foundation.
//
// Candidate builders are intentionally independent. New progression options can
// be added without changing consumers: each builder emits the same schema and
// rankCandidates decides which goal currently looks best.

const BASE_HOME_RAM_COST_PER_GB = 32_000;
const HOME_RAM_COST_GROWTH = 1.58;
const DEFAULT_CLOUD_SERVER_RAM_GB = 8;
const HOME_RAM_BASE_WEIGHT = 1.5;
const HOME_RAM_BELOW_THRESHOLD_WEIGHT = 3.0;
const HOME_CORE_RESERVE_GB = 1;
const HOME_CORE_SCRIPT_PATHS = Object.freeze([
    "/hacking/controller.js",
    "/hacking/tactical-planner.js",
]);

export const ProgressionMode = Object.freeze({
    MONEY_FOCUS: "MONEY_FOCUS",
    GOAL_READY: "GOAL_READY",
    OBSERVING: "OBSERVING",
});

export const GoalType = Object.freeze({
    HOME_RAM: "HOME_RAM",
    PURCHASED_SERVER: "PURCHASED_SERVER",
    CLOUD_SERVER_UPGRADE: "CLOUD_SERVER_UPGRADE",
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
        buildCloudServerUpgradeCandidate(ns, context),
    ].filter(Boolean);

    const ranked = rankCandidates(candidates);
    const selected = ranked[0] ?? buildObservationFallback(context);

    return {
        version: 4,
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
    const cloudServers = ns.cloud.getServerNames();
    const cloudServerLimit = Math.max(0, Number(ns.cloud.getServerLimit()) || 0);
    const cloudRamLimit = Math.max(0, Number(ns.cloud.getRamLimit()) || 0);
    const homeCore = buildHomeCoreRequirement(ns, homeRam);

    return {
        cash,
        homeRam,
        incomePerSecond: income.rate,
        incomeSource: income.source,
        telemetryHackEvents: Math.max(0, Number(telemetry?.hackEvents ?? 0)),
        homeCore,
        cloud: {
            servers: cloudServers,
            owned: cloudServers.length,
            serverLimit: cloudServerLimit,
            ramLimit: cloudRamLimit,
        },
    };
}

/**
 * Estimate the minimum home-RAM tier needed to comfortably host the core
 * controller + tactical planner together, while retaining a small reserve.
 * The threshold follows the game's power-of-two RAM tiers and automatically
 * adapts if either script's RAM cost changes later.
 */
function buildHomeCoreRequirement(ns, homeRam) {
    const scripts = HOME_CORE_SCRIPT_PATHS.map((path) => ({
        path,
        ram: Math.max(0, Number(ns.getScriptRam(path, "home")) || 0),
    }));
    const scriptRam = scripts.reduce((sum, script) => sum + script.ram, 0);
    const requiredRam = scriptRam + HOME_CORE_RESERVE_GB;
    const thresholdRam = nextPowerOfTwo(Math.max(1, requiredRam));

    return {
        scripts,
        scriptRam,
        reserveRam: HOME_CORE_RESERVE_GB,
        requiredRam,
        thresholdRam,
        belowThreshold: homeRam < thresholdRam,
    };
}

/** @param {object} context */
function buildHomeRamCandidate(context) {
    if (context.homeRam <= 0) return null;

    const currentRam = context.homeRam;
    const nextRam = currentRam * 2;
    const addedRam = nextRam - currentRam;
    const cost = getNextHomeRamUpgradeCost(currentRam);
    const belowCoreThreshold = context.homeCore.belowThreshold;
    const roleWeight = belowCoreThreshold ? HOME_RAM_BELOW_THRESHOLD_WEIGHT : HOME_RAM_BASE_WEIGHT;

    return makeRamCandidate({
        id: `home-ram-${currentRam}-to-${nextRam}`,
        type: GoalType.HOME_RAM,
        title: `Upgrade home RAM ${currentRam}GB -> ${nextRam}GB`,
        context,
        cost,
        addedRam,
        currentValue: currentRam,
        targetValue: nextRam,
        roleWeight,
        priority: belowCoreThreshold ? 120 : 100,
        reason: belowCoreThreshold
            ? `Home RAM is below the ${context.homeCore.thresholdRam}GB core-automation threshold, so this upgrade receives extra weight until the controller and tactical planner can comfortably coexist on home.`
            : "Home RAM expands the control node, leaving more room for persistent automation and local fallback work.",
        readyReason: belowCoreThreshold
            ? `The next home RAM upgrade is affordable and home is still below the ${context.homeCore.thresholdRam}GB core-automation threshold.`
            : "The next home RAM upgrade is affordable now.",
        recommendation: belowCoreThreshold
            ? `Prioritize home RAM until home reaches at least ${context.homeCore.thresholdRam}GB, unless another ready progression action has overwhelming value.`
            : "Focus on cash generation for the home RAM upgrade while it remains the best-ranked progression value.",
        readyRecommendation: belowCoreThreshold
            ? `Buy the home RAM upgrade; home is still below the ${context.homeCore.thresholdRam}GB core-automation threshold.`
            : "Buy the home RAM upgrade when convenient.",
        model: {
            costModel: "HOME_RAM_BN1_V1",
            valueModel: "RAM_PER_DOLLAR_V2",
            assumptions: [
                "BitNode 1 HomeComputerRamCost multiplier = 1",
                `Normal home control-node utility weight = ${HOME_RAM_BASE_WEIGHT}x`,
                `Below core-automation threshold utility weight = ${HOME_RAM_BELOW_THRESHOLD_WEIGHT}x`,
            ],
        },
        metadata: {
            coreThresholdRam: context.homeCore.thresholdRam,
            coreRequiredRam: context.homeCore.requiredRam,
            belowCoreThreshold,
        },
    });
}

/** Add one new-server execution-pool expansion candidate. */
function buildCloudServerCandidate(ns, context) {
    const owned = context.cloud.servers;
    const limit = context.cloud.serverLimit;
    if (owned.length >= limit) return null;

    const ram = Math.min(DEFAULT_CLOUD_SERVER_RAM_GB, Math.max(1, context.cloud.ramLimit || DEFAULT_CLOUD_SERVER_RAM_GB));
    const cost = Math.max(0, Number(ns.cloud.getServerCost(ram)) || 0);
    if (!(cost > 0) || !Number.isFinite(cost)) return null;

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
        recommendation: "Save for this cloud server if its execution-RAM value outranks the other progression options.",
        readyRecommendation: "Buy the cloud server when convenient if the advisor continues to rank it first.",
        model: {
            costModel: "CLOUD_API_V3",
            valueModel: "RAM_PER_DOLLAR_V2",
            assumptions: ["New cloud server RAM is valued as execution-pool capacity", `Starter comparison size = ${ram}GB`],
        },
        metadata: {
            action: "NEW_SERVER",
            ownedServers: owned.length,
            serverLimit: limit,
            serverRam: ram,
        },
    });
}

/**
 * Compare the next doubling upgrade for every owned cloud server and emit only
 * the best upgrade candidate. This keeps the advisor concise even with many
 * purchased servers while still evaluating the whole owned fleet.
 */
function buildCloudServerUpgradeCandidate(ns, context) {
    const ramLimit = context.cloud.ramLimit;
    if (context.cloud.servers.length === 0 || ramLimit <= 0) return null;

    let best = null;
    let eligibleServers = 0;

    for (const hostname of context.cloud.servers) {
        const currentRam = Math.max(0, Number(ns.getServerMaxRam(hostname)) || 0);
        if (currentRam <= 0 || currentRam >= ramLimit) continue;

        const nextRam = Math.min(ramLimit, currentRam * 2);
        const cost = Number(ns.cloud.getServerUpgradeCost(hostname, nextRam));
        if (!(cost > 0) || !Number.isFinite(cost)) continue;

        eligibleServers += 1;
        const candidate = makeRamCandidate({
            id: `cloud-server-upgrade-${hostname}-${currentRam}-to-${nextRam}`,
            type: GoalType.CLOUD_SERVER_UPGRADE,
            title: `Upgrade ${hostname} ${currentRam}GB -> ${nextRam}GB`,
            context,
            cost,
            addedRam: nextRam - currentRam,
            currentValue: currentRam,
            targetValue: nextRam,
            roleWeight: 1.0,
            priority: 95,
            reason: `Upgrading ${hostname} adds worker RAM without consuming another cloud-server slot.`,
            readyReason: `The ${hostname} ${currentRam}GB -> ${nextRam}GB upgrade is affordable now.`,
            recommendation: `Save for the ${hostname} RAM upgrade if it provides better execution-RAM value than buying another server or upgrading home.`,
            readyRecommendation: `Upgrade ${hostname} when convenient if the advisor continues to rank it first.`,
            model: {
                costModel: "CLOUD_UPGRADE_API_V3",
                valueModel: "RAM_PER_DOLLAR_V2",
                assumptions: ["Cloud upgrade RAM is valued as execution-pool capacity", "Only the next RAM doubling is compared for each server"],
            },
            metadata: {
                action: "UPGRADE_SERVER",
                hostname,
                currentRam,
                targetRam: nextRam,
                ramLimit,
            },
        });

        if (!best || compareCandidateValue(candidate, best) < 0) best = candidate;
    }

    if (best) best.metadata.eligibleServersCompared = eligibleServers;
    return best;
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
    return [...candidates].sort(compareCandidateValue);
}

function compareCandidateValue(a, b) {
    if (a.ready !== b.ready) return a.ready ? -1 : 1;
    return Number(b.valueScore ?? 0) - Number(a.valueScore ?? 0)
        || Number(b.priority ?? 0) - Number(a.priority ?? 0)
        || Number(a.cost ?? Infinity) - Number(b.cost ?? Infinity);
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

function nextPowerOfTwo(value) {
    return Math.pow(2, Math.ceil(Math.log2(Math.max(1, value))));
}
