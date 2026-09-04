import { publishPlannerState } from "/lib/runtime-state.js";
import { analyzeNetwork, getAvailablePortOpeners } from "/lib/network.js";
import { rankEligibleTargets } from "/lib/targets.js";

const WORKER_FILES = Object.freeze([
    "/hacking/workers/hack.js",
    "/hacking/workers/grow.js",
    "/hacking/workers/weaken.js",
]);

/**
 * Short-lived target and execution-pool planner.
 *
 * Expensive network/target analysis lives here so persistent consumers such as
 * the controller and dashboard can read cached state without carrying the same
 * Netscript RAM costs themselves.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const servers = analyzeNetwork(ns);
    const rankings = rankEligibleTargets(ns, servers);
    const selectedTarget = rankings[0] ?? null;
    const tools = getAvailablePortOpeners(ns);

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

    const network = {
        discovered: servers.length,
        rooted: servers.filter((server) => server.hasRoot).length,
        rootableNow: servers.filter((server) => !server.hasRoot && server.canRootNow).length,
        hgwTargets: servers.filter((server) => server.canHackNow && server.target.hasMoney).length,
        blockedMoney: servers.filter((server) => !server.canBecomeHackableNow && server.target.hasMoney).length,
        availableTools: tools.map((tool) => tool.file),
        portToolCount: tools.length,
    };

    const workerRam = Object.fromEntries(WORKER_FILES.map((path) => [path, ns.getScriptRam(path, "home")]));

    const snapshot = {
        updatedAt: Date.now(),
        hackingLevel: ns.getHackingLevel(),
        selectedTarget,
        rankings,
        executionHosts,
        network,
        workerRam,
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
    ns.tprint(`Network:   ${network.discovered} discovered | ${network.rooted} rooted | ${network.hgwTargets} HGW target(s)`);
    ns.tprint("Planner snapshot published.");

    if (String(ns.args[0] ?? "") === "--kickstart") {
        const nextStage = Math.max(0, Math.floor(Number(ns.args[1] ?? 1)));
        ns.spawn("/kickstart.js", { threads: 1, spawnDelay: 0 }, nextStage);
    }
}
