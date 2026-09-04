import { ActionType, TargetPhase, createTargetState } from "/lib/state.js";
import { publishControllerState, readPlannerState } from "/lib/runtime-state.js";
import {
    DEFAULT_HOME_RESERVE_GB,
    WORKER_SCRIPTS,
    distributeThreads,
    summarizeExecutionPool,
} from "/lib/execution.js";

/**
 * Lightweight persistent HGW controller.
 *
 * AUTO mode consumes cached planner state instead of performing network-wide
 * analysis itself. The controller monitors one target and currently dispatches
 * one HGW thread at a time across the rooted execution pool. This conservative
 * foundation proves distributed execution without overcommitting RAM; the next
 * thread-calculator layer will replace the single-thread request with calculated
 * thread counts while reusing the same allocator.
 *
 * Supplying a hostname forces MANUAL target mode. The latest planner snapshot is
 * still used as the execution-host inventory when available.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const manualTarget = ns.args.length > 0 ? String(ns.args[0]) : null;
    let planner = readPlannerState(ns);
    let state = manualTarget
        ? createManualState(manualTarget)
        : createStateFromPlanner(planner);

    if (!state) {
        ns.tprint("ERROR: AUTO mode has no planner snapshot.");
        ns.tprint("Run: run hacking/planner.js");
        ns.tprint("Then start the controller again.");
        return;
    }

    ns.disableLog("sleep");

    let activeJobs = [];
    let jobSequence = 0;

    while (true) {
        planner = readPlannerState(ns);
        activeJobs = activeJobs.filter((job) => ns.isRunning(job.pid, job.hostname));

        // Do not switch targets while a worker from the previous target is still
        // running. Adopt fresh planner choices between jobs instead.
        if (!manualTarget && activeJobs.length === 0) {
            state = adoptLatestPlannerTarget(planner, state);
        }

        updateObservedState(ns, state);
        chooseFoundationAction(state);
        updateExecutionState(ns, state, planner, activeJobs);

        if (activeJobs.length === 0) {
            const dispatch = dispatchFoundationAction(ns, planner, state, ++jobSequence);
            state.execution.lastDispatch = dispatch;
            activeJobs = dispatch.allocations.map((allocation) => ({
                hostname: allocation.hostname,
                pid: allocation.pid,
                threads: allocation.threads,
                action: state.action,
                target: state.hostname,
            }));

            if (dispatch.launched > 0) {
                state.execution.activeJobs = activeJobs.length;
                state.execution.activeThreads = dispatch.launched;
                state.reason += ` | dispatched ${dispatch.launched} thread(s)`;
            } else {
                state.reason += " | waiting for deployable RAM";
            }
        }

        state.updatedAt = Date.now();
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
 * @param {object|null} planner
 * @param {ReturnType<createTargetState>} currentState
 */
function adoptLatestPlannerTarget(planner, currentState) {
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
 * recompute these expensive fields.
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
 * Refresh only volatile observations needed for phase decisions.
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
}

/**
 * @param {NS} ns
 * @param {ReturnType<createTargetState>} state
 * @param {object|null} planner
 * @param {object[]} activeJobs
 */
function updateExecutionState(ns, state, planner, activeJobs) {
    const pool = summarizeExecutionPool(ns, planner, DEFAULT_HOME_RESERVE_GB);
    state.execution.homeReserveGb = pool.homeReserveGb;
    state.execution.hostCount = pool.hostCount;
    state.execution.maxRam = pool.maxRam;
    state.execution.usedRam = pool.usedRam;
    state.execution.freeRam = pool.freeRam;
    state.execution.usableRam = pool.usableRam;
    state.execution.activeJobs = activeJobs.length;
    state.execution.activeThreads = activeJobs.reduce((sum, job) => sum + job.threads, 0);
}

/**
 * Conservative first dispatcher: one thread per completed action. The allocator
 * can already split larger requests across hosts; calculated requests come next.
 *
 * @param {NS} ns
 * @param {object|null} planner
 * @param {ReturnType<createTargetState>} state
 * @param {number} sequence
 */
function dispatchFoundationAction(ns, planner, state, sequence) {
    const script = WORKER_SCRIPTS[state.action];
    if (!script) {
        return emptyDispatch(state.hostname);
    }

    const jobId = `foundation-${Date.now()}-${sequence}`;
    return distributeThreads(
        ns,
        planner,
        script,
        state.hostname,
        1,
        jobId,
        DEFAULT_HOME_RESERVE_GB,
    );
}

function emptyDispatch(target) {
    return {
        requested: 0,
        launched: 0,
        remaining: 0,
        script: "",
        scriptRam: 0,
        target,
        allocations: [],
    };
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

    state.phase = TargetPhase.PRODUCTION;
    state.action = ActionType.HACK;
    state.reason = "Target is prepared; running conservative production hack";
}

function formatNumber(value) {
    return Number(value).toFixed(2);
}
