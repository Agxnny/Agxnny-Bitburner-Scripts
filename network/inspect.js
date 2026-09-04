import { analyzeNetwork, AccessBlocker } from "/lib/network.js";

/**
 * Read-only network inspection tool.
 * Prints a compact summary suitable for validating discovery/capability logic.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const servers = analyzeNetwork(ns);

    const rooted = servers.filter((server) => server.hasRoot);
    const rootable = servers.filter((server) => !server.hasRoot && server.canRootNow);
    const hackable = servers.filter((server) => server.canHackNow && server.target.hasMoney);
    const progressionBlocked = servers.filter((server) => !server.canBecomeHackableNow && server.target.hasMoney);
    const moneyTargets = servers.filter((server) => server.target.hasMoney);

    ns.tprint("=== NETWORK OVERVIEW ===");
    ns.tprint(`Discovered:       ${servers.length}`);
    ns.tprint(`Rooted:           ${rooted.length}`);
    ns.tprint(`Rootable now:     ${rootable.length}`);
    ns.tprint(`HGW-ready money:  ${hackable.length}`);
    ns.tprint(`Blocked money:    ${progressionBlocked.length}`);
    ns.tprint(`Money hosts total:${moneyTargets.length}`);

    if (rootable.length > 0) {
        ns.tprint("\n=== ROOTABLE NOW ===");
        for (const server of rootable) {
            ns.tprint(formatServer(server));
        }
    }

    if (progressionBlocked.length > 0) {
        ns.tprint("\n=== PROGRESSION BLOCKERS ===");
        for (const server of progressionBlocked) {
            ns.tprint(`${formatServer(server)} | ${formatBlocker(server)}`);
        }
    }
}

function formatServer(server) {
    return `${server.hostname.padEnd(20)} ports ${server.ports.available}/${server.ports.required} | hack ${server.hacking.currentLevel}/${server.hacking.requiredLevel}`;
}

function formatBlocker(server) {
    switch (server.blocker) {
        case AccessBlocker.PORTS:
            return `needs ${server.ports.shortfall} more port opener(s)`;
        case AccessBlocker.HACKING_LEVEL:
            return `needs ${server.hacking.levelsNeeded} hacking level(s)`;
        case AccessBlocker.PORTS_AND_LEVEL:
            return `needs ${server.ports.shortfall} more port opener(s) and ${server.hacking.levelsNeeded} hacking level(s)`;
        default:
            return "no blocker";
    }
}
