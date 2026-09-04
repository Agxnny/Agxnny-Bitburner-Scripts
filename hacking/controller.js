import { ActionType, TargetPhase, createTargetState } from "/lib/state.js";
import {
    RuntimePort,
    publishControllerState,
    readBatchState,
    readEconomyTargetState,
    readPlannerState,
    readTacticalPlanState,
} from "/lib/runtime-state.js";
import { DEFAULT_HOME_RESERVE_GB, WORKER_SCRIPTS, distributeThreads, getExecutionPool, summarizeExecutionPool } from "/lib/execution.js";
import { isQuiet, positionalArgs, quietArgs } from "/lib/output.js";

const TACTICAL_PLANNER_SCRIPT = "/hacking/tactical-planner.js";
const BATCH_RUNNER_SCRIPT = "/hacking/batch-runner.js";
const DEFAULT_BATCH_GAP_MS = 200;
const BATCH_SECURITY_TOLERANCE = 0.05;
const BATCH_MONEY_TOLERANCE = 0.995;
const BATCH_RETRY_MS = 2_000;
const MAX_RECENT_EVENTS = 8;
const EMPTY_PORT = "NULL PORT DATA";
const PREP_MONEY_RATIO = 0.999999;
const PREP_SECURITY_TOLERANCE = 0.001;

