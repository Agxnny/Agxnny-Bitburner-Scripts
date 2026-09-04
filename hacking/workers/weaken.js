/** @param {NS} ns */
export async function main(ns) {
    const target = String(ns.args[0] ?? "");

    if (!target) {
        ns.tprint("ERROR: weaken.js requires a target hostname.");
        return;
    }

    await ns.weaken(target);
}
