import { publishPlannerState } from "/lib/runtime-state.js";
import { rankEligibleTargets } from "/lib/targets.js";

/**
 * Short-lived target planner.
 *
 * Expensive target analysis lives here so the persistent controller does not
 * carry its RAM cost. Run this whenever you want to refresh AUTO target choice.
 * It publishes one snapshot and exits.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const rankings = rankEligibleTargets(ns);
    const selectedTarget = rankings[0] ?? null;

    const snapshot = {
        updatedAt: Date.now(),
        hackingLevel: ns.getHackingLevel(),
        selectedTarget,
        rankings,
    };

    publishPlannerState(ns, snapshot);

    ns.tprint("=== TARGET PLANNER ===");

    if (!selectedTarget) {
        ns.tprint("No currently-eligible money target found.");
        ns.tprint("Planner snapshot published with no selected target.");
        return;
    }

    ns.tprint(`Selected: #${selectedTarget.rank} ${selectedTarget.hostname}`);
    ns.tprint(`Score:    ${ns.format.number(selectedTarget.score, 2)}`);
    ns.tprint(`Chance:   ${(selectedTarget.hacking.chance * 100).toFixed(1)}%`);
    ns.tprint(`Hack time:${(selectedTarget.timing.hackMs / 1000).toFixed(1)}s`);
    ns.tprint(`Money:    ${(selectedTarget.money.percent * 100).toFixed(1)}% of max`);
    ns.tprint(`Security: +${selectedTarget.security.delta.toFixed(2)} above minimum`);
    ns.tprint("Planner snapshot published. Controller can now run in AUTO mode.");
}
