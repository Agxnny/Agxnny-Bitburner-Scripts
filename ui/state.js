import {
    readBatchSchedulerState,
    readBatchState,
    readCloudPurchaseState,
    readControllerState,
    readEconomyState,
    readEconomyTargetState,
    readLastCompletedBatchState,
    readManualMoneyGoalState,
    readMultiTargetSchedulerState,
    readPlannerState,
    readPrepperState,
    readRootState,
    readTacticalPlanState,
} from "/lib/runtime-state.js";
import { readTelemetryState } from "/lib/telemetry.js";

let cachedState = null;
let stateVersion = 0;

export function getCachedState() { return cachedState ?? {}; }
export function getStateVersion() { return stateVersion; }
export function touchState() { stateVersion += 1; }

/** @param {NS} ns */
export function refreshSnapshot(ns) {
    cachedState = {
        controller: readControllerState(ns),
        planner: readPlannerState(ns),
        tactical: readTacticalPlanState(ns),
        economy: readEconomyState(ns),
        economic: readEconomyTargetState(ns),
        telemetry: readTelemetryState(ns),
        root: readRootState(ns),
        purchase: readCloudPurchaseState(ns),
        manualGoal: readManualMoneyGoalState(ns),
        batch: readBatchState(ns),
        lastCompletedBatch: readLastCompletedBatchState(ns),
        scheduler: readBatchSchedulerState(ns),
        multiScheduler: readMultiTargetSchedulerState(ns),
        prepper: readPrepperState(ns),
    };
    touchState();
    return cachedState;
}
