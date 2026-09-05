// Shared runtime-state transport.
//
// Port 1 stores the latest controller snapshot.
// Port 2 stores the latest short-lived network/target planner snapshot.
// Port 3 stores the latest short-lived tactical thread-plan snapshot.
// Port 7 stores the latest short-lived economy/progression snapshot.
// Port 8 stores the latest economic target-selection snapshot.
// Port 9 stores the latest lightweight rooting/tool-discovery snapshot.
// Port 10 stores the latest automated cloud-server purchase snapshot.
// Port 11 stores the user-controlled manual money-goal snapshot.
// Port 12 stores the latest synchronized HWGW batch snapshot.
// Port 13 is a controller command queue used by lightweight GUI controls.
// Port 14 is a synchronized-batch worker completion/timing event queue.
// Port 15 stores the latest completed synchronized batch snapshot.
// Port 16 stores the latest single-target pipeline scheduler/executor snapshot.
// Port 17 stores the latest global multi-target allocation-planner snapshot.
// Snapshot writers replace the current value; Ports 13 and 14 are intentionally
// consumed as queues instead of latest-value state slots.

export const RuntimePort = Object.freeze({
    CONTROLLER_STATE: 1,
    PLANNER_STATE: 2,
    TACTICAL_PLAN_STATE: 3,
    ECONOMY_STATE: 7,
    ECONOMY_TARGET_STATE: 8,
    ROOT_STATE: 9,
    CLOUD_PURCHASE_STATE: 10,
    MANUAL_MONEY_GOAL_STATE: 11,
    BATCH_STATE: 12,
    CONTROL_REQUESTS: 13,
    BATCH_TIMING_EVENTS: 14,
    LAST_COMPLETED_BATCH_STATE: 15,
    BATCH_SCHEDULER_STATE: 16,
    MULTI_TARGET_SCHEDULER_STATE: 17,
});

const EMPTY_PORT = "NULL PORT DATA";

/** @param {NS} ns @param {object} state */
export function publishControllerState(ns, state) {
    replaceSnapshot(ns, RuntimePort.CONTROLLER_STATE, state);
}

/** @param {NS} ns */
export function readControllerState(ns) {
    return readSnapshot(ns, RuntimePort.CONTROLLER_STATE);
}

/** @param {NS} ns @param {object} state */
export function publishPlannerState(ns, state) {
    replaceSnapshot(ns, RuntimePort.PLANNER_STATE, state);
}

/** @param {NS} ns */
export function readPlannerState(ns) {
    return readSnapshot(ns, RuntimePort.PLANNER_STATE);
}

/** @param {NS} ns @param {object} state */
export function publishTacticalPlanState(ns, state) {
    replaceSnapshot(ns, RuntimePort.TACTICAL_PLAN_STATE, state);
}

/** @param {NS} ns */
export function readTacticalPlanState(ns) {
    return readSnapshot(ns, RuntimePort.TACTICAL_PLAN_STATE);
}

/** @param {NS} ns @param {object} state */
export function publishEconomyState(ns, state) {
    replaceSnapshot(ns, RuntimePort.ECONOMY_STATE, state);
}

/** @param {NS} ns */
export function readEconomyState(ns) {
    return readSnapshot(ns, RuntimePort.ECONOMY_STATE);
}

/** @param {NS} ns @param {object} state */
export function publishEconomyTargetState(ns, state) {
    replaceSnapshot(ns, RuntimePort.ECONOMY_TARGET_STATE, state);
}

/** @param {NS} ns */
export function readEconomyTargetState(ns) {
    return readSnapshot(ns, RuntimePort.ECONOMY_TARGET_STATE);
}

/** @param {NS} ns @param {object} state */
export function publishRootState(ns, state) {
    replaceSnapshot(ns, RuntimePort.ROOT_STATE, state);
}

/** @param {NS} ns */
export function readRootState(ns) {
    return readSnapshot(ns, RuntimePort.ROOT_STATE);
}

/** @param {NS} ns @param {object} state */
export function publishCloudPurchaseState(ns, state) {
    replaceSnapshot(ns, RuntimePort.CLOUD_PURCHASE_STATE, state);
}

/** @param {NS} ns */
export function readCloudPurchaseState(ns) {
    return readSnapshot(ns, RuntimePort.CLOUD_PURCHASE_STATE);
}

/** @param {NS} ns @param {object} state */
export function publishManualMoneyGoalState(ns, state) {
    replaceSnapshot(ns, RuntimePort.MANUAL_MONEY_GOAL_STATE, state);
}

/** @param {NS} ns */
export function readManualMoneyGoalState(ns) {
    return readSnapshot(ns, RuntimePort.MANUAL_MONEY_GOAL_STATE);
}

/** @param {NS} ns @param {object} state */
export function publishBatchState(ns, state) {
    replaceSnapshot(ns, RuntimePort.BATCH_STATE, state);
}

/** @param {NS} ns */
export function readBatchState(ns) {
    return readSnapshot(ns, RuntimePort.BATCH_STATE);
}

/** @param {NS} ns @param {object} state */
export function publishLastCompletedBatchState(ns, state) {
    replaceSnapshot(ns, RuntimePort.LAST_COMPLETED_BATCH_STATE, state);
}

/** @param {NS} ns */
export function readLastCompletedBatchState(ns) {
    return readSnapshot(ns, RuntimePort.LAST_COMPLETED_BATCH_STATE);
}

/** @param {NS} ns @param {object} state */
export function publishBatchSchedulerState(ns, state) {
    replaceSnapshot(ns, RuntimePort.BATCH_SCHEDULER_STATE, state);
}

/** @param {NS} ns */
export function readBatchSchedulerState(ns) {
    return readSnapshot(ns, RuntimePort.BATCH_SCHEDULER_STATE);
}

/** @param {NS} ns @param {object} state */
export function publishMultiTargetSchedulerState(ns, state) {
    replaceSnapshot(ns, RuntimePort.MULTI_TARGET_SCHEDULER_STATE, state);
}

/** @param {NS} ns */
export function readMultiTargetSchedulerState(ns) {
    return readSnapshot(ns, RuntimePort.MULTI_TARGET_SCHEDULER_STATE);
}

/**
 * Consider controller data stale if it has not been refreshed recently.
 *
 * @param {object|null} state
 * @param {number} maxAgeMs
 */
export function isControllerStateStale(state, maxAgeMs = 3000) {
    if (!state || !Number.isFinite(state.updatedAt)) return true;
    return Date.now() - state.updatedAt > maxAgeMs;
}

/** @param {NS} ns @param {number} portNumber @param {object} value */
function replaceSnapshot(ns, portNumber, value) {
    const port = ns.getPortHandle(portNumber);
    port.clear();
    port.write(JSON.stringify(value));
}

/** @param {NS} ns @param {number} portNumber */
function readSnapshot(ns, portNumber) {
    const raw = ns.getPortHandle(portNumber).peek();
    if (raw === EMPTY_PORT) return null;

    try {
        return JSON.parse(String(raw));
    } catch {
        return null;
    }
}
