import { ActionType, TargetPhase, createTargetState } from "/lib/state.js";
import { publishControllerState } from "/lib/runtime-state.js";
import { analyzeTarget, rankEligibleTargets } from "/lib/targets.js";

/**
 * Foundation controller with automatic target selection.
 *
 * With no argument, the controller periodically selects the highest-ranked
 * currently-eligible money target. Supplying a hostname keeps manual-target
 * behavior for diagnostics and testing.
 *
 * This still does not launch workers. Scheduling and thread calculations remain
 * separate layers that will consume the structured state built here.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const manualTarget = ns.args.length > 0 ? String(ns.args[0]) : null;
    let state = createInitialState(ns, manualTarget);

    if (!state) {
        ns.tprint("ERROR: No currently-eligible money target was found.");
        return;
    }

    ns.disableLog("sleep");

    let nextAutoSelectionAt = 0;

    while (true) {
        if (!manualTarget && Date.now() >= nextAutoSelectionAt) {
            state = refreshAutomaticSelection(ns, state);
            nextAutoSelectionAt = Date.now() + 5000;
        }

        const analysis = analyzeTarget(ns, state.hostname);
        updateObservedState(state, analysis);
        chooseFoundationAction(state);
        publishControllerState(ns, state);

        ns.clearLog();
        ns.print(JSON.stringify(state, null, 2));

        await ns.sleep(1000);
    }
}

/** @param {NS} ns @param {string|null} manualTarget */
function createInitialState(ns, manualTarget) {
    if (manualTarget) {
        const analysis = analyzeTarget(ns, manualTarget);
        const state = createTargetState(manualTarget);
        applyAnalysis(state, analysis, "MANUAL", 0);
        return state;
    }

    const best = rankEligibleTargets(ns)[0];
    if (!best) return null;

    const state = createTargetState(best.hostname);
    applyAnalysis(state, best, "AUTO", best.rank);
    return state;
}

/** @param {NS} ns @param {ReturnType<createTargetState>} currentState */
function refreshAutomaticSelection(ns, currentState) {
    const ranked = rankEligibleTargets(ns);
    const best = ranked[0];
    if (!best) return currentState;

    if (best.hostname !== currentState.hostname) {
        const nextState = createTargetState(best.hostname);
        applyAnalysis(nextState, best, "AUTO", best.rank);
        return nextState;
    }

    applyAnalysis(currentState, best, "AUTO", best.rank);
    return currentState;
}

/**
 * Copy analyzer output into the controller-owned state contract.
 *
 * @param {ReturnType<createTargetState>} state
 * @param {ReturnType<analyzeTarget>} analysis
 * @param {string} mode
 * @param {number} rank
 */
function applyAnalysis(state, analysis, mode, rank) {
    state.selection.mode = mode;
    state.selection.rank = rank;
    state.selection.score = analysis.score;
    state.selection.scoreModel = analysis.scoreModel;

    state.analysis.hackChance = analysis.hacking.chance;
    state.analysis.hackPercentPerThread = analysis.hacking.percentPerThread;
    state.analysis.hackTimeMs = analysis.timing.hackMs;
    state.analysis.growTimeMs = analysis.timing.growMs;
    state.analysis.weakenTimeMs = analysis.timing.weakenMs;
    state.analysis.growth = analysis.growth;

    state.strategy.score = analysis.score;
    state.strategy.expectedIncomePerSecond = analysis.score;
}

/**
 * Refresh volatile target observations from the analyzer snapshot.
 *
 * @param {ReturnType<createTargetState>} state
 * @param {ReturnType<analyzeTarget>} analysis
 */
function updateObservedState(state, analysis) {
    state.money.current = analysis.money.current;
    state.money.max = analysis.money.max;

    state.security.current = analysis.security.current;
    state.security.minimum = analysis.security.minimum;
    state.security.desired = analysis.security.minimum;

    // Ranking inputs such as chance and timings can change with player/server
    // state, so keep the live controller snapshot current between ranking passes.
    applyAnalysis(state, analysis, state.selection.mode, state.selection.rank);
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
