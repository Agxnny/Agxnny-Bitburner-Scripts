import { readPlannerState } from "/lib/runtime-state.js";
import { WORKER_SCRIPTS } from "/lib/execution.js";

/**
 * Copy the minimal HGW workers from home to every rooted RAM host in the latest
 * planner snapshot. Run after pulling or whenever new execution hosts unlock.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    if (ns.getHostname() !== "home") {
        ns.tprint("ERROR: Run network/deploy.js from home.");
        return;
    }

    const planner = readPlannerState(ns);
    const hosts = Array.isArray(planner?.executionHosts) ? planner.executionHosts : [];
    const remoteHosts = hosts
        .map((entry) => String(entry.hostname ?? ""))
        .filter((hostname) => hostname && hostname !== "home");

    if (remoteHosts.length === 0) {
        ns.tprint("No remote rooted RAM hosts in the latest planner snapshot.");
        ns.tprint("Run hacking/planner.js after gaining root access to refresh the pool.");
        return;
    }

    const files = Object.values(WORKER_SCRIPTS);
    let success = 0;

    ns.tprint("=== WORKER DEPLOYMENT ===");

    for (const hostname of remoteHosts) {
        const ok = await ns.scp(files, hostname, "home");
        if (ok) {
            success += 1;
            ns.tprint(`DEPLOYED  ${hostname}`);
        } else {
            ns.tprint(`FAILED    ${hostname}`);
        }
    }

    ns.tprint(`Deployment complete: ${success}/${remoteHosts.length} host(s).`);
}
