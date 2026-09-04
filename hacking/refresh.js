import { readControllerState, readPlannerState } from "/lib/runtime-state.js";
import { isQuiet, quietArgs } from "/lib/output.js";

const PLANNER_SCRIPT = "/hacking/planner.js";
const ECONOMY_SCRIPT = "/hacking/economy-planner.js";
const ECONOMIC_TARGET_SCRIPT = "/hacking/economy-targets.js";

/**
 * Persistent remote refresh coordinator.
 *
 * The expensive full planner is event-driven rather than timer-driven:
 *  - startup performs only the economy + economic-target pass because kickstart
 *    has already produced the initial planner snapshot,
 *  - after the controller completes a HACK operation, run the full planner,
 *    refresh progression/economy state, and re-rank economic targets,
 *  - do not mark the cycle reviewed until the entire chain succeeds.
 *
 * This keeps a target stable through its prep/production work and reconsiders it
 * at the natural end of a completed HGW cycle instead of every 30 seconds.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");

    const initialController = readControllerState(ns);
    let lastReviewedHackAt = Number(initialController?.cycle?.lastHackCompletedAt ?? 0);
    let startupEconomyDone = false;

    while (true) {
        if (!startupEconomyDone) {
            const economyOk = await launchAndWait(ns, ECONOMY_SCRIPT);
            if (economyOk) {
                const targetOk = await launchAndWait(ns, ECONOMIC_TARGET_SCRIPT);
                if (targetOk) startupEconomyDone = true;
            }
        }

        const controller = readControllerState(ns);
        const hackCompletedAt = Number(controller?.cycle?.lastHackCompletedAt ?? 0);

        if (hackCompletedAt > lastReviewedHackAt) {
            const plannerOk = await launchAndWait(ns, PLANNER_SCRIPT);
            if (plannerOk) {
                const economyOk = await launchAndWait(ns, ECONOMY_SCRIPT);
                if (economyOk) {
                    const targetOk = await launchAndWait(ns, ECONOMIC_TARGET_SCRIPT);
                    if (targetOk) {
                        lastReviewedHackAt = hackCompletedAt;
                        if (!isQuiet(ns)) {
                            ns.print(`Cycle review complete for hack at ${new Date(hackCompletedAt).toLocaleTimeString()}.`);
                        }
                    }
                }
            }
        }

        await ns.sleep(250);
    }
}

async function launchAndWait(ns, script) {
    const scriptRam = ns.getScriptRam(script, "home");
    if (!(scriptRam > 0)) {
        if (!isQuiet(ns)) ns.print(`Refresh skipped: could not determine RAM for ${script}`);
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
        const pid = ns.exec(script, host.hostname, 1, ...quietArgs(ns));
        if (pid <= 0) continue;

        while (ns.isRunning(pid, host.hostname)) await ns.sleep(50);
        return true;
    }

    if (!isQuiet(ns)) ns.print(`Refresh delayed: no remote host has ${scriptRam.toFixed(2)}GB free for ${script}`);
    return false;
}
