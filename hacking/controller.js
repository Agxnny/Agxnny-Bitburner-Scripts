import { ActionType, TargetPhase, createTargetState } from "/lib/state.js";

/**
 * Foundation controller.
 *
 * This is intentionally not yet the final adaptive HGW engine. Its job is to
 * establish the controller -> structured state pattern that later analyzers,
 * schedulers, telemetry, and the dashboard will build on.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const target = String(ns.args[0] ?? "n00dles");
    const state = createTargetState(target);

    ns.disableLog("sleep");

    while (true) {
        updateObservedState(ns, state);
        chooseFoundationAction(state);

        ns.clearLog();
        ns.print(JSON.stringify(state, null, 2));

        // No workers are launched yet. Scheduling and thread calculations will
        // be added as their own layer rather than embedded into this loop.
        await ns.sleep(1000);
    }
}

/** @param {NS} ns @param {ReturnType<createTargetState>} state */
function updateObservedState(ns, state) {
    state.money.current = ns.getServerMoneyAvailable(state.hostname);
    state.money.max = ns.getServerMaxMoney(state.hostname);

    state.security.current = ns.getServerSecurityLevel(state.hostname);
    state.security.minimum = ns.getServerMinSecurityLevel(state.hostname);
    state.security.desired = state.security.minimum;

    state.updatedAt = Date.now();
}

/**
 * Temporary phase classification only.
 * These thresholds are placeholders, not the future tuning algorithm.
 *
 * @param {ReturnType<createTargetState>} state
 */
function chooseFoundationAction(state) {
    const securityTolerance = 0.5;
    const moneyTarget = state.money.max * state.money.desiredPercent;

    if (state.security.current > state.security.minimum + securityTolerance) {
        state.phase = TargetPhase.SECURITY_PREP;
        state.action = ActionType.WEAKEN;
        state.reason = `Security is ${formatNumber(state.security.current - state.security.minimum)} above minimum`;
        return;
    }

    if (state.money.max > 0 && state.money.current < moneyTarget) {
        state.phase = TargetPhase.MONEY_PREP;
        state.action = ActionType.GROW;
        state.reason = "Money is below the current desired level";
        return;
    }

    state.phase = TargetPhase.READY;
    state.action = ActionType.HACK;
    state.reason = "Target is prepared for production analysis";
}

function formatNumber(value) {
    return Number(value).toFixed(2);
}
