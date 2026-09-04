import { positionalArgs, quietArgs, tprint } from "/lib/output.js";

/**
 * Prepare the automation stack after a clean pull or before a test run.
 *
 * Sequence:
 *   1. refresh the network/target/RAM planner snapshot,
 *   2. deploy workers + tactical-planner dependencies to rooted RAM hosts,
 *   3. start the persistent controller.
 *
 * Run with --quiet to suppress setup/background printouts. The flag is propagated
 * through the full launch chain so later dashboard/GUI operation can stay clean.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    if (ns.getHostname() !== "home") {
        tprint(ns, "ERROR: Run kickstart.js from home.");
        return;
    }

    const args = positionalArgs(ns);
    const stage = Math.max(0, Math.floor(Number(args[0] ?? 0)));
    const inheritedQuiet = quietArgs(ns);
    const spawnOptions = { threads: 1, spawnDelay: 0 };

    if (stage === 0) {
        tprint(ns, "=== KICKSTART ===");
        tprint(ns, "1/3 Refreshing planner state...");
        ns.spawn("/hacking/planner.js", spawnOptions, "--kickstart", 1, ...inheritedQuiet);
    }

    if (stage === 1) {
        tprint(ns, "2/3 Deploying execution files...");
        ns.spawn("/network/deploy.js", spawnOptions, "--kickstart", 2, ...inheritedQuiet);
    }

    if (stage === 2) {
        tprint(ns, "3/3 Starting controller...");
        ns.spawn("/hacking/controller.js", spawnOptions, ...inheritedQuiet);
    }

    tprint(ns, `ERROR: Unknown kickstart stage ${stage}.`);
}
