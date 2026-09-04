import { readTelemetryState } from "/lib/telemetry.js";
import { buildProgressionAdvice } from "/lib/progression.js";

/** @param {NS} ns */
export async function main(ns) {
    const telemetry = readTelemetryState(ns);
    const advice = buildProgressionAdvice(ns, telemetry);
    const goal = advice.selected;

    ns.tprint("=== PROGRESSION ADVISOR ===");
    ns.tprint(`Mode:        ${advice.mode}`);
    ns.tprint(`Goal:        ${goal.title}`);
    ns.tprint(`Reason:      ${goal.reason}`);
    ns.tprint(`Cash:        $${ns.format.number(goal.currentCash, 2)}`);

    if (goal.cost > 0) {
        ns.tprint(`Goal cost:   $${ns.format.number(goal.cost, 2)}`);
        ns.tprint(`Remaining:   $${ns.format.number(goal.remaining, 2)}`);
    }

    ns.tprint(`HGW income:  $${ns.format.number(goal.incomePerSecond, 2)}/s (${goal.incomeSource})`);
    ns.tprint(`ETA:         ${formatEta(goal.etaSeconds)}`);
    ns.tprint(`Advice:      ${goal.recommendation}`);
    ns.tprint("");
    ns.tprint(`Candidates:  ${advice.candidates.length}`);
    for (const candidate of advice.candidates) {
        ns.tprint(`- ${candidate.type}: ${candidate.title} | priority ${candidate.priority} | ${candidate.ready ? "READY" : candidate.mode}`);
    }
}

function formatEta(seconds) {
    if (!Number.isFinite(seconds)) return "waiting for income telemetry";
    if (seconds <= 0) return "ready now";
    if (seconds < 60) return `${seconds.toFixed(0)}s`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${Math.floor(seconds % 60)}s`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m`;

    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
}
