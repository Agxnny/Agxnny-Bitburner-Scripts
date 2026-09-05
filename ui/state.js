import {
    readBatchHistoryState,
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
import { readOverlapEvidence } from "/lib/multi-overlap-evidence.js";
import { readOverlapValidationState } from "/lib/overlap-validation-state.js";
import { readTelemetryState } from "/lib/telemetry.js";

const OVERLAP_VALIDATOR = "/diagnostics/multi-overlap-validate.js";
const OVERLAP_MIXED = "/diagnostics/multi-overlap-mixed.js";

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
        batchHistory: readBatchHistoryState(ns),
        lastCompletedBatch: readLastCompletedBatchState(ns),
        scheduler: readBatchSchedulerState(ns),
        multiScheduler: readMultiTargetSchedulerState(ns),
        prepper: readPrepperState(ns),
        overlapEvidence: readOverlapEvidence(ns),
        overlapValidation: readOverlapValidationState(ns),
        validationRuntime: validationRuntime(ns),
    };
    touchState();
    return cachedState;
}

function validationRuntime(ns) {
    const validator = ns.scriptRunning(OVERLAP_VALIDATOR, "home");
    const mixed = ns.scriptRunning(OVERLAP_MIXED, "home");
    return { active: validator || mixed, validator, mixed };
}
