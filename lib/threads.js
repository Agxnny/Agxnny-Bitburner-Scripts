import { ActionType, TargetPhase } from "/lib/state.js";
import { WORKER_SCRIPTS } from "/lib/execution.js";

// HGW thread calculation.
//
// Keep this module out of the persistent controller for now. The Netscript
// analysis APIs used here have meaningful RAM costs, so this layer is intended
// for short-lived tactical planning until we deliberately choose where it runs.

export const DEFAULT_HACK_FRACTION = 0.10;
export const DEFAULT_SECURITY_TOLERANCE = 0.5;
export const DEFAULT_MONEY_TARGET_PERCENT = 1;

/**
 * Build a current-state HGW thread plan for one target.
 *
 * The calculator is deliberately phase-aware:
 * - excessive security -> WEAKEN first
 * - insufficient money -> GROW first
 * - prepared target -> HACK
 *
 * Grow/hack security compensation is also calculated so later schedulers can
 * reason about the full recovery cost even though the current controller runs
 * one action phase at a time.
 *
 * @param {NS} ns
 * @param {string} hostname
 * @param {{hackFraction?: number, moneyTargetPercent?: number, securityTolerance?: number, cores?: number}} options
 */
export function calculateThreadPlan(ns, hostname, options = {}) {
    const hackFraction = clamp(Number(options.hackFraction ?? DEFAULT_HACK_FRACTION), 0.001, 0.99);
    const moneyTargetPercent = clamp(Number(options.moneyTargetPercent ?? DEFAULT_MONEY_TARGET_PERCENT), 0.01, 1);
    const securityTolerance = Math.max(0, Number(options.securityTolerance ?? DEFAULT_SECURITY_TOLERANCE));
    const cores = Math.max(1, Math.floor(Number(options.cores ?? 1)));

    const moneyCurrent = ns.getServerMoneyAvailable(hostname);
    const moneyMax = ns.getServerMaxMoney(hostname);
    const moneyDesired = moneyMax * moneyTargetPercent;
    const securityCurrent = ns.getServerSecurityLevel(hostname);
    const securityMinimum = ns.getServerMinSecurityLevel(hostname);
    const securityDelta = Math.max(0, securityCurrent - securityMinimum);

    const weakenPerThread = Math.max(0, ns.weakenAnalyze(1, cores));
    const securityPrepThreads = weakenPerThread > 0
        ? Math.ceil(securityDelta / weakenPerThread)
        : 0;

    const growMultiplier = calculateGrowMultiplier(moneyCurrent, moneyDesired);
    const growThreadsDecimal = growMultiplier > 1
        ? ns.growthAnalyze(hostname, growMultiplier, cores)
        : 0;
    const growThreads = finiteCeil(growThreadsDecimal);
    const growSecurity = growThreads > 0
        ? ns.growthAnalyzeSecurity(growThreads, hostname, cores)
        : 0;
    const growWeakenThreads = weakenPerThread > 0
        ? Math.ceil(Math.max(0, growSecurity) / weakenPerThread)
        : 0;

    // hackAnalyzeThreads rejects an amount above currently available money, so
    // this first-pass production estimate is based on current money. Once a
    // target is prepared, current money and desired money should be nearly equal.
    const hackBaseMoney = Math.max(0, Math.min(moneyCurrent, moneyDesired));
    const hackAmount = hackBaseMoney * hackFraction;
    const hackThreadsDecimal = hackAmount > 0
        ? ns.hackAnalyzeThreads(hostname, hackAmount)
        : 0;
    const hackThreads = finiteCeil(hackThreadsDecimal);
    const hackSecurity = hackThreads > 0
        ? ns.hackAnalyzeSecurity(hackThreads, hostname)
        : 0;
    const hackWeakenThreads = weakenPerThread > 0
        ? Math.ceil(Math.max(0, hackSecurity) / weakenPerThread)
        : 0;

    const workerRam = {
        hack: safeScriptRam(ns, WORKER_SCRIPTS.HACK),
        grow: safeScriptRam(ns, WORKER_SCRIPTS.GROW),
        weaken: safeScriptRam(ns, WORKER_SCRIPTS.WEAKEN),
    };

    const next = chooseNextAction({
        securityDelta,
        securityTolerance,
        securityPrepThreads,
        moneyCurrent,
        moneyDesired,
        growThreads,
        hackThreads,
    });

    return {
        hostname,
        options: {
            hackFraction,
            moneyTargetPercent,
            securityTolerance,
            cores,
        },
        money: {
            current: moneyCurrent,
            max: moneyMax,
            desired: moneyDesired,
            percent: moneyMax > 0 ? moneyCurrent / moneyMax : 0,
            growMultiplier,
        },
        security: {
            current: securityCurrent,
            minimum: securityMinimum,
            delta: securityDelta,
            weakenPerThread,
        },
        threads: {
            securityPrepWeaken: securityPrepThreads,
            grow: growThreads,
            growWeaken: growWeakenThreads,
            hack: hackThreads,
            hackWeaken: hackWeakenThreads,
        },
        securityEffects: {
            grow: growSecurity,
            hack: hackSecurity,
        },
        ram: {
            worker: workerRam,
            securityPrep: securityPrepThreads * workerRam.weaken,
            grow: growThreads * workerRam.grow,
            growWeaken: growWeakenThreads * workerRam.weaken,
            hack: hackThreads * workerRam.hack,
            hackWeaken: hackWeakenThreads * workerRam.weaken,
            growCycle: growThreads * workerRam.grow + growWeakenThreads * workerRam.weaken,
            hackCycle: hackThreads * workerRam.hack + hackWeakenThreads * workerRam.weaken,
        },
        next,
        calculatedAt: Date.now(),
    };
}

function chooseNextAction(values) {
    if (values.securityDelta > values.securityTolerance) {
        return {
            phase: TargetPhase.SECURITY_PREP,
            action: ActionType.WEAKEN,
            requestedThreads: Math.max(1, values.securityPrepThreads),
            reason: "Security is above the configured tolerance",
        };
    }

    if (values.moneyCurrent < values.moneyDesired) {
        return {
            phase: TargetPhase.MONEY_PREP,
            action: ActionType.GROW,
            requestedThreads: Math.max(1, values.growThreads),
            reason: "Money is below the configured target",
        };
    }

    return {
        phase: TargetPhase.PRODUCTION,
        action: ActionType.HACK,
        requestedThreads: Math.max(1, values.hackThreads),
        reason: "Target is prepared for the configured hack fraction",
    };
}

function calculateGrowMultiplier(currentMoney, desiredMoney) {
    if (desiredMoney <= 0 || currentMoney >= desiredMoney) return 1;

    // growthAnalyze does not include grow's additive $1/thread behavior. Using
    // at least $1 as the denominator is conservative and avoids division by zero.
    return desiredMoney / Math.max(1, currentMoney);
}

function safeScriptRam(ns, script) {
    const ram = ns.getScriptRam(script, "home");
    return Number.isFinite(ram) && ram > 0 ? ram : 0;
}

function finiteCeil(value) {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.ceil(value);
}

function clamp(value, minimum, maximum) {
    if (!Number.isFinite(value)) return minimum;
    return Math.min(maximum, Math.max(minimum, value));
}
