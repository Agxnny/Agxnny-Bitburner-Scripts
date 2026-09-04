/** @param {NS} ns */
export async function main(ns) {
    const target = String(ns.args[0] ?? "");
    const additionalMsec = Math.max(0, Math.floor(Number(ns.args[3] ?? 0)));

    if (!target) {
        ns.tprint("ERROR: grow.js requires a target hostname.");
        return;
    }

    await ns.grow(target, { additionalMsec });
}
