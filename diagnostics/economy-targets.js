import { readEconomyTargetState } from "/lib/runtime-state.js";

/** @param {NS} ns */
export async function main(ns) {
    const state = readEconomyTargetState(ns);
    if (!state) {
        ns.tprint("No economic target snapshot is available yet.");
        ns.tprint("Run kickstart.js and allow the remote refresh service to complete a cycle.");
        return;
    }

    const ageMs = Math.max(0, Date.now() - Number(state.updatedAt ?? 0));
    const goal = state.goal;
    const selected = state.selectedTarget;

    ns.tprint("=== ECONOMIC TARGET PRIORITY ===");
    ns.tprint(`Snapshot:   ${(ageMs / 1000).toFixed(1)}s old`);
    ns.tprint(`Cash:       $${ns.format.number(state.cash ?? 0, 2)}`);
    if (goal) {
        ns.tprint(`Goal:       ${goal.title}`);
        ns.tprint(`Need:       $${ns.format.number(goal.remaining ?? 0, 2)} more`);
    }
    ns.tprint(`Usable RAM: ${Number(state.usableRam ?? 0).toFixed(2)}GB`);

    if (selected) {
        ns.tprint(`Selected:   ${selected.hostname}`);
        ns.tprint(`Reason:     ${selected.reason}`);
    }

    ns.tprint("");
    ns.tprint("--- ECONOMIC RANKING ---");
    for (const target of (state.rankings ?? []).slice(0, 8)) {
        ns.tprint(
            `#${target.economicRank} ${String(target.hostname).padEnd(18)}`
            + ` prep ${formatDuration(target.prepSeconds).padStart(8)}`
            + ` | $${ns.format.number(target.steadyIncomePerSecond ?? 0, 2)}/s`
            + ` | goal ${formatDuration(target.goalEtaSeconds)}`
            + ` | baseline #${target.baselineRank}`
        );
    }
}

function formatDuration(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    if (!Number.isFinite(value) || value >= Number.MAX_SAFE_INTEGER / 2) return "n/a";
    if (value < 60) return `${value.toFixed(0)}s`;
    const minutes = Math.floor(value / 60);
    if (minutes < 60) return `${minutes}m${Math.floor(value % 60)}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h${minutes % 60}m`;
}
