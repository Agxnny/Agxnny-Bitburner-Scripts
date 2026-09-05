import { appendBatchHistory, normalizeHistory } from "/lib/batch-history.js";
import {
    publishBatchHistoryState,
    readBatchHistoryState,
    readLastCompletedBatchState,
} from "/lib/runtime-state.js";
import { isQuiet } from "/lib/output.js";

const LOOP_MS = 250;
const HEARTBEAT_MS = 2_000;
const STARTUP_FRESHNESS_SLOP_MS = 1_000;

/**
 * Watches Port 15 and builds rolling per-target real batch safety history on Port 19.
 * It does not own Port 14 and launches no workers.
 *
 * The collector only accepts completions that are genuinely new after this
 * process starts. Port 15 is latest-value state, so a stale snapshot or a
 * replayed previously-seen batch ID must never manufacture extra evidence.
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

    const startedAt = Date.now();
    let history = normalizeHistory(readBatchHistoryState(ns));
    const seenBatchIds = recordedBatchIds(history);

    // Treat the snapshot present at startup as already observed. This prevents a
    // restart from ingesting an old Port 15 completion as a fresh sample.
    const startupSnapshot = readLastCompletedBatchState(ns);
    const startupBatchId = String(startupSnapshot?.batchId ?? "");
    if (startupBatchId) seenBatchIds.add(startupBatchId);

    let lastHeartbeat = 0;

    if (!quiet) ns.tprint("[BATCH-HISTORY] Watching Port 15; rolling real safety history is published on Port 19.");

    while (true) {
        const latest = readLastCompletedBatchState(ns);
        const batchId = String(latest?.batchId ?? "");
        const finishedAt = Number(latest?.finishedAt ?? latest?.updatedAt ?? 0);
        const isFresh = finishedAt >= startedAt - STARTUP_FRESHNESS_SLOP_MS;
        const isComplete = String(latest?.status ?? "") === "COMPLETE";

        if (batchId && isComplete && isFresh && !seenBatchIds.has(batchId)) {
            history = appendBatchHistory(history, latest);
            seenBatchIds.add(batchId);
            publishBatchHistoryState(ns, history);
            if (!quiet) {
                const target = String(latest?.target ?? "unknown");
                const safety = history.targets?.[target];
                const source = latest?.pipeline ? "PIPELINE" : "BATCH";
                ns.tprint(`[BATCH-HISTORY] ${target} | ${source} ${shortId(batchId)} | samples ${safety?.sampleCount ?? 0} | pipeline evidence ${safety?.pipelineSampleCount ?? 0} | clean streak ${safety?.consecutiveClean ?? 0} | recommended depth ${safety?.recommendedDepth ?? 1} | ${safety?.confidence ?? "UNPROVEN"}`);
            }
        } else if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
            lastHeartbeat = Date.now();
            history.updatedAt = Date.now();
            publishBatchHistoryState(ns, history);
        }
        await ns.sleep(LOOP_MS);
    }
}

function recordedBatchIds(history) {
    const ids = new Set();
    for (const target of Object.values(history?.targets ?? {})) {
        for (const sample of Array.isArray(target?.samples) ? target.samples : []) {
            const id = String(sample?.batchId ?? "");
            if (id) ids.add(id);
        }
    }
    return ids;
}

function shortId(value) {
    const id = String(value ?? "");
    return id.length <= 30 ? id : `…${id.slice(-29)}`;
}
