import { analyzeNetwork, tryRootServer } from "/lib/network.js";

/**
 * Attempts to gain root on every discovered server that is currently eligible.
 * Servers blocked by hacking level or missing port-openers are left untouched.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const before = analyzeNetwork(ns);
    let newlyRooted = 0;

    for (const server of before) {
        if (server.hasRoot || !server.canRootNow) continue;

        const after = tryRootServer(ns, server.hostname);
        if (after.hasRoot) {
            newlyRooted += 1;
            ns.tprint(`ROOTED: ${server.hostname}`);
        }
    }

    ns.tprint(`Rooting pass complete. Newly rooted: ${newlyRooted}`);
}
