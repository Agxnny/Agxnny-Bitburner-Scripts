/** @param {NS} ns */
export async function main(ns) {
    const target = String(ns.args[0] ?? "");

    if (!target) {
        ns.tprint("ERROR: grow.js requires a target hostname.");
        return;
    }

    await ns.grow(target);
}
