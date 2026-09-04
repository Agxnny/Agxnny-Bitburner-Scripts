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
const CONTROLLER_FRESH_MS = 5_000;
const PREP_PENALTY_SCALE_SECONDS = 30 * 60;
const PREP_PENALTY_MAX_EXPONENT = 8;

/**
 * Short-lived target selector that answers a different question from the baseline
 * planner: "which target gets us to the current cash goal fastest from its live
 * state?"
 *
 * Target prep is intentionally penalized non-linearly. Short prep remains close
 * to its real elapsed time, while long grow/weaken commitments become rapidly
 * less attractive. This prevents a theoretically rich target from monopolizing
 * the RAM pool for hours when a smaller prepared target can produce cash now.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const planner = readPlannerState(ns);
    const economy = readEconomyState(ns);
    const controller = readControllerState(ns);
    const rankings = Array.isArray(planner?.rankings) ? planner.rankings : [];

    if (rankings.length === 0) return;

    const controllerFresh = controller?.updatedAt && Date.now() - Number(controller.updatedAt) <= CONTROLLER_FRESH_MS;
    const usableRam = controllerFresh
        ? Math.max(0, Number(controller?.execution?.usableRam ?? 0))
        : estimatePlannerUsableRam(ns, planner);

    const workerRam = planner?.workerRam ?? {};
    const growRam = Math.max(0.001, Number(workerRam["/hacking/workers/grow.js"] ?? 0));
    const weakenRam = Math.max(0.001, Number(workerRam["/hacking/workers/weaken.js"] ?? 0));
    const hackRam = Math.max(0.001, Number(workerRam["/hacking/workers/hack.js"] ?? 0));
    const growCapacity = Math.max(1, Math.floor(usableRam / growRam));
    const weakenCapacity = Math.max(1, Math.floor(usableRam / weakenRam));
    const hackCapacity = Math.max(1, Math.floor(usableRam / hackRam));
    const weakenPerThread = Math.max(0.000001, Number(ns.weakenAnalyze(1)) || 0.05);

    const goalRemaining = Math.max(0, Number(economy?.goal?.remaining ?? 0));
    const hasCashGoal = goalRemaining > 0;

    const candidates = rankings.map((target) => evaluateTarget(ns, target, {
        goalRemaining,
        hasCashGoal,
        growCapacity,
        weakenCapacity,
        hackCapacity,
        weakenPerThread,
    })).filter(Boolean);

    candidates.sort((a, b) =>
        a.economicEtaSeconds - b.economicEtaSeconds
        || b.steadyIncomePerSecond - a.steadyIncomePerSecond
        || a.prepSeconds - b.prepSeconds
    );

    const selected = candidates[0] ?? null;
    const updatedAt = Date.now();
    publishEconomyTargetState(ns, {
        version: 3,
        updatedAt,
        plannerUpdatedAt: Number(planner?.analysisUpdatedAt ?? planner?.updatedAt ?? 0),
        economyUpdatedAt: Number(economy?.updatedAt ?? 0),
        goal: economy?.goal ?? null,
        cash: Math.max(0, Number(economy?.cash ?? 0)),
        usableRam,
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
                selectionModel: "GOAL_ETA_EXP_PREP_PENALTY_V3",
                economicSelection: {
                    hostname: selected.hostname,
                    baselineRank: selected.baselineRank,
                    prepSeconds: selected.prepSeconds,
                    weightedPrepSeconds: selected.weightedPrepSeconds,
                    prepPenaltyMultiplier: selected.prepPenaltyMultiplier,
                    steadyIncomePerSecond: selected.steadyIncomePerSecond,
                    goalEtaSeconds: selected.goalEtaSeconds,
                    economicEtaSeconds: selected.economicEtaSeconds,
                    reason: selected.reason,
                    goalRemaining,
                    cash: Math.max(0, Number(economy?.cash ?? 0)),
                    goal: economy?.goal ?? null,
                },
            });
        }
    }
}

function evaluateTarget(ns, target, context) {
    const hostname = String(target?.hostname ?? "");
    if (!hostname) return null;

    const moneyCurrent = Math.max(0, Number(ns.getServerMoneyAvailable(hostname)) || 0);
    const moneyMax = Math.max(0, Number(target.money?.max ?? 0));
    if (moneyMax <= 0) return null;

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
    if (moneyCurrent < moneyMax) {
        const multiplier = moneyMax / Math.max(1, moneyCurrent);
        growThreads = finiteCeil(ns.growthAnalyze(hostname, multiplier));
    }

    const growSecurity = growThreads > 0
        ? Math.max(0, Number(ns.growthAnalyzeSecurity(growThreads, hostname)) || 0)
        : 0;
    const growWeakenThreads = Math.ceil(growSecurity / context.weakenPerThread);

    const prepSeconds = waves(securityPrepThreads, context.weakenCapacity) * weakenTime
        + waves(growThreads, context.growCapacity) * growTime
        + waves(growWeakenThreads, context.weakenCapacity) * weakenTime;
    const weightedPrepSeconds = exponentialPrepPenalty(prepSeconds);
    const prepPenaltyMultiplier = prepSeconds > 0 ? weightedPrepSeconds / prepSeconds : 1;

    const desiredHackThreads = hackPercentPerThread > 0
        ? Math.max(1, Math.ceil(DEFAULT_HACK_FRACTION / hackPercentPerThread))
        : 0;
    const effectiveHackThreads = Math.min(desiredHackThreads, context.hackCapacity);
    const effectiveHackFraction = clamp01(effectiveHackThreads * hackPercentPerThread);
    const expectedCash = moneyMax * effectiveHackFraction * hackChance;

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

    const cycleSeconds = hackTime
        + waves(recoveryGrowThreads, context.growCapacity) * growTime
        + waves(recoveryWeakenThreads, context.weakenCapacity) * weakenTime;
    const steadyIncomePerSecond = cycleSeconds > 0 ? expectedCash / cycleSeconds : 0;
    const productionGoalSeconds = context.hasCashGoal && steadyIncomePerSecond > 0
        ? context.goalRemaining / steadyIncomePerSecond
        : steadyIncomePerSecond > 0 ? 1 / steadyIncomePerSecond : Number.MAX_SAFE_INTEGER;
    const goalEtaSeconds = context.hasCashGoal
        ? prepSeconds + productionGoalSeconds
        : prepSeconds + productionGoalSeconds;
    const economicEtaSeconds = weightedPrepSeconds + productionGoalSeconds;

    return {
        hostname,
        baselineRank: Number(target.rank ?? 0),
        moneyPercent,
        securityDelta,
        prepSeconds,
        weightedPrepSeconds,
        prepPenaltyMultiplier,
        securityPrepThreads,
        growThreads,
        growWeakenThreads,
        effectiveHackThreads,
        effectiveHackFraction,
        expectedCashPerCycle: expectedCash,
        cycleSeconds,
        steadyIncomePerSecond,
        goalEtaSeconds,
        economicEtaSeconds,
        reason: describeReason({
            prepSeconds,
            weightedPrepSeconds,
            prepPenaltyMultiplier,
            steadyIncomePerSecond,
            goalEtaSeconds,
            economicEtaSeconds,
            hasCashGoal: context.hasCashGoal,
        }),
    };
}

function exponentialPrepPenalty(prepSeconds) {
    const prep = Math.max(0, Number(prepSeconds) || 0);
    if (prep <= 0) return 0;
    const exponent = Math.min(PREP_PENALTY_MAX_EXPONENT, prep / PREP_PENALTY_SCALE_SECONDS);
    return PREP_PENALTY_SCALE_SECONDS * Math.expm1(exponent);
}

function estimatePlannerUsableRam(ns, planner) {
    const hosts = Array.isArray(planner?.executionHosts) ? planner.executionHosts : [];
    return hosts.reduce((total, entry) => {
        const hostname = String(entry?.hostname ?? "");
        if (!hostname) return total;
        const maxRam = Math.max(0, Number(entry?.maxRam ?? 0));
        const usedRam = Math.max(0, Number(ns.getServerUsedRam(hostname)) || 0);
        const reserve = hostname === "home" ? HOME_RESERVE_GB : 0;
        return total + Math.max(0, maxRam - usedRam - reserve);
    }, 0);
}

function describeReason(values) {
    const prep = values.prepSeconds < 1 ? "ready now" : `${formatDuration(values.prepSeconds)} prep`;
    const weighted = values.prepSeconds < 1
        ? ""
        : ` (weighted ${formatDuration(values.weightedPrepSeconds)}, x${values.prepPenaltyMultiplier.toFixed(1)})`;
    const rate = `$${formatCompactNumber(values.steadyIncomePerSecond)}/s`;
    if (values.hasCashGoal) {
        return `${prep}${weighted}, ${rate}, raw goal ${formatDuration(values.goalEtaSeconds)}, economic ${formatDuration(values.economicEtaSeconds)}`;
    }
    return `${prep}${weighted}, estimated steady ${rate}`;
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
