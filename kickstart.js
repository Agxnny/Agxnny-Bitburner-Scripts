import { readEconomyTargetState, readPlannerState } from "/lib/runtime-state.js";
import { positionalArgs, quietArgs, tprint } from "/lib/output.js";

const ECONOMIC_TARGET_WAIT_MS = 30_000;

/**
 * Prepare the automation stack after a clean pull or before a test run.
 *
 * Sequence:
 *   1. refresh the network/target/RAM planner snapshot,
 *   2. deploy workers + support services,
 *   3. wait briefly for a fresh economic target decision,
 *   4. start the persistent controller.
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
        const planner = readPlannerState(ns);
        const analysisUpdatedAt = Number(planner?.analysisUpdatedAt ?? planner?.updatedAt ?? 0);
        tprint(ns, "3/3 Waiting for fresh economic target selection...");

        const deadline = Date.now() + ECONOMIC_TARGET_WAIT_MS;
        let freshEconomicTarget = false;

        while (Date.now() < deadline) {
            const economic = readEconomyTargetState(ns);
            const economicPlannerTime = Number(economic?.plannerUpdatedAt ?? 0);
            if (economic?.selectedTarget?.hostname && economicPlannerTime >= analysisUpdatedAt) {
                freshEconomicTarget = true;
                break;
            }
            await ns.sleep(100);
        }

        const selected = readPlannerState(ns)?.selectedTarget?.hostname ?? "unknown";
        if (freshEconomicTarget) {
            tprint(ns, `Economic target ready: ${selected}. Starting controller...`);
        } else {
            tprint(ns, `WARNING: economic target refresh timed out; starting controller with current target ${selected}.`);
        }

        ns.spawn("/hacking/controller.js", spawnOptions, ...inheritedQuiet);
    }

    tprint(ns, `ERROR: Unknown kickstart stage ${stage}.`);
}
