import { ActionType, TargetPhase, createTargetState } from "/lib/state.js";
import {
    publishControllerState,
    readPlannerState,
    readTacticalPlanState,
} from "/lib/runtime-state.js";
import {
    DEFAULT_HOME_RESERVE_GB,
    WORKER_SCRIPTS,
    distributeThreads,
    getExecutionPool,
    summarizeExecutionPool,
} from "/lib/execution.js";

const TACTICAL_PLANNER_SCRIPT = "/hacking/tactical-planner.js";

/**
 * Lightweight persistent HGW controller.
 *
 * Expensive HGW thread analysis is delegated to a short-lived tactical planner
 * that normally runs on a rooted remote RAM host. The controller requests one
 * tactical calculation, executes that plan across the distributed RAM pool,
 * waits for the launched workers to finish, then requests a fresh calculation.
 *
 * This keeps live phase/thread decisions current without carrying the expensive
 * analysis APIs in the persistent controller.
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
    let tacticalJob = null;
    let pendingRequestId = "";
    let requestSequence = 0;
    let jobSequence = 0;

    while (true) {
        planner = readPlannerState(ns);
        activeJobs = activeJobs.filter((job) => ns.isRunning(job.pid, job.hostname));

        if (tacticalJob && !ns.isRunning(tacticalJob.pid, tacticalJob.hostname)) {
            tacticalJob = null;
        }

        // Adopt a different AUTO target only between both worker and tactical jobs.
        if (!manualTarget && activeJobs.length === 0 && !tacticalJob) {
            const previousTarget = state.hostname;
            state = adoptLatestPlannerTarget(planner, state);
            if (state.hostname !== previousTarget) {
                pendingRequestId = "";
            }
        }

        updateObservedState(ns, state);
        chooseFoundationAction(state);
        updateExecutionState(ns, state, planner, activeJobs);

        if (activeJobs.length > 0) {
            state.tactical.status = "WAITING_WORKERS";
            state.reason += ` | waiting for ${activeJobs.length} worker job(s)`;
        } else {
            const tacticalPlan = readTacticalPlanState(ns);

            if (isRequestedPlan(tacticalPlan, state.hostname, pendingRequestId)) {
                applyTacticalPlan(state, tacticalPlan);

                const dispatch = dispatchTacticalAction(
                    ns,
                    planner,
                    state,
                    tacticalPlan,
                    ++jobSequence,
                );

                state.execution.lastDispatch = dispatch;
                state.threads.launched = dispatch.launched;
                state.threads.remaining = dispatch.remaining;

                activeJobs = dispatch.allocations.map((allocation) => ({
                    hostname: allocation.hostname,
                    pid: allocation.pid,
                    threads: allocation.threads,
                    action: state.action,
                    target: state.hostname,
                }));

                if (dispatch.launched > 0) {
                    // Any launched work changes target state, so this plan must
                    // never be reused after the workers complete.
                    pendingRequestId = "";
                    state.tactical.status = "EXECUTING";
                    state.execution.activeJobs = activeJobs.length;
                    state.execution.activeThreads = dispatch.launched;
                    state.reason += ` | dispatched ${dispatch.launched}/${dispatch.requested} thread(s)`;
                } else {
                    state.tactical.status = "READY";
                    state.reason += " | calculated plan ready, waiting for deployable RAM";
                }
            } else if (!tacticalJob) {
                const request = launchTacticalPlanner(
                    ns,
                    planner,
                    state.hostname,
                    ++requestSequence,
                );

                if (request.pid > 0) {
                    tacticalJob = request;
                    pendingRequestId = request.requestId;
                    state.tactical.status = "CALCULATING";
                    state.tactical.requestId = request.requestId;
                    state.tactical.plannerHost = request.hostname;
                    state.reason += ` | tactical calculation running on ${request.hostname}`;
                } else {
                    pendingRequestId = "";
                    state.tactical.status = "BLOCKED";
                    state.reason += " | no execution host has enough free RAM for tactical analysis";
                }
            } else {
                state.tactical.status = "CALCULATING";
                state.tactical.requestId = tacticalJob.requestId;
                state.tactical.plannerHost = tacticalJob.hostname;
                state.reason += ` | tactical calculation running on ${tacticalJob.hostname}`;
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
 * Start one expensive tactical calculation on the first execution host that has
 * enough currently-usable RAM. exec() failures fall through to the next host,
 * which also makes a missing remote deployment fail safely.
 *
 * @param {NS} ns
 * @param {object|null} planner
 * @param {string} target
 * @param {number} sequence
 */
