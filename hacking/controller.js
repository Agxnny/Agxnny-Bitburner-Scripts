import { ActionType, TargetPhase, createTargetState } from "/lib/state.js";
import { publishControllerState, readPlannerState, readTacticalPlanState } from "/lib/runtime-state.js";
import { DEFAULT_HOME_RESERVE_GB, WORKER_SCRIPTS, distributeThreads, getExecutionPool, summarizeExecutionPool } from "/lib/execution.js";

const TACTICAL_PLANNER_SCRIPT = "/hacking/tactical-planner.js";
const MAX_RECENT_EVENTS = 8;

/** @param {NS} ns */
export async function main(ns) {
    const manualTarget = ns.args.length > 0 ? String(ns.args[0]) : null;
    let planner = readPlannerState(ns);
    let state = manualTarget ? createManualState(manualTarget) : createStateFromPlanner(planner);
    if (!state) {
        ns.tprint("ERROR: AUTO mode has no planner snapshot.");
        ns.tprint("Run: run hacking/planner.js");
        return;
    }

    ns.disableLog("sleep");
    let activeJobs = [];
    let activeOperation = null;
    let tacticalJob = null;
    let pendingRequestId = "";
    let requestSequence = 0;
    let jobSequence = 0;
    const recentEvents = [];

    while (true) {
        planner = readPlannerState(ns);
        const hadActiveJobs = activeJobs.length > 0;
        activeJobs = activeJobs.filter((job) => ns.isRunning(job.pid, job.hostname));
        const operationJustFinished = hadActiveJobs && activeJobs.length === 0 && activeOperation;

        if (tacticalJob && !ns.isRunning(tacticalJob.pid, tacticalJob.hostname)) tacticalJob = null;

        if (!manualTarget && activeJobs.length === 0 && !tacticalJob) {
            const previousTarget = state.hostname;
            state = adoptLatestPlannerTarget(planner, state);
            if (state.hostname !== previousTarget) pendingRequestId = "";
        }

        updateObservedState(ns, state);
        chooseFoundationAction(state);
        updateExecutionState(ns, state, planner, activeJobs);

        if (operationJustFinished) {
            const event = createCompletionEvent(activeOperation, state);
            pushRecentEvent(recentEvents, event);
            ns.tprint(event.terminalLine);
            ns.tprint(event.stateLine);
            activeOperation = null;
        }

        if (activeJobs.length > 0) {
            state.tactical.status = "WAITING_WORKERS";
            state.reason += ` | waiting for ${activeJobs.length} worker job(s)`;
        } else {
            const tacticalPlan = readTacticalPlanState(ns);
            if (isRequestedPlan(tacticalPlan, state.hostname, pendingRequestId)) {
                applyTacticalPlan(state, tacticalPlan);
                const dispatch = dispatchTacticalAction(ns, planner, state, tacticalPlan, ++jobSequence);
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
                    pendingRequestId = "";
                    state.tactical.status = "EXECUTING";
                    state.execution.activeJobs = activeJobs.length;
                    state.execution.activeThreads = dispatch.launched;
                    state.reason += ` | dispatched ${dispatch.launched}/${dispatch.requested} thread(s)`;
                    activeOperation = {
                        action: state.action,
                        target: state.hostname,
                        threads: dispatch.launched,
                        jobs: activeJobs.length,
                        startedAt: Date.now(),
                    };
                } else {
                    state.tactical.status = "READY";
                    state.reason += " | calculated plan ready, waiting for deployable RAM";
                }
            } else if (!tacticalJob) {
                const request = launchTacticalPlanner(ns, planner, state.hostname, ++requestSequence);
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
        printControllerState(ns, state);
        printRecentEvents(ns, recentEvents);
        await ns.sleep(1000);
    }
}

function createManualState(hostname) {
    const state = createTargetState(hostname);
    state.selection.mode = "MANUAL";
    state.selection.rank = 0;
    return state;
}

function createStateFromPlanner(planner) {
    const selected = planner?.selectedTarget;
    if (!selected?.hostname) return null;
    const state = createTargetState(selected.hostname);
    applyPlannerAnalysis(state, selected);
    return state;
}

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

function updateObservedState(ns, state) {
    state.money.current = ns.getServerMoneyAvailable(state.hostname);
    state.money.max = ns.getServerMaxMoney(state.hostname);
    state.security.current = ns.getServerSecurityLevel(state.hostname);
    state.security.minimum = ns.getServerMinSecurityLevel(state.hostname);
    state.security.desired = state.security.minimum;
}

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

function launchTacticalPlanner(ns, planner, target, sequence) {
    const scriptRam = ns.getScriptRam(TACTICAL_PLANNER_SCRIPT, "home");
    const requestId = `tactical-${Date.now()}-${sequence}`;
    if (scriptRam <= 0) return { pid: 0, hostname: "", requestId, target };
    for (const host of getExecutionPool(ns, planner, DEFAULT_HOME_RESERVE_GB)) {
        if (host.usableRam < scriptRam) continue;
        const pid = ns.exec(TACTICAL_PLANNER_SCRIPT, host.hostname, 1, target, requestId);
        if (pid > 0) return { pid, hostname: host.hostname, requestId, target, scriptRam };
    }
    return { pid: 0, hostname: "", requestId, target, scriptRam };
}

function isRequestedPlan(plan, target, requestId) {
    return Boolean(plan && requestId && plan.hostname === target && plan.requestId === requestId);
}

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
    if (action === ActionType.WEAKEN) return Number(plan.threads?.securityPrepWeaken ?? 0);
    if (action === ActionType.GROW) return Number(plan.threads?.growWeaken ?? 0);
    if (action === ActionType.HACK) return Number(plan.threads?.hackWeaken ?? 0);
    return 0;
}