/** @param {NS} ns */
export async function main(ns) {
    const args = positionalArgs(ns);
    let manualTarget = args.length > 0 ? String(args[0]) : null;
    const quiet = isQuiet(ns);
    let planner = readPlannerState(ns);
    let state = manualTarget ? createManualState(manualTarget, findPlannerTarget(planner, manualTarget)) : createStateFromPlanner(planner);
    if (!state) {
        if (!quiet) {
            ns.tprint("ERROR: AUTO mode has no planner snapshot.");
            ns.tprint("Run: run hacking/planner.js");
        }
        return;
    }

    ns.disableLog("sleep");
    let activeJobs = [];
    let activeOperation = null;
    let tacticalJob = null;
    let batchJob = null;
    let lastBatchAttemptAt = 0;
    let pendingRequestId = "";
    let requestSequence = 0;
    let jobSequence = 0;
    const recentEvents = [];
    const prep = createPrepMode();
    const targetControl = createTargetControl(manualTarget);
    const executionMode = createExecutionMode();

    while (true) {
        planner = readPlannerState(ns);
        updateBatchReviewBarrier(ns, executionMode);

        if (consumeControllerRequests(ns, state, prep, targetControl, executionMode)) {
            pendingRequestId = "";
        }

        const hadActiveJobs = activeJobs.length > 0;
        activeJobs = activeJobs.filter((job) => ns.isRunning(job.pid, job.hostname));
        const operationJustFinished = hadActiveJobs && activeJobs.length === 0 && activeOperation;

        if (tacticalJob && !ns.isRunning(tacticalJob.pid, tacticalJob.hostname)) tacticalJob = null;
        if (batchJob && !ns.isRunning(batchJob.pid, batchJob.hostname)) {
            const finishedBatchJob = batchJob;
            batchJob = null;
            recordFinishedBatch(ns, executionMode, finishedBatchJob);
        }

        // A mode request is a scheduling barrier. Tactical analysis is safe to
        // cancel immediately because it has no target-side effects; already
        // running H/G/W workers or a batch are allowed to finish naturally.
        if (executionMode.pending && tacticalJob) {
            ns.kill(tacticalJob.pid, tacticalJob.hostname);
            tacticalJob = null;
            pendingRequestId = "";
            executionMode.lastMessage = `Switching to ${executionMode.pending}; tactical analysis cancelled, waiting for active execution to reach a safe boundary`;
        }

        const controllerIdle = activeJobs.length === 0 && !tacticalJob && !batchJob;

        if (executionMode.pending && controllerIdle) {
            applyExecutionModeCommand(executionMode, prep);
            pendingRequestId = "";
        }

        if (targetControl.pending && controllerIdle) {
            const result = applyTargetCommand(planner, state, prep, targetControl);
            state = result.state;
            manualTarget = targetControl.manualTarget;
            pendingRequestId = "";
        }

        if (!manualTarget && !prep.active && !prep.hold && controllerIdle) {
            const previousTarget = state.hostname;
            const previousMoneyTarget = state.money.desiredPercent;
            state = adoptLatestPlannerTarget(planner, state);
            if (state.hostname !== previousTarget || state.money.desiredPercent !== previousMoneyTarget) pendingRequestId = "";
        }

        updateObservedState(ns, state);
        const previousPrepStage = prep.stage;
        if (prep.active) choosePrepAction(state, prep);
        else if (prep.hold) choosePrepHoldAction(state, prep);
        else if (executionMode.mode === "BATCH") chooseBatchFoundationAction(state);
        else chooseFoundationAction(state);
        if (prep.stage !== previousPrepStage) pendingRequestId = "";
        syncPrepState(state, prep);
        syncTargetControlState(state, targetControl);
        syncExecutionModeState(state, executionMode, batchJob);
        updateExecutionState(ns, state, planner, activeJobs);

        if (operationJustFinished) {
            const event = createCompletionEvent(activeOperation, state);
            pushRecentEvent(recentEvents, event);
            if (!quiet) {
                ns.tprint(event.terminalLine);
                ns.tprint(event.stateLine);
            }
            activeOperation = null;
        }

        if (executionMode.pending) {
            pendingRequestId = "";
            state.tactical.status = `SWITCHING_${executionMode.pending}`;
            const blockers = [];
            if (activeJobs.length > 0) blockers.push(`${activeJobs.length} worker job(s)`);
            if (batchJob) blockers.push("current batch");
            state.reason = blockers.length
                ? `Switching execution mode to ${executionMode.pending}; no new work will be scheduled while waiting for ${blockers.join(" + ")} to finish`
                : `Switching execution mode to ${executionMode.pending}; waiting for safe boundary`;
        } else if (batchJob) {
            pendingRequestId = "";
            state.tactical.status = "BATCH_RUNNING";
            state.reason = `Synchronized HWGW batch running on ${batchJob.hostname}`;
        } else if (activeJobs.length > 0) {
            state.tactical.status = prep.active ? `PREP_${prep.stage}_RUNNING` : "WAITING_WORKERS";
            state.reason += ` | waiting for ${activeJobs.length} worker job(s)`;
        } else if (prep.hold) {
            pendingRequestId = "";
            state.tactical.status = "PREPARED_HOLD";
        } else if (executionMode.mode === "BATCH" && state.action === ActionType.NONE) {
            pendingRequestId = "";
            if (executionMode.awaitingReview) {
                state.tactical.status = "BATCH_REVIEW";
                state.reason = `Batch ${executionMode.lastBatchId || "complete"} finished; waiting for post-batch planner/economy review before the next launch`;
            } else {
                state.tactical.status = "BATCH_READY";
                if (Date.now() - lastBatchAttemptAt >= BATCH_RETRY_MS) {
                    lastBatchAttemptAt = Date.now();
                    const request = launchBatchRunner(ns, planner, state);
                    if (request.pid > 0) {
                        batchJob = request;
                        state.tactical.status = "BATCH_RUNNING";
                        state.reason = `Launched synchronized HWGW batch on ${request.hostname}`;
                    } else {
                        state.tactical.status = "BATCH_BLOCKED";
                        state.reason += " | no remote host has enough free RAM to launch the batch coordinator";
                    }
                }
            }
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
                    state.tactical.status = prep.active ? `PREP_${prep.stage}_RUNNING` : "EXECUTING";
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
                const request = launchTacticalPlanner(ns, planner, state, prep, ++requestSequence);
                if (request.pid > 0) {
                    tacticalJob = request;
                    pendingRequestId = request.requestId;
                    state.tactical.status = prep.active ? `PREP_${prep.stage}_CALCULATING` : "CALCULATING";
                    state.tactical.requestId = request.requestId;
                    state.tactical.plannerHost = request.hostname;
                    state.reason += ` | tactical calculation running on ${request.hostname}`;
                } else {
                    pendingRequestId = "";
                    state.tactical.status = "BLOCKED";
                    state.reason += " | no execution host has enough free RAM for tactical analysis";
                }
            } else {
                state.tactical.status = prep.active ? `PREP_${prep.stage}_CALCULATING` : "CALCULATING";
                state.tactical.requestId = tacticalJob.requestId;
                state.tactical.plannerHost = tacticalJob.hostname;
                state.reason += ` | tactical calculation running on ${tacticalJob.hostname}`;
            }
        }

        syncPrepState(state, prep);
        syncTargetControlState(state, targetControl);
        syncExecutionModeState(state, executionMode, batchJob);
        state.updatedAt = Date.now();
        publishControllerState(ns, state);
        if (!quiet) {
            ns.clearLog();
            printControllerState(ns, state);
            printRecentEvents(ns, recentEvents);
        }
        await ns.sleep(1000);
    }
}

