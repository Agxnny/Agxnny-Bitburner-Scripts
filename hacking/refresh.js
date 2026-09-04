import { readPlannerState } from "/lib/runtime-state.js";

const FULL_REFRESH_MS = 30_000;
const ECONOMY_REFRESH_MS = 30_000;
const PLANNER_SCRIPT = "/hacking/planner.js";
const ECONOMY_SCRIPT = "/hacking/economy-planner.js";
const ECONOMIC_TARGET_SCRIPT = "/hacking/economy-targets.js";

/**
 * Persistent remote refresh coordinator.
 *
 * Keeps expensive analysis off home while periodically refreshing the whole
 * decision chain every 30 seconds:
 *  - full network + baseline target state,
 *  - cash/progression state,
 *  - economic target choice with prep-time cost.
 *
 * The economic target selector writes its winning host back into Port 2, so the
 * existing controller automatically adopts the fresh priority between worker
 * jobs without importing any of the expensive analysis APIs itself.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    let lastFullRefresh = Number(readPlannerState(ns)?.updatedAt ?? 0);
    let lastEconomyRefresh = 0;

    while (true) {
        const now = Date.now();

        if (now - lastFullRefresh >= FULL_REFRESH_MS) {
            const ok = await launchAndWait(ns, PLANNER_SCRIPT);
            if (ok) lastFullRefresh = Date.now();
        }

        if (now - lastEconomyRefresh >= ECONOMY_REFRESH_MS) {
            const economyOk = await launchAndWait(ns, ECONOMY_SCRIPT);
            if (economyOk) {
                await launchAndWait(ns, ECONOMIC_TARGET_SCRIPT);
                lastEconomyRefresh = Date.now();
            }
        }

        await ns.sleep(1000);
    }
}

async function launchAndWait(ns, script) {
    const scriptRam = ns.getScriptRam(script, "home");
    if (!(scriptRam > 0)) {
        ns.print(`Refresh skipped: could not determine RAM for ${script}`);
        return false;
    }

    const planner = readPlannerState(ns);
    const hosts = Array.isArray(planner?.executionHosts) ? planner.executionHosts : [];
    const candidates = hosts
        .map((entry) => String(entry.hostname ?? ""))
        .filter((hostname) => hostname && hostname !== "home")
        .map((hostname) => ({
            hostname,
            freeRam: Math.max(0, ns.getServerMaxRam(hostname) - ns.getServerUsedRam(hostname)),
        }))
        .filter((host) => host.freeRam >= scriptRam)
        .sort((a, b) => b.freeRam - a.freeRam || a.hostname.localeCompare(b.hostname));

    for (const host of candidates) {
        const pid = ns.exec(script, host.hostname, 1);
        if (pid <= 0) continue;

        while (ns.isRunning(pid, host.hostname)) await ns.sleep(50);
        return true;
    }

    ns.print(`Refresh delayed: no remote host has ${scriptRam.toFixed(2)}GB free for ${script}`);
    return false;
}
