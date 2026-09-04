const BATCH_TIMING_PORT = 14;

/** @param {NS} ns */
export async function main(ns) {
    const target = String(ns.args[0] ?? "");
    const jobId = String(ns.args[1] ?? "");
    const threads = Math.max(0, Math.floor(Number(ns.args[2] ?? 0)));
    const additionalMsec = Math.max(0, Math.floor(Number(ns.args[3] ?? 0)));
    const batchId = String(ns.args[4] ?? "");
    const stage = String(ns.args[5] ?? "WEAKEN");
    const plannedLandingAt = Math.max(0, Number(ns.args[6] ?? 0));

    if (!target) {
        ns.tprint("ERROR: weaken.js requires a target hostname.");
        return;
    }

    await ns.weaken(target, { additionalMsec });
    const finishedAt = Date.now();

    if (batchId && plannedLandingAt > 0) {
        ns.writePort(BATCH_TIMING_PORT, JSON.stringify({
            type: "BATCH_STAGE_COMPLETE",
            batchId,
            stage,
            jobId,
            threads,
            finishedAt,
            plannedLandingAt,
            landingErrorMs: finishedAt - plannedLandingAt,
        }));
    }
}
