import { readPlannerState, readRootState } from "/lib/runtime-state.js";
import { readTelemetryState } from "/lib/telemetry.js";
import { isQuiet, quietArgs } from "/lib/output.js";

const ROOT_CHECK_MS = 30_000;
const ROOT_SCRIPT = "/network/root.js";
const PLANNER_SCRIPT = "/hacking/planner.js";
const SYNC_SCRIPT = "/network/sync.js";
const ECONOMY_SCRIPT = "/hacking/economy-planner.js";
const ECONOMIC_TARGET_SCRIPT = "/hacking/economy-targets.js";

/**
 * Persistent remote refresh coordinator.
 *
 * Heavy target/RAM analysis is event-driven rather than timer-driven. This
 * coordinator performs lightweight rooting checks every 30 seconds, and runs the
 * full planner only after either:
 *   - a HACK has completed, or
 *   - the rooting pass gained one or more new servers.
 *
 * Newly rooted RAM hosts are synced immediately after the planner discovers them,
 * so they can join the worker pool without rerunning the heavy startup deploy on
 * the 8GB home node.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");

    const initialTelemetry = readTelemetryState(ns);
    let lastReviewedHackAt = Number(initialTelemetry?.lastHack?.finishedAt ?? 0);
    let lastRootCheckAt = 0;
    let startupEconomyDone = false;

    while (true) {
        if (!startupEconomyDone) {
            const economyOk = await launchAndWait(ns, ECONOMY_SCRIPT);
            if (economyOk) {
                const targetOk = await launchAndWait(ns, ECONOMIC_TARGET_SCRIPT);
                if (targetOk) startupEconomyDone = true;
            }
        }

        const now = Date.now();
        let rootExpansion = false;

        if (now - lastRootCheckAt >= ROOT_CHECK_MS) {
            const rootOk = await launchAndWait(ns, ROOT_SCRIPT, true);
            lastRootCheckAt = Date.now();
            if (rootOk) {
                const root = readRootState(ns);
                rootExpansion = Number(root?.newlyRooted ?? 0) > 0;
                if (rootExpansion && !isQuiet(ns)) {
                    ns.print(`Root expansion: ${root.newlyRootedHosts?.join(", ") || `${root.newlyRooted} server(s)`}.`);
                }
            }
        }

        const telemetry = readTelemetryState(ns);
        const hackCompletedAt = Number(telemetry?.lastHack?.finishedAt ?? 0);
        const hackNeedsReview = hackCompletedAt > lastReviewedHackAt;

        if (hackNeedsReview || rootExpansion) {
            const plannerOk = await launchAndWait(ns, PLANNER_SCRIPT, true);
            if (plannerOk) {
                await launchAndWait(ns, SYNC_SCRIPT, true);
                const economyOk = await launchAndWait(ns, ECONOMY_SCRIPT);
                if (economyOk) {
                    const targetOk = await launchAndWait(ns, ECONOMIC_TARGET_SCRIPT);
                    if (targetOk) {
                        if (hackNeedsReview) lastReviewedHackAt = hackCompletedAt;
                        if (!isQuiet(ns)) {
                            const reason = hackNeedsReview && rootExpansion
                                ? "HACK completion + new root access"
                                : hackNeedsReview ? "HACK completion" : "new root access";
                            ns.print(`Target/RAM review complete after ${reason}.`);
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
