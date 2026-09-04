import { rankEligibleTargets } from "/lib/targets.js";

/**
 * Read-only target ranking diagnostic.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const targets = rankEligibleTargets(ns);

    ns.tprint("=== TARGET RANKING ===");

    if (targets.length === 0) {
        ns.tprint("No currently-eligible money targets.");
        return;
    }

    for (const target of targets) {
        const chance = `${(target.hacking.chance * 100).toFixed(1)}%`;
        const hackPercent = `${(target.hacking.percentPerThread * 100).toFixed(3)}%`;
        const hackTime = `${(target.timing.hackMs / 1000).toFixed(1)}s`;
        const score = ns.format.number(target.score, 2);
        const prep = describePrep(target);

        ns.tprint(
            `#${String(target.rank).padEnd(2)} ${target.hostname.padEnd(20)}`
            + ` score ${score.padStart(9)}`
            + ` | chance ${chance.padStart(6)}`
            + ` | hack/thread ${hackPercent.padStart(8)}`
            + ` | hack ${hackTime.padStart(7)}`
            + ` | ${prep}`
        );
    }

    ns.tprint("");
    ns.tprint("Score = expected max-money hack value per second for one hack thread.");
    ns.tprint("Grow/weaken recovery and RAM efficiency are not included yet.");
}

function describePrep(target) {
    const moneyPercent = target.money.percent * 100;
    const securityDelta = target.security.delta;
    return `money ${moneyPercent.toFixed(1)}% | sec +${securityDelta.toFixed(2)}`;
}
