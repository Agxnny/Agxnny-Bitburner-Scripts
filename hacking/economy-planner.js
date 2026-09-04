import { buildProgressionAdvice } from "/lib/progression.js";
import {
    publishEconomyState,
    readManualMoneyGoalState,
} from "/lib/runtime-state.js";
import { readTelemetryState } from "/lib/telemetry.js";

/**
 * Short-lived economy/progression planner.
 *
 * When a manual money goal is active it overrides the automatic progression goal
 * for economic target selection and keeps automated spending disabled. Automatic
 * progression candidates are still published for visibility, but none is treated
 * as the active goal until the manual goal is cleared.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const advice = buildProgressionAdvice(ns, readTelemetryState(ns));
    const automaticSelected = advice?.selected ?? null;
    const manual = readManualMoneyGoalState(ns);
    const cash = Math.max(0, Number(advice?.context?.cash ?? 0));
    const manualActive = Boolean(manual?.active) && Number(manual?.targetCash ?? 0) > 0;
    const selected = manualActive
        ? buildManualGoal(manual, cash)
        : automaticSelected;

    const snapshot = {
        version: 3,
        updatedAt: Date.now(),
        mode: manualActive
            ? (selected?.ready ? "MANUAL_GOAL_READY" : "MANUAL_MONEY_FOCUS")
            : String(advice?.mode ?? "OBSERVING"),
        cash,
        incomePerSecond: Math.max(0, Number(advice?.context?.incomePerSecond ?? 0)),
        incomeSource: String(advice?.context?.incomeSource ?? "none"),
        manualMoneyGoal: manualActive ? {
            active: true,
            targetCash: Number(manual.targetCash),
            title: String(manual.title ?? "Manual cash goal"),
            updatedAt: Number(manual.updatedAt ?? 0),
            automatedPurchasingLocked: true,
        } : {
            active: false,
            automatedPurchasingLocked: false,
        },
        automaticGoal: automaticSelected ? serializeGoal(automaticSelected, advice?.context?.cash) : null,
        goal: selected ? serializeGoal(selected, advice?.context?.cash) : null,
        candidates: Array.isArray(advice?.candidates)
            ? advice.candidates.slice(0, 5).map((candidate) => ({
                id: String(candidate.id ?? ""),
                type: String(candidate.type ?? ""),
                title: String(candidate.title ?? ""),
                cost: Math.max(0, Number(candidate.cost ?? 0)),
                remaining: Math.max(0, Number(candidate.remaining ?? 0)),
                ready: Boolean(candidate.ready),
                valueScore: Number(candidate.valueScore ?? 0),
                metadata: candidate.metadata ?? {},
            }))
            : [],
    };

    publishEconomyState(ns, snapshot);
}

function buildManualGoal(manual, cash) {
    const targetCash = Math.max(0, Number(manual?.targetCash ?? 0));
    const remaining = Math.max(0, targetCash - cash);
    const ready = remaining <= 0;
    return {
        id: "manual-money-goal",
        type: "MANUAL_MONEY",
        title: String(manual?.title ?? "Manual cash goal"),
        cost: targetCash,
        currentCash: cash,
        remaining,
        ready,
        valueScore: 0,
        recommendation: ready
            ? "Manual money goal reached. Automated purchasing remains locked until the manual goal is cleared."
            : "Accumulate cash toward the manual goal. Automated purchasing is locked while this goal is active.",
        metadata: {
            manual: true,
            targetCash,
            automatedPurchasingLocked: true,
        },
    };
}

function serializeGoal(goal, fallbackCash) {
    return {
        id: String(goal.id ?? ""),
        type: String(goal.type ?? ""),
        title: String(goal.title ?? ""),
        cost: Math.max(0, Number(goal.cost ?? 0)),
        currentCash: Math.max(0, Number(goal.currentCash ?? fallbackCash ?? 0)),
        remaining: Math.max(0, Number(goal.remaining ?? 0)),
        ready: Boolean(goal.ready),
        valueScore: Number(goal.valueScore ?? 0),
        recommendation: String(goal.recommendation ?? ""),
        metadata: goal.metadata ?? {},
    };
}