function createPrepMode() {
    return {
        active: false,
        hold: false,
        stage: "",
        target: "",
        requestedAt: 0,
        completedAt: 0,
        lastMessage: "Automatic HGW",
    };
}

function createTargetControl(manualTarget) {
    return {
        manualTarget: manualTarget || "",
        pending: null,
        lastMessage: manualTarget
            ? `Manual target active: ${manualTarget}`
            : "Automatic economic target selection",
    };
}

function createExecutionMode() {
    return {
        mode: "HGW",
        pending: "",
        awaitingReview: false,
        batchCompletedAt: 0,
        lastBatchId: "",
        lastMessage: "Normal sequential HGW mode",
    };
}

function consumeControllerRequests(ns, state, prep, targetControl, executionMode) {
    const port = ns.getPortHandle(RuntimePort.CONTROL_REQUESTS);
    let changed = false;

    while (!port.empty()) {
        const raw = port.read();
        if (raw === EMPTY_PORT) break;

        let request;
        try {
            request = JSON.parse(String(raw));
        } catch {
            continue;
        }

        const action = String(request?.action ?? "").trim().toUpperCase();
        if (action === "PREP_TARGET") {
            const requestedTarget = String(request?.target ?? "").trim();
            if (requestedTarget && requestedTarget !== state.hostname) {
                prep.lastMessage = `Prep ignored: controller target changed from ${requestedTarget} to ${state.hostname}`;
                changed = true;
                continue;
            }

            prep.active = true;
            prep.hold = false;
            prep.stage = "GROW";
            prep.target = state.hostname;
            prep.requestedAt = Number(request?.requestedAt ?? Date.now());
            prep.completedAt = 0;
            prep.lastMessage = `Preparing ${state.hostname}: grow to 100%, then weaken to minimum`;
            changed = true;
        }

        if (action === "RESUME_AUTO") {
            resetPrep(prep);
            prep.lastMessage = executionMode.mode === "BATCH" ? "Automatic batched HWGW resumed" : "Automatic HGW resumed";
            changed = true;
        }

        if (action === "SET_MANUAL_TARGET") {
            const target = String(request?.target ?? "").trim();
            if (target) {
                targetControl.pending = { action, target, requestedAt: Number(request?.requestedAt ?? Date.now()) };
                targetControl.lastMessage = `Manual target change queued: ${target}`;
                changed = true;
            }
        }

        if (action === "CLEAR_MANUAL_TARGET") {
            targetControl.pending = { action, requestedAt: Number(request?.requestedAt ?? Date.now()) };
            targetControl.lastMessage = "Return to automatic target selection queued";
            changed = true;
        }

        if (action === "SET_EXECUTION_MODE") {
            const mode = String(request?.mode ?? "").trim().toUpperCase();
            if (mode === "HGW" || mode === "BATCH") {
                if (mode === executionMode.mode && !executionMode.pending) {
                    executionMode.lastMessage = mode === "BATCH" ? "Batched HWGW mode already active" : "Normal sequential HGW mode already active";
                } else {
                    executionMode.pending = mode;
                    executionMode.lastMessage = `Switching execution mode to ${mode}; new work is paused until the current safe boundary`;
                }
                changed = true;
            }
        }
    }

    return changed;
}

