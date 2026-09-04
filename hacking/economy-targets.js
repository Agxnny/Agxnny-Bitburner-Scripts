import {
    publishEconomyTargetState,
    publishPlannerState,
    readControllerState,
    readEconomyState,
    readPlannerState,
} from "/lib/runtime-state.js";

const DEFAULT_HACK_FRACTION = 0.10;
const SECURITY_TOLERANCE = 0.5;
const HOME_RESERVE_GB = 1;
const PREP_PENALTY_SCALE_SECONDS = 30 * 60;
const PREP_PENALTY_MAX_EXPONENT = 8;
const MONEY_TARGET_CANDIDATES = Object.freeze([0.25, 0.40, 0.55, 0.70, 0.85, 1.00]);

/**
 * Short-lived economic strategy selector.
 *
 * For every eligible server, evaluate several desired-money percentages rather
 * than assuming 100% preparation. Each strategy is charged for the live
 * security/grow work required to reach its desired money level using the real
 * distributed thread capacity available right now. Long prep is penalized
 * exponentially, then the strategy is compared by progression-goal ETA.
 *
 * The winner therefore answers two questions at once:
 *   1. which server should we attack?
 *   2. how far should we prepare its money before production?
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const planner = readPlannerState(ns);
    const economy = readEconomyState(ns);
    const controller = readControllerState(ns);
    const rankings = Array.isArray(planner?.rankings) ? planner.rankings : [];

    if (rankings.length === 0) return;

    const workerRam = planner?.workerRam ?? {};
    const growRam = Math.max(0.001, Number(workerRam["/hacking/workers/grow.js"] ?? 0));
    const weakenRam = Math.max(0.001, Number(workerRam["/hacking/workers/weaken.js"] ?? 0));
    const hackRam = Math.max(0.001, Number(workerRam["/hacking/workers/hack.js"] ?? 0));

    const execution = getLiveExecutionCapacity(ns, planner, {
        growRam,
        weakenRam,
        hackRam,
    });

    const weakenPerThread = Math.max(0.000001, Number(ns.weakenAnalyze(1)) || 0.05);
    const goalRemaining = Math.max(0, Number(economy?.goal?.remaining ?? 0));
    const hasCashGoal = goalRemaining > 0;

    const context = {
        goalRemaining,
        hasCashGoal,
        growCapacity: execution.growThreads,
        weakenCapacity: execution.weakenThreads,
        hackCapacity: execution.hackThreads,
        weakenPerThread,
    };

    const candidates = rankings
        .map((target) => evaluateBestTargetStrategy(ns, target, context))
        .filter(Boolean);

    candidates.sort(compareStrategies);

    const selected = candidates[0] ?? null;
    const updatedAt = Date.now();
    publishEconomyTargetState(ns, {
        version: 5,
        updatedAt,
        plannerUpdatedAt: Number(planner?.analysisUpdatedAt ?? planner?.updatedAt ?? 0),
        economyUpdatedAt: Number(economy?.updatedAt ?? 0),
        goal: economy?.goal ?? null,
        cash: Math.max(0, Number(economy?.cash ?? 0)),
        usableRam: execution.usableRam,
        executionCapacity: execution,
        controllerUpdatedAt: Number(controller?.updatedAt ?? 0),
        moneyTargetCandidates: MONEY_TARGET_CANDIDATES,
        prepPenalty: {
            model: "EXPONENTIAL_30M_V1",
            scaleSeconds: PREP_PENALTY_SCALE_SECONDS,
            maxExponent: PREP_PENALTY_MAX_EXPONENT,
        },
        selectedTarget: selected,
        rankings: candidates.map((candidate, index) => ({ ...candidate, economicRank: index + 1 })),
    });

    if (selected) {
        const selectedAnalysis = rankings.find((target) => target.hostname === selected.hostname);
        if (selectedAnalysis) {
            publishPlannerState(ns, {
                ...planner,
                updatedAt,
                selectedTarget: selectedAnalysis,
                selectionModel: "GOAL_ETA_ADAPTIVE_MONEY_V5",
                economicSelection: {
                    hostname: selected.hostname,
                    baselineRank: selected.baselineRank,
                    moneyTargetPercent: selected.moneyTargetPercent,
                    hackFraction: selected.hackFraction,
                    prepSeconds: selected.prepSeconds,
                    weightedPrepSeconds: selected.weightedPrepSeconds,
                    prepPenaltyMultiplier: selected.prepPenaltyMultiplier,
                    steadyIncomePerSecond: selected.steadyIncomePerSecond,
                    goalEtaSeconds: selected.goalEtaSeconds,
                    economicEtaSeconds: selected.economicEtaSeconds,
                    reason: selected.reason,
                    strategyAlternatives: selected.strategyAlternatives,
                    goalRemaining,
                    cash: Math.max(0, Number(economy?.cash ?? 0)),
                    goal: economy?.goal ?? null,
                    executionCapacity: execution,
                },
            });
        }
    }
}

function evaluateBestTargetStrategy(ns, target, context) {
    const strategies = MONEY_TARGET_CANDIDATES
        .map((moneyTargetPercent) => evaluateTargetStrategy(ns, target, context, moneyTargetPercent))
        .filter(Boolean)
        .sort(compareStrategies);

    const best = strategies[0] ?? null;
    if (!best) return null;

    return {
        ...best,
        strategyAlternatives: strategies.map((strategy) => ({
            moneyTargetPercent: strategy.moneyTargetPercent,
            prepSeconds: strategy.prepSeconds,
            weightedPrepSeconds: strategy.weightedPrepSeconds,
            prepPenaltyMultiplier: strategy.prepPenaltyMultiplier,
            growThreads: strategy.growThreads,
            growWaves: strategy.prepWaves.grow,
            steadyIncomePerSecond: strategy.steadyIncomePerSecond,
            economicEtaSeconds: strategy.economicEtaSeconds,
        })),
    };
}

function evaluateTargetStrategy(ns, target, context, moneyTargetPercent) {
    const hostname = String(target?.hostname ?? "");
    if (!hostname) return null;

    const moneyCurrent = Math.max(0, Number(ns.getServerMoneyAvailable(hostname)) || 0);
    const moneyMax = Math.max(0, Number(target.money?.max ?? 0));
    if (moneyMax <= 0) return null;

    const desiredMoney = moneyMax * moneyTargetPercent;
    const moneyPercent = moneyCurrent / moneyMax;
    const securityCurrent = Math.max(0, Number(ns.getServerSecurityLevel(hostname)) || 0);
    const securityMinimum = Math.max(0, Number(target.security?.minimum ?? ns.getServerMinSecurityLevel(hostname)) || 0);
    const securityDelta = Math.max(0, securityCurrent - securityMinimum);
    const hackChance = clamp01(Number(target.hacking?.chance ?? 0));
    const hackPercentPerThread = Math.max(0, Number(target.hacking?.percentPerThread ?? 0));
    const hackTime = Math.max(0.001, Number(target.timing?.hackMs ?? 1) / 1000);
    const growTime = Math.max(0.001, Number(target.timing?.growMs ?? 1) / 1000);
    const weakenTime = Math.max(0.001, Number(target.timing?.weakenMs ?? 1) / 1000);

    const securityPrepThreads = securityDelta > SECURITY_TOLERANCE
        ? Math.ceil((securityDelta - SECURITY_TOLERANCE) / context.weakenPerThread)
        : 0;

    let growThreads = 0;
    if (moneyCurrent < desiredMoney) {
        const multiplier = desiredMoney / Math.max(1, moneyCurrent);
        growThreads = finiteCeil(ns.growthAnalyze(hostname, multiplier));
    }

    const growSecurity = growThreads > 0
        ? Math.max(0, Number(ns.growthAnalyzeSecurity(growThreads, hostname)) || 0)
        : 0;
    const growWeakenThreads = Math.ceil(growSecurity / context.weakenPerThread);

    const securityPrepWaves = waves(securityPrepThreads, context.weakenCapacity);
    const growWaves = waves(growThreads, context.growCapacity);
    const growWeakenWaves = waves(growWeakenThreads, context.weakenCapacity);

    const prepSeconds = securityPrepWaves * weakenTime
        + growWaves * growTime
        + growWeakenWaves * weakenTime;
    const weightedPrepSeconds = exponentialPrepPenalty(prepSeconds);
    const prepPenaltyMultiplier = prepSeconds > 0 ? weightedPrepSeconds / prepSeconds : 1;

    const desiredHackThreads = hackPercentPerThread > 0
        ? Math.max(1, Math.ceil(DEFAULT_HACK_FRACTION / hackPercentPerThread))
        : 0;
    const effectiveHackThreads = Math.min(desiredHackThreads, context.hackCapacity);
    const effectiveHackFraction = clamp01(effectiveHackThreads * hackPercentPerThread);
    const expectedCash = desiredMoney * effectiveHackFraction * hackChance;

    let recoveryGrowThreads = 0;
    if (effectiveHackFraction > 0 && effectiveHackFraction < 1) {
        recoveryGrowThreads = finiteCeil(ns.growthAnalyze(hostname, 1 / Math.max(0.001, 1 - effectiveHackFraction)));
    }
    const recoveryGrowSecurity = recoveryGrowThreads > 0
        ? Math.max(0, Number(ns.growthAnalyzeSecurity(recoveryGrowThreads, hostname)) || 0)
        : 0;
    const hackSecurity = effectiveHackThreads > 0
        ? Math.max(0, Number(ns.hackAnalyzeSecurity(effectiveHackThreads, hostname)) || 0)
        : 0;
    const recoveryWeakenThreads = Math.ceil((recoveryGrowSecurity + hackSecurity) / context.weakenPerThread);

    const hackWaves = waves(effectiveHackThreads, context.hackCapacity);
    const recoveryGrowWaves = waves(recoveryGrowThreads, context.growCapacity);
    const recoveryWeakenWaves = waves(recoveryWeakenThreads, context.weakenCapacity);
    const cycleSeconds = hackWaves * hackTime
        + recoveryGrowWaves * growTime
        + recoveryWeakenWaves * weakenTime;
    const steadyIncomePerSecond = cycleSeconds > 0 ? expectedCash / cycleSeconds : 0;
    const productionGoalSeconds = context.hasCashGoal && steadyIncomePerSecond > 0
        ? context.goalRemaining / steadyIncomePerSecond
        : steadyIncomePerSecond > 0 ? 1 / steadyIncomePerSecond : Number.MAX_SAFE_INTEGER;
    const goalEtaSeconds = prepSeconds + productionGoalSeconds;
    const economicEtaSeconds = weightedPrepSeconds + productionGoalSeconds;

    return {
        hostname,
        baselineRank: Number(target.rank ?? 0),
        moneyPercent,
        moneyTargetPercent,
        desiredMoney,
        hackFraction: DEFAULT_HACK_FRACTION,
        securityDelta,
        prepSeconds,
        weightedPrepSeconds,
        prepPenaltyMultiplier,
        securityPrepThreads,
        growThreads,
        growWeakenThreads,
        effectiveHackThreads,
        effectiveHackFraction,
        prepWaves: {
            weaken: securityPrepWaves,
            grow: growWaves,
            growWeaken: growWeakenWaves,
        },
        productionWaves: {
            hack: hackWaves,
            grow: recoveryGrowWaves,
            weaken: recoveryWeakenWaves,
        },
        expectedCashPerCycle: expectedCash,
        cycleSeconds,
        steadyIncomePerSecond,
        goalEtaSeconds,
        economicEtaSeconds,
        reason: describeReason({
            moneyTargetPercent,
            prepSeconds,
            weightedPrepSeconds,
            prepPenaltyMultiplier,
            steadyIncomePerSecond,
            economicEtaSeconds,
            growThreads,
            growCapacity: context.growCapacity,
            growWaves,
            hasCashGoal: context.hasCashGoal,
        }),
    };
}

function compareStrategies(a, b) {
    return a.economicEtaSeconds - b.economicEtaSeconds
        || b.steadyIncomePerSecond - a.steadyIncomePerSecond
        || a.prepSeconds - b.prepSeconds
        || b.moneyTargetPercent - a.moneyTargetPercent;
}

function getLiveExecutionCapacity(ns, planner, workerRam) {
    const hosts = Array.isArray(planner?.executionHosts) ? planner.executionHosts : [];
    let usableRam = 0;
    let growThreads = 0;
    let weakenThreads = 0;
    let hackThreads = 0;
    let hostCount = 0;

    for (const entry of hosts) {
        const hostname = String(entry?.hostname ?? "");
        if (!hostname) continue;
        const maxRam = Math.max(0, Number(entry?.maxRam ?? 0));
        const usedRam = Math.max(0, Number(ns.getServerUsedRam(hostname)) || 0);
        const reserve = hostname === "home" ? HOME_RESERVE_GB : 0;
        const freeRam = Math.max(0, maxRam - usedRam - reserve);
        if (freeRam <= 0) continue;

        hostCount += 1;
        usableRam += freeRam;
        growThreads += Math.floor(freeRam / workerRam.growRam);
        weakenThreads += Math.floor(freeRam / workerRam.weakenRam);
        hackThreads += Math.floor(freeRam / workerRam.hackRam);
    }

    return {
        hostCount,
        usableRam,
        growThreads: Math.max(1, growThreads),
        weakenThreads: Math.max(1, weakenThreads),
        hackThreads: Math.max(1, hackThreads),
    };
}

function exponentialPrepPenalty(prepSeconds) {
    const prep = Math.max(0, Number(prepSeconds) || 0);
    if (prep <= 0) return 0;
    const exponent = Math.min(PREP_PENALTY_MAX_EXPONENT, prep / PREP_PENALTY_SCALE_SECONDS);
    return PREP_PENALTY_SCALE_SECONDS * Math.expm1(exponent);
}

function describeReason(values) {
    const target = `${Math.round(values.moneyTargetPercent * 100)}% money`;
    const prep = values.prepSeconds < 1 ? "ready now" : `${formatDuration(values.prepSeconds)} prep`;
    const weighted = values.prepSeconds < 1
        ? ""
        : ` (weighted ${formatDuration(values.weightedPrepSeconds)}, x${values.prepPenaltyMultiplier.toFixed(1)})`;
    const growLoad = values.growThreads > 0
        ? `, grow ${values.growThreads}t @ ${values.growCapacity}t/wave (${values.growWaves} wave${values.growWaves === 1 ? "" : "s"})`
        : "";
    const rate = `$${formatCompactNumber(values.steadyIncomePerSecond)}/s`;
    if (values.hasCashGoal) {
        return `${target}, ${prep}${weighted}${growLoad}, ${rate}, economic ${formatDuration(values.economicEtaSeconds)}`;
    }
    return `${target}, ${prep}${weighted}${growLoad}, estimated steady ${rate}`;
}

function waves(threads, capacity) {
    if (threads <= 0) return 0;
    return Math.ceil(threads / Math.max(1, capacity));
}

function finiteCeil(value) {
    return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0;
}

function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

function formatDuration(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    if (value < 60) return `${value.toFixed(0)}s`;
    const minutes = Math.floor(value / 60);
    if (minutes < 60) return `${minutes}m ${Math.floor(value % 60)}s`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}h ${minutes % 60}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
}

function formatCompactNumber(value) {
    const number = Math.max(0, Number(value) || 0);
    if (number >= 1e9) return `${(number / 1e9).toFixed(2)}b`;
    if (number >= 1e6) return `${(number / 1e6).toFixed(2)}m`;
    if (number >= 1e3) return `${(number / 1e3).toFixed(2)}k`;
    return number.toFixed(0);
}
