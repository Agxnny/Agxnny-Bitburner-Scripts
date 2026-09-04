// Shared state helpers.
//
// This module defines the vocabulary used by controllers, analyzers, schedulers,
// guidance, and the future dashboard. It intentionally contains no rendering or
// HGW decision logic.

export const TargetPhase = Object.freeze({
    DISCOVERED: "DISCOVERED",
    BLOCKED: "BLOCKED",
    ELIGIBLE: "ELIGIBLE",
    SECURITY_PREP: "SECURITY_PREP",
    MONEY_PREP: "MONEY_PREP",
    READY: "READY",
    PRODUCTION: "PRODUCTION",
    IDLE: "IDLE",
});

export const ActionType = Object.freeze({
    NONE: "NONE",
    HACK: "HACK",
    GROW: "GROW",
    WEAKEN: "WEAKEN",
});

/**
 * Create a predictable target-state object.
 * Additional telemetry can be added here as the project grows without making
 * the dashboard responsible for reconstructing controller decisions.
 *
 * @param {string} hostname
 */
export function createTargetState(hostname) {
    return {
        hostname,
        phase: TargetPhase.DISCOVERED,
        action: ActionType.NONE,
        reason: "Awaiting analysis",

        money: {
            current: 0,
            max: 0,
            desiredPercent: 1,
        },

        security: {
            current: 0,
            minimum: 0,
            desired: 0,
        },

        strategy: {
            hackPercent: 0,
            growTargetPercent: 1,
            score: 0,
            expectedIncomePerSecond: 0,
            expectedIncomePerGbSecond: 0,
        },

        threads: {
            hack: 0,
            grow: 0,
            weaken: 0,
        },

        progress: 0,
        updatedAt: Date.now(),
    };
}
