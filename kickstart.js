/**
 * Prepare the automation stack after a clean pull or before a test run.
 *
 * Sequence:
 *   1. refresh the network/target/RAM planner snapshot,
 *   2. deploy workers + tactical-planner dependencies to rooted RAM hosts,
 *   3. start the persistent controller.
 *
 * Each setup step is spawned after the previous one exits so their RAM costs do
 * not overlap on early-game home RAM.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    if (ns.getHostname() !== "home") {
        ns.tprint("ERROR: Run kickstart.js from home.");
        return;
    }

    const stage = Math.max(0, Math.floor(Number(ns.args[0] ?? 0)));

    if (stage === 0) {
        ns.tprint("=== KICKSTART ===");
        ns.tprint("1/3 Refreshing planner state...");
        ns.spawn("/hacking/planner.js", 1, "--kickstart", 1);
        return;
    }

    if (stage === 1) {
        ns.tprint("2/3 Deploying execution files...");
        ns.spawn("/network/deploy.js", 1, "--kickstart", 2);
        return;
    }

    if (stage === 2) {
        ns.tprint("3/3 Starting controller...");
        ns.spawn("/hacking/controller.js", 1);
        return;
    }

    ns.tprint(`ERROR: Unknown kickstart stage ${stage}.`);
}
