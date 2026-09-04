import { DEPLOY_FILES, DEPLOY_PROBE_FILES } from "/lib/deployment.js";
import { readPlannerState } from "/lib/runtime-state.js";
import { isQuiet } from "/lib/output.js";

/**
 * Sync execution/support files to newly rooted RAM hosts after a planner refresh.
 * Runs remotely so adding new execution hosts does not require the 8GB home node
 * to launch the heavier startup deploy script again.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const planner = readPlannerState(ns);
    const hosts = Array.isArray(planner?.executionHosts) ? planner.executionHosts : [];
    const remoteHosts = hosts
        .map((entry) => String(entry?.hostname ?? ""))
        .filter((hostname) => hostname && hostname !== "home");

    let synced = 0;
    for (const hostname of remoteHosts) {
        const needsSync = DEPLOY_PROBE_FILES.some((file) => !ns.fileExists(file, hostname));
        if (!needsSync) continue;

        const ok = await ns.scp(DEPLOY_FILES, hostname, "home");
        if (!ok) continue;
        synced += 1;
        if (!isQuiet(ns)) ns.print(`Synced execution files to newly rooted host ${hostname}.`);
    }

    if (!isQuiet(ns) && synced > 0) ns.print(`New-host sync complete: ${synced} host(s).`);
}
