/**
 * Prepare the automation stack after a clean pull or before a test run.
 *
 * Sequence:
 *   1. refresh the network/target/RAM planner snapshot,
 *   2. deploy workers + tactical-planner dependencies to rooted RAM hosts,
 *   3. start the persistent controller.
 *
 * Each setup step synchronously replaces the previous one with spawnDelay 0, so
 * their RAM costs never overlap and no delayed kickstart stages are left queued.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    if (ns.getHostname() !== "home") {
        ns.tprint("ERROR: Run kickstart.js from home.");
        return;
    }

    const stage = Math.max(0, Math.floor(Number(ns.args[0] ?? 0)));
    const spawnOptions = { threads: 1, spawnDelay: 0 };

    if (stage === 0) {
        ns.tprint("=== KICKSTART ===");
        ns.tprint("1/3 Refreshing planner state...");
        ns.spawn("/hacking/planner.js", spawnOptions, "--kickstart", 1);
    }

    if (stage === 1) {
        ns.tprint("2/3 Deploying execution files...");
        ns.spawn("/network/deploy.js", spawnOptions, "--kickstart", 2);
    }

    if (stage === 2) {
        ns.tprint("3/3 Starting controller...");
        ns.spawn("/hacking/controller.js", spawnOptions);
    }

    ns.tprint(`ERROR: Unknown kickstart stage ${stage}.`);
}
