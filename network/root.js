import { publishRootState } from "/lib/runtime-state.js";
import { isQuiet } from "/lib/output.js";

const PORT_OPENERS = Object.freeze([
    { file: "BruteSSH.exe", action: "brutessh" },
    { file: "FTPCrack.exe", action: "ftpcrack" },
    { file: "relaySMTP.exe", action: "relaysmtp" },
    { file: "HTTPWorm.exe", action: "httpworm" },
    { file: "SQLInject.exe", action: "sqlinject" },
]);

/**
 * Lightweight rooting pass.
 *
 * Root access depends on port-openers, not hacking level. This script discovers
 * the network, detects the currently owned port tools on home, roots every server
 * that is immediately rootable, and publishes the result for the remote refresh
 * coordinator. It is safe to run repeatedly.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const quiet = isQuiet(ns);
    const hosts = discoverNetwork(ns);
    const openers = PORT_OPENERS.filter((tool) => ns.fileExists(tool.file, "home"));
    const newlyRootedHosts = [];
    let rootableNow = 0;

    for (const hostname of hosts) {
        if (hostname === "home" || ns.hasRootAccess(hostname)) continue;
        if (ns.getServerNumPortsRequired(hostname) > openers.length) continue;

        rootableNow += 1;
        for (const opener of openers) runPortOpener(ns, opener.action, hostname);
        if (!ns.nuke(hostname)) continue;

        newlyRootedHosts.push(hostname);
        if (!quiet) ns.tprint(`ROOTED: ${hostname}`);
    }

    publishRootState(ns, {
        version: 1,
        updatedAt: Date.now(),
        availableTools: openers.map((tool) => tool.file),
        portToolCount: openers.length,
        discovered: hosts.length,
        rootableNow,
        newlyRooted: newlyRootedHosts.length,
        newlyRootedHosts,
    });

    if (!quiet) {
        ns.tprint(`Rooting pass complete. Tools: ${openers.length} | newly rooted: ${newlyRootedHosts.length}`);
    }
}

/** @param {NS} ns */
function discoverNetwork(ns) {
    const visited = new Set(["home"]);
    const queue = ["home"];

    while (queue.length > 0) {
        const host = queue.shift();
        for (const neighbor of ns.scan(host)) {
            if (visited.has(neighbor)) continue;
            visited.add(neighbor);
            queue.push(neighbor);
        }
    }

    return [...visited];
}

/** @param {NS} ns @param {string} action @param {string} hostname */
function runPortOpener(ns, action, hostname) {
    switch (action) {
        case "brutessh": ns.brutessh(hostname); break;
        case "ftpcrack": ns.ftpcrack(hostname); break;
        case "relaysmtp": ns.relaysmtp(hostname); break;
        case "httpworm": ns.httpworm(hostname); break;
        case "sqlinject": ns.sqlinject(hostname); break;
    }
}
