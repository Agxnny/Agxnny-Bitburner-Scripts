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
 * Root access depends on port-openers, not hacking level, so this script avoids
 * the broader network/target analysis used by planners and only calls APIs that
 * are required to discover hosts, open ports, and NUKE eligible servers.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const hosts = discoverNetwork(ns);
    const openers = PORT_OPENERS.filter((tool) => ns.fileExists(tool.file, "home"));
    let newlyRooted = 0;

    for (const hostname of hosts) {
        if (hostname === "home" || ns.hasRootAccess(hostname)) continue;
        if (ns.getServerNumPortsRequired(hostname) > openers.length) continue;

        for (const opener of openers) runPortOpener(ns, opener.action, hostname);
        if (!ns.nuke(hostname)) continue;

        newlyRooted += 1;
        ns.tprint(`ROOTED: ${hostname}`);
    }

    ns.tprint(`Rooting pass complete. Newly rooted: ${newlyRooted}`);
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
