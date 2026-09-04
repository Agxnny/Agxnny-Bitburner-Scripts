import { publishPlannerState, readPlannerState } from "/lib/runtime-state.js";
import { analyzeNetwork, getAvailablePortOpeners } from "/lib/network.js";
import { rankEligibleTargets } from "/lib/targets.js";
import { quietArgs, tprint } from "/lib/output.js";

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
 * A baseline refresh must not temporarily overwrite an already-valid economic
 * target. The baseline #1 is published separately, while the previous economic
 * winner is preserved until the economic selector replaces it with a fresh one.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const previous = readPlannerState(ns);
    const servers = analyzeNetwork(ns);
    const rankings = rankEligibleTargets(ns, servers);
    const baselineSelectedTarget = rankings[0] ?? null;
    const tools = getAvailablePortOpeners(ns);

    const previousEconomicHost = String(previous?.economicSelection?.hostname ?? "");
    const previousWasEconomic = String(previous?.selectionModel ?? "").startsWith("GOAL_ETA_WITH_PREP_COST");
    const preservedEconomicTarget = previousWasEconomic && previousEconomicHost
        ? rankings.find((target) => target.hostname === previousEconomicHost) ?? null
        : null;
    const selectedTarget = preservedEconomicTarget ?? baselineSelectedTarget;

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
    const analysisUpdatedAt = Date.now();

    const snapshot = {
        updatedAt: analysisUpdatedAt,
        analysisUpdatedAt,
        hackingLevel: ns.getHackingLevel(),
        baselineSelectedTarget,
        selectedTarget,
        rankings,
        executionHosts,
        network,
        workerRam,
        ...(preservedEconomicTarget ? {
            selectionModel: previous.selectionModel,
            economicSelection: previous.economicSelection,
        } : {}),
    };

    publishPlannerState(ns, snapshot);

    tprint(ns, "=== TARGET / RAM PLANNER ===");

    if (!baselineSelectedTarget) {
        tprint(ns, "No currently-eligible money target found.");
    } else {
        tprint(ns, `Baseline: #${baselineSelectedTarget.rank} ${baselineSelectedTarget.hostname}`);
        if (preservedEconomicTarget) {
            tprint(ns, `Active:   ${preservedEconomicTarget.hostname} (preserved economic target pending refresh)`);
        }
        tprint(ns, `Score:    ${ns.format.number(baselineSelectedTarget.score, 2)}`);
        tprint(ns, `Chance:   ${(baselineSelectedTarget.hacking.chance * 100).toFixed(1)}%`);
        tprint(ns, `Hack time:${(baselineSelectedTarget.timing.hackMs / 1000).toFixed(1)}s`);
        tprint(ns, `Money:    ${(baselineSelectedTarget.money.percent * 100).toFixed(1)}% of max`);
        tprint(ns, `Security: +${baselineSelectedTarget.security.delta.toFixed(2)} above minimum`);
    }

    const totalRam = executionHosts.reduce((sum, host) => sum + host.maxRam, 0);
    tprint(ns, `RAM hosts: ${executionHosts.length} (${ns.format.ram(totalRam)} total max RAM)`);
    tprint(ns, `Network:   ${network.discovered} discovered | ${network.rooted} rooted | ${network.hgwTargets} HGW target(s)`);
    tprint(ns, "Planner snapshot published.");

    if (String(ns.args[0] ?? "") === "--kickstart") {
        const nextStage = Math.max(0, Math.floor(Number(ns.args[1] ?? 1)));
        ns.spawn("/kickstart.js", { threads: 1, spawnDelay: 0 }, nextStage, ...quietArgs(ns));
    }
}
