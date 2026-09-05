import { appendBatchHistory, normalizeHistory } from "/lib/batch-history.js";
import {
    publishBatchHistoryState,
    readBatchHistoryState,
    readLastCompletedBatchState,
} from "/lib/runtime-state.js";
import { isQuiet } from "/lib/output.js";

const LOOP_MS = 250;
const HEARTBEAT_MS = 2_000;

/**
 * Watches Port 15 and builds rolling per-target real batch safety history on Port 19.
 * It does not own Port 14 and launches no workers.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    const quiet = isQuiet(ns);
    if (ns.getHostname() !== "home") {
        if (!quiet) ns.tprint("ERROR: Run hacking/batch-history.js from home.");
        return;
    }

    let history = normalizeHistory(readBatchHistoryState(ns));
    let lastBatchId = latestRecordedBatchId(history);
    let lastHeartbeat = 0;

    if (!quiet) ns.tprint("[BATCH-HISTORY] Watching Port 15; rolling real safety history is published on Port 19.");

    while (true) {
        const latest = readLastCompletedBatchState(ns);
        const batchId = String(latest?.batchId ?? "");
        if (batchId && batchId !== lastBatchId && String(latest?.status ?? "") === "COMPLETE") {
            history = appendBatchHistory(history, latest);
            lastBatchId = batchId;
            publishBatchHistoryState(ns, history);
            if (!quiet) {
                const target = String(latest?.target ?? "unknown");
                const safety = history.targets?.[target];
                ns.tprint(`[BATCH-HISTORY] ${target} | samples ${safety?.sampleCount ?? 0} | clean streak ${safety?.consecutiveClean ?? 0} | recommended depth ${safety?.recommendedDepth ?? 1} | ${safety?.confidence ?? "UNPROVEN"}`);
            }
        } else if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
            lastHeartbeat = Date.now();
            history.updatedAt = Date.now();
            publishBatchHistoryState(ns, history);
        }
        await ns.sleep(LOOP_MS);
    }
}

function latestRecordedBatchId(history) {
    let latestId = "";
    let latestAt = 0;
    for (const target of Object.values(history?.targets ?? {})) {
        const samples = Array.isArray(target?.samples) ? target.samples : [];
        for (const sample of samples) {
            const at = Number(sample?.finishedAt ?? 0);
            if (at >= latestAt) {
                latestAt = at;
                latestId = String(sample?.batchId ?? "");
            }
        }
    }
    return latestId;
}
