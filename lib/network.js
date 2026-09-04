// Network discovery and access analysis.
//
// This module is intentionally UI-agnostic. Controllers, rooting scripts,
// guidance, and the future dashboard should all consume the same data.

export const PORT_OPENERS = Object.freeze([
    { file: "BruteSSH.exe", port: "SSH", action: "brutessh" },
    { file: "FTPCrack.exe", port: "FTP", action: "ftpcrack" },
    { file: "relaySMTP.exe", port: "SMTP", action: "relaysmtp" },
    { file: "HTTPWorm.exe", port: "HTTP", action: "httpworm" },
    { file: "SQLInject.exe", port: "SQL", action: "sqlinject" },
]);

export const AccessBlocker = Object.freeze({
    NONE: "NONE",
    PORTS: "PORTS",
    HACKING_LEVEL: "HACKING_LEVEL",
    PORTS_AND_LEVEL: "PORTS_AND_LEVEL",
});

/**
 * Discover every normally-scannable server reachable from the starting host.
 * `home` is included by default.
 *
 * @param {NS} ns
 * @param {string} start
 * @returns {string[]}
 */
export function discoverNetwork(ns, start = "home") {
    const visited = new Set([start]);
    const queue = [start];

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

/** @param {NS} ns */
export function getAvailablePortOpeners(ns) {
    return PORT_OPENERS.filter((tool) => ns.fileExists(tool.file, "home"));
}

/**
 * Analyze whether a server can be rooted right now and why not if it cannot.
 * This does not open ports or call NUKE.
 *
 * @param {NS} ns
 * @param {string} hostname
 */
export function analyzeServerAccess(ns, hostname) {
    const hackingLevel = ns.getHackingLevel();
    const requiredHackingLevel = ns.getServerRequiredHackingLevel(hostname);
    const requiredPorts = ns.getServerNumPortsRequired(hostname);
    const availableTools = getAvailablePortOpeners(ns);
    const availablePorts = availableTools.length;
    const hasRoot = ns.hasRootAccess(hostname);

    const portsBlocked = availablePorts < requiredPorts;
    const levelBlocked = hackingLevel < requiredHackingLevel;

    let blocker = AccessBlocker.NONE;
    if (portsBlocked && levelBlocked) blocker = AccessBlocker.PORTS_AND_LEVEL;
    else if (portsBlocked) blocker = AccessBlocker.PORTS;
    else if (levelBlocked) blocker = AccessBlocker.HACKING_LEVEL;

    return {
        hostname,
        hasRoot,
        canRootNow: hasRoot || blocker === AccessBlocker.NONE,
        blocker,

        hacking: {
            currentLevel: hackingLevel,
            requiredLevel: requiredHackingLevel,
            levelsNeeded: Math.max(0, requiredHackingLevel - hackingLevel),
        },

        ports: {
            required: requiredPorts,
            available: availablePorts,
            shortfall: Math.max(0, requiredPorts - availablePorts),
            availableTools: availableTools.map((tool) => tool.file),
            missingTools: PORT_OPENERS
                .filter((tool) => !ns.fileExists(tool.file, "home"))
                .map((tool) => tool.file),
        },

        target: {
            maxMoney: ns.getServerMaxMoney(hostname),
            growth: ns.getServerGrowth(hostname),
            minSecurity: ns.getServerMinSecurityLevel(hostname),
            maxRam: ns.getServerMaxRam(hostname),
            hasMoney: ns.getServerMaxMoney(hostname) > 0,
        },
    };
}

/**
 * Analyze the whole discovered network without changing access state.
 *
 * @param {NS} ns
 * @param {string} start
 */
export function analyzeNetwork(ns, start = "home") {
    return discoverNetwork(ns, start)
        .filter((hostname) => hostname !== "home")
        .map((hostname) => analyzeServerAccess(ns, hostname));
}

/**
 * Attempt to root one server using only tools already owned on home.
 * Returns a fresh access analysis after the attempt.
 *
 * @param {NS} ns
 * @param {string} hostname
 */
export function tryRootServer(ns, hostname) {
    if (ns.hasRootAccess(hostname)) {
        return analyzeServerAccess(ns, hostname);
    }

    for (const tool of getAvailablePortOpeners(ns)) {
        runPortOpener(ns, tool.action, hostname);
    }

    const access = analyzeServerAccess(ns, hostname);

    if (
        access.ports.available >= access.ports.required &&
        access.hacking.currentLevel >= access.hacking.requiredLevel
    ) {
        ns.nuke(hostname);
    }

    return analyzeServerAccess(ns, hostname);
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