function applyExecutionModeCommand(executionMode, prep) {
    const mode = executionMode.pending;
    executionMode.pending = "";
    if (mode !== "HGW" && mode !== "BATCH") return;
    executionMode.mode = mode;
    executionMode.awaitingReview = false;
    executionMode.batchCompletedAt = 0;
    resetPrep(prep);
    executionMode.lastMessage = mode === "BATCH"
        ? "Batched HWGW mode active; controller will prep and launch synchronized batches"
        : "Normal sequential HGW mode active";
}

function recordFinishedBatch(ns, executionMode, finishedJob) {
    const batch = readBatchState(ns);
    const batchId = String(batch?.batchId ?? "");
    const target = String(batch?.target ?? "");
    if (batch?.status === "COMPLETE" && batchId && target === finishedJob.target) {
        executionMode.awaitingReview = true;
        executionMode.batchCompletedAt = Number(batch?.finishedAt ?? batch?.updatedAt ?? Date.now());
        executionMode.lastBatchId = batchId;
        executionMode.lastMessage = `Batch ${batchId} complete; waiting for post-batch strategic review`;
        return;
    }

    const status = String(batch?.status ?? "UNKNOWN");
    executionMode.lastMessage = `Batch runner exited with state ${status}; controller will re-evaluate target readiness`;
}

function updateBatchReviewBarrier(ns, executionMode) {
    if (!executionMode.awaitingReview) return;
    const economic = readEconomyTargetState(ns);
    const reviewedAt = Number(economic?.updatedAt ?? 0);
    if (reviewedAt <= executionMode.batchCompletedAt) return;

    executionMode.awaitingReview = false;
    executionMode.lastMessage = `Post-batch strategic review complete for ${executionMode.lastBatchId}; next batch may launch`;
}

function applyTargetCommand(planner, currentState, prep, targetControl) {
    const command = targetControl.pending;
    targetControl.pending = null;
    if (!command) return { state: currentState };

    if (command.action === "CLEAR_MANUAL_TARGET") {
        targetControl.manualTarget = "";
        resetPrep(prep);
        const automatic = createStateFromPlanner(planner);
        if (automatic) {
            targetControl.lastMessage = `Automatic target selection restored: ${automatic.hostname}`;
            return { state: automatic };
        }
        targetControl.lastMessage = "Automatic target selection restored; waiting for planner target";
        return { state: currentState };
    }

    const target = String(command.target ?? "").trim();
    const analysis = findPlannerTarget(planner, target);
    if (!analysis) {
        targetControl.lastMessage = `Manual target rejected: ${target} is not currently an eligible planner target`;
        return { state: currentState };
    }

    resetPrep(prep);
    const next = createManualState(target, analysis);
    targetControl.manualTarget = target;
    targetControl.lastMessage = `Manual target active: ${target}`;
    return { state: next };
}

function resetPrep(prep) {
    prep.active = false;
    prep.hold = false;
    prep.stage = "";
    prep.target = "";
    prep.requestedAt = 0;
    prep.completedAt = 0;
}

