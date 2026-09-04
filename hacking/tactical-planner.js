import { calculateThreadPlan } from "/lib/threads.js";
import { publishTacticalPlanState } from "/lib/runtime-state.js";
import { positionalArgs, tprint } from "/lib/output.js";

/**
 * Short-lived HGW tactical planner.
 *
 * This script is intentionally expensive and should normally run on a rooted
 * remote RAM host rather than alongside the persistent controller on home.
 * It calculates one live action plan, publishes it, then exits.
 *
 * Positional args:
 *   [0] target hostname
 *   [1] request id supplied by the controller
 *   [2] optional hack fraction (defaults inside lib/threads.js)
 * Shared flags such as --quiet are ignored for positional parsing.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const args = positionalArgs(ns);
    const hostname = String(args[0] ?? "");
    const requestId = String(args[1] ?? "");
    const hackFractionArg = args[2];

    if (!hostname) {
        tprint(ns, "ERROR: tactical-planner.js requires a target hostname.");
        return;
    }

    if (!requestId) {
        tprint(ns, "ERROR: tactical-planner.js requires a request id.");
        return;
    }

    const options = {};
    if (hackFractionArg !== undefined) {
        options.hackFraction = Number(hackFractionArg);
    }

    const plan = calculateThreadPlan(ns, hostname, options);
    const snapshot = {
        ...plan,
        requestId,
        plannerHost: ns.getHostname(),
        updatedAt: Date.now(),
    };

    publishTacticalPlanState(ns, snapshot);
}