function dispatchTacticalAction(ns, planner, state, tacticalPlan, sequence) {
    const script = WORKER_SCRIPTS[state.action];
    const requestedThreads = Math.max(0, Math.floor(Number(tacticalPlan.next?.requestedThreads ?? 0)));
    if (!script || requestedThreads < 1) return emptyDispatch(state.hostname, requestedThreads);
    const jobId = `${tacticalPlan.requestId}-job-${sequence}`;
    return distributeThreads(ns, planner, script, state.hostname, requestedThreads, jobId, DEFAULT_HOME_RESERVE_GB);
}

function emptyDispatch(target, requested = 0) {
    return { requested, launched: 0, remaining: requested, script: "", scriptRam: 0, target, allocations: [] };
}

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

function createCompletionEvent(operation, state) {
    const elapsedMs = Math.max(0, Date.now() - Number(operation.startedAt ?? Date.now()));
    const nextAction = state.action;
    const nextEstimateMs = getEstimatedActionTimeMs(state, nextAction);
    const finished = `${operation.action} ${operation.target} finished | ${operation.threads} thread(s) | ${formatDuration(elapsedMs)}`;
    const next = `NEXT ${nextAction} | estimated ${formatDuration(nextEstimateMs)} | ${state.phase}`;
    return {
        at: Date.now(),
        finished,
        next,
        terminalLine: `[HGW] ${finished} | ${next}`,
        stateLine: `[STATE] ${formatTargetState(state)}`,
    };
}

function getEstimatedActionTimeMs(state, action) {
    if (action === ActionType.HACK) return Number(state.analysis.hackTimeMs ?? 0);
    if (action === ActionType.GROW) return Number(state.analysis.growTimeMs ?? 0);
    if (action === ActionType.WEAKEN) return Number(state.analysis.weakenTimeMs ?? 0);
    return 0;
}

function printControllerState(ns, state) {
    ns.print("=== CONTROLLER STATE ===");
    ns.print(`Target:    ${state.hostname} | ${state.phase} | ${state.action}`);
    ns.print(`Money:     $${ns.format.number(state.money.current, 2)} / $${ns.format.number(state.money.max, 2)} (${moneyPercent(state).toFixed(1)}%)`);
    ns.print(`Security:  ${state.security.current.toFixed(2)} / ${state.security.minimum.toFixed(2)} (+${Math.max(0, state.security.current - state.security.minimum).toFixed(2)})`);
    ns.print(`Threads:   ${state.execution.activeThreads} active | ${state.execution.activeJobs} job(s)`);
    ns.print(`Tactical:  ${state.tactical.status}`);
    ns.print(`Reason:    ${state.reason}`);
}

function formatTargetState(state) {
    return `${state.hostname} | money $${formatCompactNumber(state.money.current)}/$${formatCompactNumber(state.money.max)} (${moneyPercent(state).toFixed(1)}%) | security ${state.security.current.toFixed(2)}/${state.security.minimum.toFixed(2)} (+${Math.max(0, state.security.current - state.security.minimum).toFixed(2)})`;
}

function moneyPercent(state) {
    return state.money.max > 0 ? (state.money.current / state.money.max) * 100 : 0;
}

function formatCompactNumber(value) {
    const number = Math.max(0, Number(value) || 0);
    if (number >= 1e12) return `${(number / 1e12).toFixed(2)}t`;
    if (number >= 1e9) return `${(number / 1e9).toFixed(2)}b`;
    if (number >= 1e6) return `${(number / 1e6).toFixed(2)}m`;
    if (number >= 1e3) return `${(number / 1e3).toFixed(2)}k`;
    return number.toFixed(2);
}

function pushRecentEvent(events, event) {
    events.push(event);
    while (events.length > MAX_RECENT_EVENTS) events.shift();
}

function printRecentEvents(ns, events) {
    if (events.length === 0) return;
    ns.print("");
    ns.print("=== RECENT HGW COMPLETIONS ===");
    for (const event of events) {
        ns.print(event.finished);
        ns.print(`  ${event.stateLine}`);
        ns.print(`  ${event.next}`);
    }
}

function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Number(milliseconds) || 0) / 1000;
    if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds - minutes * 60;
    if (minutes < 60) return `${minutes}m ${seconds.toFixed(1)}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes - hours * 60}m ${seconds.toFixed(0)}s`;
}

function formatNumber(value) {
    return Number(value).toFixed(2);
}