function syncPrepState(state, prep) {
    state.prep = {
        active: prep.active,
        hold: prep.hold,
        stage: prep.stage,
        target: prep.target,
        requestedAt: prep.requestedAt,
        completedAt: prep.completedAt,
        lastMessage: prep.lastMessage,
        mode: prep.hold ? "HOLDING" : prep.active ? "PREP" : "AUTO",
    };
}

function syncTargetControlState(state, targetControl) {
    state.targetControl = {
        mode: targetControl.manualTarget ? "MANUAL" : "AUTO",
        manualTarget: targetControl.manualTarget,
        pending: targetControl.pending ? String(targetControl.pending.action ?? "") : "",
        lastMessage: targetControl.lastMessage,
    };
}

function syncExecutionModeState(state, executionMode, batchJob) {
    state.executionMode = {
        mode: executionMode.mode,
        pending: executionMode.pending,
        transitioning: Boolean(executionMode.pending),
        transitionTarget: executionMode.pending,
        batchGapMs: DEFAULT_BATCH_GAP_MS,
        batchRunning: Boolean(batchJob),
        batchRunnerHost: String(batchJob?.hostname ?? ""),
        awaitingReview: executionMode.awaitingReview,
        batchCompletedAt: executionMode.batchCompletedAt,
        lastBatchId: executionMode.lastBatchId,
        lastMessage: executionMode.lastMessage,
    };
}

function choosePrepAction(state, prep) {
    state.money.desiredPercent = 1;

    const moneyReady = state.money.max > 0 && state.money.current >= state.money.max * PREP_MONEY_RATIO;
    if (prep.stage === "GROW" && !moneyReady) {
        state.phase = TargetPhase.MONEY_PREP;
        state.action = ActionType.GROW;
        state.reason = "Prep mode: growing continuously to 100% money before weakening";
        return;
    }

    if (prep.stage === "GROW") {
        prep.stage = "WEAKEN";
        prep.lastMessage = `${state.hostname} money is full; weakening to minimum security`;
    }

    const securityDelta = Math.max(0, state.security.current - state.security.minimum);
    if (securityDelta > PREP_SECURITY_TOLERANCE) {
        state.phase = TargetPhase.SECURITY_PREP;
        state.action = ActionType.WEAKEN;
        state.reason = `Prep mode: money full, weakening security +${formatNumber(securityDelta)} to minimum`;
        return;
    }

    prep.active = false;
    prep.hold = true;
    prep.stage = "READY";
    prep.completedAt = Date.now();
    prep.lastMessage = `${state.hostname} prepared at 100% money and minimum security; holding for batch work`;
    choosePrepHoldAction(state, prep);
}

function choosePrepHoldAction(state, prep) {
    state.money.desiredPercent = 1;
    state.phase = TargetPhase.PRODUCTION;
    state.action = ActionType.NONE;
    state.reason = `Prep complete: ${prep.target || state.hostname} is held at 100% money / minimum security until Resume Auto`;
}

function chooseBatchFoundationAction(state) {
    const desiredMoney = state.money.max * state.money.desiredPercent;
    const securityDelta = Math.max(0, state.security.current - state.security.minimum);

    if (securityDelta > BATCH_SECURITY_TOLERANCE) {
        state.phase = TargetPhase.SECURITY_PREP;
        state.action = ActionType.WEAKEN;
        state.reason = `Batch mode prep: security +${formatNumber(securityDelta)} must be within +${BATCH_SECURITY_TOLERANCE.toFixed(2)}`;
        return;
    }

    if (state.money.max > 0 && state.money.current < desiredMoney * BATCH_MONEY_TOLERANCE) {
        state.phase = TargetPhase.MONEY_PREP;
        state.action = ActionType.GROW;
        state.reason = `Batch mode prep: money below ${(state.money.desiredPercent * 100).toFixed(0)}% strategy target`;
        return;
    }

    state.phase = TargetPhase.PRODUCTION;
    state.action = ActionType.NONE;
    state.reason = `Batch-ready at ${(state.money.desiredPercent * 100).toFixed(0)}% money and near-minimum security`;
}

