import { readPlannerState } from "/lib/runtime-state.js";
import { readTelemetryState } from "/lib/telemetry.js";
import { isQuiet, quietArgs } from "/lib/output.js";

const PLANNER_SCRIPT = "/hacking/planner.js";
const ECONOMY_SCRIPT = "/hacking/economy-planner.js";
const ECONOMIC_TARGET_SCRIPT = "/hacking/economy-targets.js";

/**
 * Persistent remote refresh coordinator.
 *
 * The expensive target/RAM planner is event-driven rather than timer-driven.
 * Kickstart creates the initial planner snapshot; this coordinator then:
 *   1. performs the initial economy + economic-target pass,
 *   2. watches Port 5 telemetry for a newly completed HACK,
 *   3. after each completed HACK, refreshes planner -> economy -> economic target,
 *   4. leaves the chosen target alone during weaken/grow prep between hacks.
 *
 * Internal planner launches are always quiet. Running hacking/planner.js manually
 * still prints its full report.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");

    const initialTelemetry = readTelemetryState(ns);
    let lastReviewedHackAt = Number(initialTelemetry?.lastHack?.finishedAt ?? 0);
    let startupEconomyDone = false;

    while (true) {
        if (!startupEconomyDone) {
            const economyOk = await launchAndWait(ns, ECONOMY_SCRIPT);
            if (economyOk) {
                const targetOk = await launchAndWait(ns, ECONOMIC_TARGET_SCRIPT);
                if (targetOk) startupEconomyDone = true;
            }
        }

        const telemetry = readTelemetryState(ns);
        const hackCompletedAt = Number(telemetry?.lastHack?.finishedAt ?? 0);

        if (hackCompletedAt > lastReviewedHackAt) {
            const plannerOk = await launchAndWait(ns, PLANNER_SCRIPT, true);
            if (plannerOk) {
                const economyOk = await launchAndWait(ns, ECONOMY_SCRIPT);
                if (economyOk) {
                    const targetOk = await launchAndWait(ns, ECONOMIC_TARGET_SCRIPT);
                    if (targetOk) {
                        lastReviewedHackAt = hackCompletedAt;
                        if (!isQuiet(ns)) {
                            ns.print(`Cycle target review complete after HACK at ${new Date(hackCompletedAt).toLocaleTimeString()}.`);
                        }
                    }
                }
            }
        }

        await ns.sleep(250);
    }
}

async function launchAndWait(ns, script, forceQuiet = false) {
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

    const args = forceQuiet ? ["--quiet"] : quietArgs(ns);

    for (const host of candidates) {
        const pid = ns.exec(script, host.hostname, 1, ...args);
        if (pid <= 0) continue;

        while (ns.isRunning(pid, host.hostname)) await ns.sleep(50);
        return true;
    }

    if (!isQuiet(ns)) ns.print(`Refresh delayed: no remote host has ${scriptRam.toFixed(2)}GB free for ${script}`);
    return false;
}
