import { ActionType, TargetPhase, createTargetState } from "/lib/state.js";
import { publishControllerState, readPlannerState } from "/lib/runtime-state.js";

/**
 * Lightweight persistent HGW controller foundation.
 *
 * AUTO mode consumes the latest snapshot from hacking/planner.js instead of
 * performing network-wide target analysis itself. This keeps expensive analysis
 * out of the always-running process. Supplying a hostname still forces MANUAL
 * mode for diagnostics/testing.
 *
 * Workers are not launched yet; dispatcher/thread calculation comes next.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const manualTarget = ns.args.length > 0 ? String(ns.args[0]) : null;
    let state = manualTarget
        ? createManualState(manualTarget)
        : createStateFromPlanner(readPlannerState(ns));

    if (!state) {
        ns.tprint("ERROR: AUTO mode has no planner snapshot.");
        ns.tprint("Run: run hacking/planner.js");
        ns.tprint("Then start the controller again.");
        return;
    }

    ns.disableLog("sleep");

    while (true) {
        if (!manualTarget) {
            state = adoptLatestPlannerTarget(ns, state);
        }

        updateObservedState(ns, state);
        chooseFoundationAction(state);
        publishControllerState(ns, state);

        ns.clearLog();
        ns.print(JSON.stringify(state, null, 2));

        await ns.sleep(1000);
    }
}

/** @param {string} hostname */
function createManualState(hostname) {
    const state = createTargetState(hostname);
    state.selection.mode = "MANUAL";
    state.selection.rank = 0;
    return state;
}

/** @param {object|null} planner */
function createStateFromPlanner(planner) {
    const selected = planner?.selectedTarget;
    if (!selected?.hostname) return null;

    const state = createTargetState(selected.hostname);
    applyPlannerAnalysis(state, selected);
    return state;
}

/**
 * AUTO controllers can adopt a newly-published plan without carrying the
 * planner's analysis RAM cost themselves.
 *
 * @param {NS} ns
 * @param {ReturnType<createTargetState>} currentState
 */
function adoptLatestPlannerTarget(ns, currentState) {
    const planner = readPlannerState(ns);
    const selected = planner?.selectedTarget;
    if (!selected?.hostname) return currentState;

    if (selected.hostname !== currentState.hostname) {
        const nextState = createTargetState(selected.hostname);
        applyPlannerAnalysis(nextState, selected);
        return nextState;
    }

    applyPlannerAnalysis(currentState, selected);
    return currentState;
}

/**
 * Copy cached planner analysis into controller state. The controller does not
 * recompute these fields; they remain the planner's latest snapshot until the
 * planner is run again.
 *
 * @param {ReturnType<createTargetState>} state
 * @param {object} analysis
 */
function applyPlannerAnalysis(state, analysis) {
    state.selection.mode = "AUTO";
    state.selection.rank = Number(analysis.rank ?? 0);
    state.selection.score = Number(analysis.score ?? 0);
    state.selection.scoreModel = String(analysis.scoreModel ?? "");

    state.analysis.hackChance = Number(analysis.hacking?.chance ?? 0);
    state.analysis.hackPercentPerThread = Number(analysis.hacking?.percentPerThread ?? 0);
    state.analysis.hackTimeMs = Number(analysis.timing?.hackMs ?? 0);
    state.analysis.growTimeMs = Number(analysis.timing?.growMs ?? 0);
    state.analysis.weakenTimeMs = Number(analysis.timing?.weakenMs ?? 0);
    state.analysis.growth = Number(analysis.growth ?? 0);

    state.strategy.score = state.selection.score;
    state.strategy.expectedIncomePerSecond = state.selection.score;
}

/**
 * Refresh only the volatile observations needed for phase decisions.
 * No hack-analysis, timing, or network-wide ranking APIs are used here.
 *
 * @param {NS} ns
 * @param {ReturnType<createTargetState>} state
 */
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