function createManualState(hostname, analysis = null) {
    const state = createTargetState(hostname);
    if (analysis) applyPlannerAnalysis(state, analysis);
    state.selection.mode = "MANUAL";
    state.selection.rank = Number(analysis?.rank ?? 0);
    state.strategy.hackPercent = 0.10;
    state.strategy.growTargetPercent = 1;
    state.money.desiredPercent = 1;
    return state;
}

function findPlannerTarget(planner, hostname) {
    const rankings = Array.isArray(planner?.rankings) ? planner.rankings : [];
    return rankings.find((target) => String(target?.hostname ?? "") === hostname) ?? null;
}

function createStateFromPlanner(planner) {
    const selected = planner?.selectedTarget;
    if (!selected?.hostname) return null;
    const state = createTargetState(selected.hostname);
    applyPlannerAnalysis(state, selected);
    applyEconomicStrategy(state, planner);
    return state;
}

function adoptLatestPlannerTarget(planner, currentState) {
    const selected = planner?.selectedTarget;
    if (!selected?.hostname) return currentState;
    if (selected.hostname !== currentState.hostname) {
        const nextState = createTargetState(selected.hostname);
        applyPlannerAnalysis(nextState, selected);
        applyEconomicStrategy(nextState, planner);
        return nextState;
    }
    applyPlannerAnalysis(currentState, selected);
    applyEconomicStrategy(currentState, planner);
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

function applyEconomicStrategy(state, planner) {
    const economic = planner?.economicSelection;
    const applies = economic?.hostname === state.hostname;
    const hackFraction = applies ? Number(economic?.hackFraction ?? 0.10) : 0.10;
    const moneyTargetPercent = applies ? Number(economic?.moneyTargetPercent ?? 1) : 1;

    state.strategy.hackPercent = clamp(hackFraction, 0.001, 0.90);
    state.strategy.growTargetPercent = clamp(moneyTargetPercent, 0.01, 1);
    state.money.desiredPercent = state.strategy.growTargetPercent;
    if (applies) {
        state.strategy.expectedIncomePerSecond = Number(economic?.steadyIncomePerSecond ?? state.strategy.expectedIncomePerSecond ?? 0);
    }
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

function launchBatchRunner(ns, planner, state) {
    const scriptRam = ns.getScriptRam(BATCH_RUNNER_SCRIPT, "home");
    if (!(scriptRam > 0)) return { pid: 0, hostname: "", scriptRam };

    const hackFraction = clamp(Number(state.strategy.hackPercent ?? 0.10), 0.001, 0.90);
    const moneyTargetPercent = clamp(Number(state.money.desiredPercent ?? 1), 0.01, 1);
    for (const host of getExecutionPool(ns, planner, DEFAULT_HOME_RESERVE_GB)) {
        if (host.usableRam < scriptRam) continue;
        const pid = ns.exec(
            BATCH_RUNNER_SCRIPT,
            host.hostname,
            1,
            state.hostname,
            hackFraction,
            DEFAULT_BATCH_GAP_MS,
            moneyTargetPercent,
            ...quietArgs(ns),
        );
        if (pid > 0) return { pid, hostname: host.hostname, scriptRam, target: state.hostname };
    }
    return { pid: 0, hostname: "", scriptRam, target: state.hostname };
}

function launchTacticalPlanner(ns, planner, state, prep, sequence) {
    const scriptRam = ns.getScriptRam(TACTICAL_PLANNER_SCRIPT, "home");
    const requestId = `tactical-${Date.now()}-${sequence}`;
    const target = state.hostname;
    if (scriptRam <= 0) return { pid: 0, hostname: "", requestId, target };

    const hackFraction = clamp(Number(state.strategy.hackPercent ?? 0.10), 0.001, 0.99);
    const moneyTargetPercent = prep.active ? 1 : clamp(Number(state.money.desiredPercent ?? 1), 0.01, 1);
    const tacticalMode = prep.active
        ? prep.stage === "GROW" ? "PREP_GROW" : "PREP_WEAKEN"
        : "";

    for (const host of getExecutionPool(ns, planner, DEFAULT_HOME_RESERVE_GB)) {
        if (host.usableRam < scriptRam) continue;
        const pid = ns.exec(
            TACTICAL_PLANNER_SCRIPT,
            host.hostname,
            1,
            target,
            requestId,
            hackFraction,
            moneyTargetPercent,
            tacticalMode,
            ...quietArgs(ns),
        );
        if (pid > 0) return { pid, hostname: host.hostname, requestId, target, scriptRam, tacticalMode };
    }
    return { pid: 0, hostname: "", requestId, target, scriptRam, tacticalMode };
}

function isRequestedPlan(plan, target, requestId) {
    return Boolean(plan && requestId && plan.hostname === target && plan.requestId === requestId);
}

function applyTacticalPlan(state, plan) {
    state.phase = String(plan.next?.phase ?? state.phase);
    state.action = String(plan.next?.action ?? ActionType.NONE);
    state.reason = String(plan.next?.reason ?? "Tactical plan ready");
    state.strategy.hackPercent = Number(plan.options?.hackFraction ?? state.strategy.hackPercent ?? 0.10);
    state.strategy.growTargetPercent = Number(plan.options?.moneyTargetPercent ?? state.money.desiredPercent ?? 1);
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
        state.reason = `Money is below the ${(state.money.desiredPercent * 100).toFixed(0)}% strategy target`;
        return;
    }
    state.phase = TargetPhase.PRODUCTION;
    state.action = ActionType.HACK;
    state.reason = `Target is prepared to ${(state.money.desiredPercent * 100).toFixed(0)}%; awaiting tactical production calculation`;
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
    ns.print(`Execution: ${state.executionMode?.mode ?? "HGW"}${state.executionMode?.pending ? ` / SWITCHING → ${state.executionMode.pending}` : state.executionMode?.batchRunning ? " / BATCH RUNNING" : state.executionMode?.awaitingReview ? " / REVIEW" : ""}`);
    ns.print(`Targeting: ${state.targetControl?.mode ?? "AUTO"}${state.targetControl?.manualTarget ? ` / ${state.targetControl.manualTarget}` : ""}`);
    ns.print(`Money:     $${ns.format.number(state.money.current, 2)} / $${ns.format.number(state.money.max, 2)} (${moneyPercent(state).toFixed(1)}%) | desired ${(state.money.desiredPercent * 100).toFixed(0)}%`);
    ns.print(`Security:  ${state.security.current.toFixed(2)} / ${state.security.minimum.toFixed(2)} (+${Math.max(0, state.security.current - state.security.minimum).toFixed(2)})`);
    ns.print(`Threads:   ${state.execution.activeThreads} active | ${state.execution.activeJobs} job(s)`);
    ns.print(`Tactical:  ${state.tactical.status}`);
    ns.print(`Prep:      ${state.prep?.mode ?? "AUTO"}${state.prep?.stage ? ` / ${state.prep.stage}` : ""}`);
    ns.print(`Reason:    ${state.reason}`);
}

function formatTargetState(state) {
    return `${state.hostname} | money $${formatCompactNumber(state.money.current)}/$${formatCompactNumber(state.money.max)} (${moneyPercent(state).toFixed(1)}%, desired ${(state.money.desiredPercent * 100).toFixed(0)}%) | security ${state.security.current.toFixed(2)}/${state.security.minimum.toFixed(2)} (+${Math.max(0, state.security.current - state.security.minimum).toFixed(2)})`;
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

function clamp(value, minimum, maximum) {
    if (!Number.isFinite(value)) return minimum;
    return Math.min(maximum, Math.max(minimum, value));
}
