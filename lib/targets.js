import { analyzeNetwork } from "/lib/network.js";

// Target analysis and baseline ranking.
//
// This layer is intentionally separate from scheduling and rendering. It answers
// "which currently-eligible money targets look best?" using an explainable
// first-pass score. The score can later be replaced by strategy-specific
// money/sec/GB calculations without changing callers.

/**
 * Analyze one HGW-eligible target using the current player/server state.
 *
 * Baseline score = expected money stolen by one hack thread / hack time.
 * It uses max money rather than current money so a temporarily-drained server
 * does not become "bad" merely because it needs prep. Grow/weaken recovery cost
 * is deliberately not modeled yet; that belongs to the strategy optimizer.
 *
 * @param {NS} ns
 * @param {string} hostname
 */
export function analyzeTarget(ns, hostname) {
    const moneyCurrent = ns.getServerMoneyAvailable(hostname);
    const moneyMax = ns.getServerMaxMoney(hostname);
    const securityCurrent = ns.getServerSecurityLevel(hostname);
    const securityMinimum = ns.getServerMinSecurityLevel(hostname);

    const hackChance = clamp01(ns.hackAnalyzeChance(hostname));
    const hackPercent = Math.max(0, ns.hackAnalyze(hostname));
    const hackTimeMs = Math.max(1, ns.getHackTime(hostname));
    const growTimeMs = Math.max(1, ns.getGrowTime(hostname));
    const weakenTimeMs = Math.max(1, ns.getWeakenTime(hostname));

    const expectedMoneyPerHackThread = moneyMax * hackPercent * hackChance;
    const expectedMoneyPerSecondPerHackThread = expectedMoneyPerHackThread / (hackTimeMs / 1000);

    return {
        hostname,
        eligible: ns.hasRootAccess(hostname)
            && ns.getHackingLevel() >= ns.getServerRequiredHackingLevel(hostname)
            && moneyMax > 0,

        money: {
            current: moneyCurrent,
            max: moneyMax,
            percent: moneyMax > 0 ? moneyCurrent / moneyMax : 0,
        },

        security: {
            current: securityCurrent,
            minimum: securityMinimum,
            delta: Math.max(0, securityCurrent - securityMinimum),
        },

        hacking: {
            chance: hackChance,
            percentPerThread: hackPercent,
            expectedMoneyPerThread: expectedMoneyPerHackThread,
        },

        timing: {
            hackMs: hackTimeMs,
            growMs: growTimeMs,
            weakenMs: weakenTimeMs,
        },

        growth: ns.getServerGrowth(hostname),

        score: expectedMoneyPerSecondPerHackThread,
        scoreModel: "EXPECTED_HACK_MONEY_PER_SECOND_PER_THREAD",
    };
}

/**
 * Return currently-rooted money targets the player can hack now.
 *
 * @param {NS} ns
 */
export function getEligibleTargetHostnames(ns) {
    return analyzeNetwork(ns)
        .filter((server) => server.canHackNow && server.target.hasMoney)
        .map((server) => server.hostname);
}

/**
 * Rank all currently-eligible targets from best to worst baseline score.
 * Ties prefer higher max money, then hostname for deterministic output.
 *
 * @param {NS} ns
 */
export function rankEligibleTargets(ns) {
    return getEligibleTargetHostnames(ns)
        .map((hostname) => analyzeTarget(ns, hostname))
        .sort((a, b) =>
            b.score - a.score
            || b.money.max - a.money.max
            || a.hostname.localeCompare(b.hostname)
        )
        .map((target, index) => ({ ...target, rank: index + 1 }));
}

/** @param {number} value */
function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}
