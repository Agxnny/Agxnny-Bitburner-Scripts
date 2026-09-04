import { readPlannerState } from "/lib/runtime-state.js";
import { calculateThreadPlan, DEFAULT_HACK_FRACTION } from "/lib/threads.js";

/**
 * Short-lived HGW thread-plan diagnostic.
 *
 * Usage:
 *   run hacking/thread-plan.js
 *   run hacking/thread-plan.js n00dles
 *   run hacking/thread-plan.js n00dles 0.10
 *
 * With no hostname, uses the current planner-selected target.
 * The optional second argument is the desired hack fraction.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const planner = readPlannerState(ns);
    const hostname = String(ns.args[0] ?? planner?.selectedTarget?.hostname ?? "");
    const hackFraction = Number(ns.args[1] ?? DEFAULT_HACK_FRACTION);

    if (!hostname) {
        ns.tprint("ERROR: No target supplied and no planner-selected target exists.");
        ns.tprint("Run hacking/planner.js first or pass a hostname.");
        return;
    }

    const plan = calculateThreadPlan(ns, hostname, { hackFraction });

    ns.tprint("=== HGW THREAD PLAN ===");
    ns.tprint(`Target:       ${plan.hostname}`);
    ns.tprint(`Next phase:   ${plan.next.phase}`);
    ns.tprint(`Next action:  ${plan.next.action}`);
    ns.tprint(`Next threads: ${plan.next.requestedThreads}`);
    ns.tprint(`Reason:       ${plan.next.reason}`);
    ns.tprint("");

    ns.tprint("--- TARGET STATE ---");
    ns.tprint(`Money:        ${ns.format.number(plan.money.current, 2)} / ${ns.format.number(plan.money.max, 2)} (${(plan.money.percent * 100).toFixed(1)}%)`);
    ns.tprint(`Money target: ${(plan.options.moneyTargetPercent * 100).toFixed(1)}%`);
    ns.tprint(`Security:     ${plan.security.current.toFixed(2)} / ${plan.security.minimum.toFixed(2)} (+${plan.security.delta.toFixed(2)})`);
    ns.tprint(`Weaken/thread:${plan.security.weakenPerThread.toFixed(4)}`);
    ns.tprint("");

    ns.tprint("--- PREP REQUIREMENTS ---");
    ns.tprint(`Security weaken: ${plan.threads.securityPrepWeaken} thread(s) | ${ns.format.ram(plan.ram.securityPrep)}`);
    ns.tprint(`Grow:            ${plan.threads.grow} thread(s) | ${ns.format.ram(plan.ram.grow)}`);
    ns.tprint(`Grow weaken:     ${plan.threads.growWeaken} thread(s) | ${ns.format.ram(plan.ram.growWeaken)}`);
    ns.tprint(`Grow cycle RAM:  ${ns.format.ram(plan.ram.growCycle)}`);
    ns.tprint("");

    ns.tprint("--- PRODUCTION ESTIMATE ---");
    ns.tprint(`Hack fraction:   ${(plan.options.hackFraction * 100).toFixed(1)}%`);
    ns.tprint(`Hack:            ${plan.threads.hack} thread(s) | ${ns.format.ram(plan.ram.hack)}`);
    ns.tprint(`Hack weaken:     ${plan.threads.hackWeaken} thread(s) | ${ns.format.ram(plan.ram.hackWeaken)}`);
    ns.tprint(`Hack cycle RAM:  ${ns.format.ram(plan.ram.hackCycle)}`);
    ns.tprint("");

    ns.tprint("This calculator is short-lived so its analysis RAM cost does not stay in the controller.");
}
