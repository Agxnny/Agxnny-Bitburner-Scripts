import { publishHackEvent } from "/lib/telemetry.js";

/** @param {NS} ns */
export async function main(ns) {
    const target = String(ns.args[0] ?? "");
    const jobId = String(ns.args[1] ?? "");
    const threads = Math.max(0, Math.floor(Number(ns.args[2] ?? 0)));
    const additionalMsec = Math.max(0, Math.floor(Number(ns.args[3] ?? 0)));
    const batchId = String(ns.args[4] ?? "");
    const stage = String(ns.args[5] ?? "HACK");

    if (!target) {
        ns.tprint("ERROR: hack.js requires a target hostname.");
        return;
    }

    const startedAt = Date.now();
    const money = await ns.hack(target, { additionalMsec });
    const finishedAt = Date.now();

    publishHackEvent(ns, {
        type: "HACK_COMPLETE",
        target,
        jobId,
        batchId,
        stage,
        threads,
        hostname: ns.getHostname(),
        money: Math.max(0, Number(money ?? 0)),
        additionalMsec,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
    });
}
