import { readPlannerState } from "/lib/runtime-state.js";
import { WORKER_SCRIPTS, distributeThreads } from "/lib/execution.js";

/**
 * Manual distributed-dispatch diagnostic.
 *
 * Usage:
 *   run hacking/dispatch.js weaken foodnstuff 5
 *   run hacking/dispatch.js grow n00dles 10
 *
 * This is primarily for validating that a requested thread count can be split
 * across the rooted execution pool before the full thread calculator lands.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const action = String(ns.args[0] ?? "").toUpperCase();
    const target = String(ns.args[1] ?? "");
    const threads = Math.floor(Number(ns.args[2] ?? 0));
    const script = WORKER_SCRIPTS[action];

    if (!script || !target || threads < 1) {
        ns.tprint("Usage: run hacking/dispatch.js <hack|grow|weaken> <target> <threads>");
        return;
    }

    const planner = readPlannerState(ns);
    const jobId = `manual-${Date.now()}`;
    const result = distributeThreads(ns, planner, script, target, threads, jobId);

    ns.tprint("=== DISTRIBUTED DISPATCH ===");
    ns.tprint(`Action:    ${action}`);
    ns.tprint(`Target:    ${target}`);
    ns.tprint(`Requested: ${result.requested} thread(s)`);
    ns.tprint(`Launched:  ${result.launched} thread(s)`);
    ns.tprint(`Remaining: ${result.remaining} thread(s)`);

    if (result.allocations.length === 0) {
        ns.tprint("No allocation succeeded. Run hacking/planner.js and network/deploy.js first.");
        return;
    }

    for (const allocation of result.allocations) {
        ns.tprint(
            `${allocation.hostname.padEnd(20)} ${String(allocation.threads).padStart(4)} thread(s)`
            + ` | pid ${allocation.pid}`
            + ` | ${allocation.ram.toFixed(2)} GB`
        );
    }
}