function launchTacticalPlanner(ns, planner, target, sequence) {
    const scriptRam = ns.getScriptRam(TACTICAL_PLANNER_SCRIPT, "home");
    const requestId = `tactical-${Date.now()}-${sequence}`;

    if (scriptRam <= 0) {
        return { pid: 0, hostname: "", requestId, target };
    }

    for (const host of getExecutionPool(ns, planner, DEFAULT_HOME_RESERVE_GB)) {
        if (host.usableRam < scriptRam) continue;

        const pid = ns.exec(TACTICAL_PLANNER_SCRIPT, host.hostname, 1, target, requestId);
        if (pid > 0) {
            return {
                pid,
                hostname: host.hostname,
                requestId,
                target,
                scriptRam,
            };
        }
    }

    return { pid: 0, hostname: "", requestId, target, scriptRam };
}

/**
 * @param {object|null} plan
 * @param {string} target
 * @param {string} requestId
 */
function isRequestedPlan(plan, target, requestId) {
    if (!plan || !requestId) return false;
    return plan.hostname === target && plan.requestId === requestId;
}

/**
 * @param {ReturnType<createTargetState>} state
 * @param {object} plan
 */
function applyTacticalPlan(state, plan) {
    state.phase = String(plan.next?.phase ?? state.phase);
    state.action = String(plan.next?.action ?? ActionType.NONE);
    state.reason = String(plan.next?.reason ?? "Tactical plan ready");

    state.strategy.hackPercent = Number(plan.options?.hackFraction ?? 0);
    state.strategy.growTargetPercent = Number(plan.options?.moneyTargetPercent ?? 1);
    state.money.desiredPercent = state.strategy.growTargetPercent;

    state.threads.hack = Number(plan.threads?.hack ?? 0);
    state.threads.grow = Number(plan.threads?.grow ?? 0);
    state.threads.weaken = tacticalWeakenThreads(plan);
    state.threads.requested = Number(plan.next?.requestedThreads ?? 0);
    state.threads.launched = 0;
    state.threads.remaining = state.threads.requested;

    state.tactical.status = "READY";
    state.tactical.requestId = String(plan.requestId ?? "");
    state.tactical.plannerHost = String(plan.plannerHost ?? "");
    state.tactical.calculatedAt = Number(plan.calculatedAt ?? plan.updatedAt ?? 0);
}

function tacticalWeakenThreads(plan) {
    const action = String(plan.next?.action ?? "");
    if (action === ActionType.WEAKEN) {
        return Number(plan.threads?.securityPrepWeaken ?? 0);
    }
    if (action === ActionType.GROW) {
        return Number(plan.threads?.growWeaken ?? 0);
    }
    if (action === ActionType.HACK) {
        return Number(plan.threads?.hackWeaken ?? 0);
    }
    return 0;
}

/**
 * Dispatch as much of the tactical plan as the current pool can afford. If only
 * a subset fits, target state is recalculated after that subset completes rather
 * than blindly launching the stale remainder.
 *
 * @param {NS} ns
 * @param {object|null} planner
 * @param {ReturnType<createTargetState>} state
 * @param {object} tacticalPlan
 * @param {number} sequence
 */
function dispatchTacticalAction(ns, planner, state, tacticalPlan, sequence) {
    const script = WORKER_SCRIPTS[state.action];
    const requestedThreads = Math.max(0, Math.floor(Number(tacticalPlan.next?.requestedThreads ?? 0)));

    if (!script || requestedThreads < 1) {
        return emptyDispatch(state.hostname, requestedThreads);
    }

    const jobId = `${tacticalPlan.requestId}-job-${sequence}`;
    return distributeThreads(
        ns,
        planner,
        script,
        state.hostname,
        requestedThreads,
        jobId,
        DEFAULT_HOME_RESERVE_GB,
    );
}

function emptyDispatch(target, requested = 0) {
    return {
        requested,
        launched: 0,
        remaining: requested,
        script: "",
        scriptRam: 0,
        target,
        allocations: [],
    };
}

/**
 * Cheap phase classification used only while waiting for a tactical calculation.
 * Tactical planner output replaces these placeholder decisions before dispatch.
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
    state.reason = "Target is prepared; awaiting tactical production calculation";
}

function formatNumber(value) {
    return Number(value).toFixed(2);
}
