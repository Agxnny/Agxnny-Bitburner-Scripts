import { publishPlannerState } from "/lib/runtime-state.js";
import { analyzeNetwork } from "/lib/network.js";
import { rankEligibleTargets } from "/lib/targets.js";

/**
 * Short-lived target and execution-pool planner.
 *
 * Expensive network/target analysis lives here so the persistent controller does
 * not carry its RAM cost. Run this whenever progression changes or you want to
 * refresh AUTO target choice and the rooted RAM host inventory.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const servers = analyzeNetwork(ns);
    const rankings = rankEligibleTargets(ns, servers);
    const selectedTarget = rankings[0] ?? null;

    const executionHosts = [
        {
            hostname: "home",
            maxRam: ns.getServerMaxRam("home"),
        },
        ...servers
            .filter((server) => server.hasRoot && server.target.maxRam > 0)
            .map((server) => ({
                hostname: server.hostname,
                maxRam: server.target.maxRam,
            })),
    ];

    const snapshot = {
        updatedAt: Date.now(),
        hackingLevel: ns.getHackingLevel(),
        selectedTarget,
        rankings,
        executionHosts,
    };

    publishPlannerState(ns, snapshot);

    ns.tprint("=== TARGET / RAM PLANNER ===");

    if (!selectedTarget) {
        ns.tprint("No currently-eligible money target found.");
    } else {
        ns.tprint(`Selected: #${selectedTarget.rank} ${selectedTarget.hostname}`);
        ns.tprint(`Score:    ${ns.format.number(selectedTarget.score, 2)}`);
        ns.tprint(`Chance:   ${(selectedTarget.hacking.chance * 100).toFixed(1)}%`);
        ns.tprint(`Hack time:${(selectedTarget.timing.hackMs / 1000).toFixed(1)}s`);
        ns.tprint(`Money:    ${(selectedTarget.money.percent * 100).toFixed(1)}% of max`);
        ns.tprint(`Security: +${selectedTarget.security.delta.toFixed(2)} above minimum`);
    }

    const totalRam = executionHosts.reduce((sum, host) => sum + host.maxRam, 0);
    ns.tprint(`RAM hosts: ${executionHosts.length} (${ns.format.ram(totalRam)} total max RAM)`);
    ns.tprint("Planner snapshot published.");

    if (String(ns.args[0] ?? "") === "--kickstart") {
        const nextStage = Math.max(0, Math.floor(Number(ns.args[1] ?? 1)));
        ns.spawn("/kickstart.js", 1, nextStage);
    }
}
