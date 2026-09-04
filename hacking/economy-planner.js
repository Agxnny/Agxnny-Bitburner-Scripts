import { buildProgressionAdvice } from "/lib/progression.js";
import { publishEconomyState } from "/lib/runtime-state.js";
import { readTelemetryState } from "/lib/telemetry.js";

/**
 * Short-lived economy/progression planner.
 *
 * This script is intentionally kept out of the persistent home controller
 * because cloud/progression APIs carry meaningful static RAM costs. The
 * controller launches it on remote RAM when the cached economy snapshot needs a
 * refresh, then consumes the compact state from Port 7.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const advice = buildProgressionAdvice(ns, readTelemetryState(ns));
    const selected = advice?.selected ?? null;

    const snapshot = {
        version: 1,
        updatedAt: Date.now(),
        mode: String(advice?.mode ?? "OBSERVING"),
        cash: Math.max(0, Number(advice?.context?.cash ?? 0)),
        incomePerSecond: Math.max(0, Number(advice?.context?.incomePerSecond ?? 0)),
        incomeSource: String(advice?.context?.incomeSource ?? "none"),
        goal: selected ? {
            id: String(selected.id ?? ""),
            type: String(selected.type ?? ""),
            title: String(selected.title ?? ""),
            cost: Math.max(0, Number(selected.cost ?? 0)),
            currentCash: Math.max(0, Number(selected.currentCash ?? advice?.context?.cash ?? 0)),
            remaining: Math.max(0, Number(selected.remaining ?? 0)),
            ready: Boolean(selected.ready),
            valueScore: Number(selected.valueScore ?? 0),
            recommendation: String(selected.recommendation ?? ""),
        } : null,
        candidates: Array.isArray(advice?.candidates)
            ? advice.candidates.slice(0, 5).map((candidate) => ({
                id: String(candidate.id ?? ""),
                type: String(candidate.type ?? ""),
                title: String(candidate.title ?? ""),
                cost: Math.max(0, Number(candidate.cost ?? 0)),
                remaining: Math.max(0, Number(candidate.remaining ?? 0)),
                ready: Boolean(candidate.ready),
                valueScore: Number(candidate.valueScore ?? 0),
            }))
            : [],
    };

    publishEconomyState(ns, snapshot);
}
