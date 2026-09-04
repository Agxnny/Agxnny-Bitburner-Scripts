import { readTelemetryState } from "/lib/telemetry.js";
import { buildProgressionAdvice, GoalType } from "/lib/progression.js";

/** @param {NS} ns */
export async function main(ns) {
    const telemetry = readTelemetryState(ns);
    const advice = buildProgressionAdvice(ns, telemetry);
    const goal = advice.selected;
    const homeCore = advice.context.homeCore;

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
    ns.tprint(`Home core:   ${advice.context.homeRam}GB / ${homeCore.thresholdRam}GB threshold | ${homeCore.belowThreshold ? "BOOSTED" : "normal"}`);
    ns.tprint(`Core need:   ${homeCore.scriptRam.toFixed(2)}GB scripts + ${homeCore.reserveRam.toFixed(2)}GB reserve = ${homeCore.requiredRam.toFixed(2)}GB`);
    ns.tprint(`Cloud fleet: ${advice.context.cloud.owned}/${advice.context.cloud.serverLimit} servers | max ${advice.context.cloud.ramLimit}GB each`);
    ns.tprint(`Candidates:  ${advice.candidates.length}`);

    for (let i = 0; i < advice.candidates.length; i += 1) {
        const candidate = advice.candidates[i];
        const value = Number(candidate.valueScore ?? 0);
        const addedRam = Number(candidate.valueMetrics?.addedRam ?? 0);
        const ramPerMillion = Number(candidate.valueMetrics?.ramPerMillionDollars ?? 0);
        const weight = Number(candidate.valueMetrics?.roleWeight ?? 0);
        const marker = i === 0 ? "<-- SELECTED" : "";

        ns.tprint(`- ${candidate.type}: ${candidate.title} ${marker}`.trimEnd());
        ns.tprint(`  Cost $${ns.format.number(candidate.cost, 2)} | +${addedRam.toFixed(0)}GB | value ${value.toFixed(2)} | weight ${weight.toFixed(2)}x | ${candidate.ready ? "READY" : candidate.mode}`);
        ns.tprint(`  Raw RAM value: ${ramPerMillion.toFixed(2)} GB / $1m | model ${candidate.model?.valueModel ?? "unknown"}`);

        if (candidate.type === GoalType.CLOUD_SERVER_UPGRADE) {
            ns.tprint(`  Host ${candidate.metadata.hostname} | ${candidate.metadata.currentRam}GB -> ${candidate.metadata.targetRam}GB | compared ${candidate.metadata.eligibleServersCompared} eligible server(s)`);
        }
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
