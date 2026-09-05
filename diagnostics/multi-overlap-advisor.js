import { buildPreparedBatchTemplate } from "/lib/batch-allocation.js";
import { summarizeExecutionPool } from "/lib/execution.js";
import { readOverlapEvidence } from "/lib/multi-overlap-evidence.js";
import { targetOverlapPolicy } from "/lib/multi-overlap-policy.js";
import { multiTargetRankingSource, multiTargetRankings } from "/lib/multi-target-ranking.js";
import { readBatchHistoryState, readEconomyTargetState, readPlannerState } from "/lib/runtime-state.js";
import { positionalArgs } from "/lib/output.js";

const DEFAULT_HACK_FRACTION = 0.10;
const DEFAULT_STAGE_GAP_MS = 200;
const DEFAULT_TARGET_COUNT = 12;

/** Read-only readiness report for real same-target overlap. @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const args = positionalArgs(ns);
    const profile = normalizeProfile(args[0]);
    const hackFraction = clamp(Number(args[1] ?? DEFAULT_HACK_FRACTION), 0.001, 0.90);
    const targetCount = clampInt(Number(args[2] ?? DEFAULT_TARGET_COUNT), 2, 12);

    const planner = readPlannerState(ns);
    const economic = readEconomyTargetState(ns);
    const history = readBatchHistoryState(ns);
    const evidence = readOverlapEvidence(ns);
    if (!planner) {
        ns.tprint("[OVERLAP] BLOCKED: planner state unavailable");
        return;
    }

    const pool = summarizeExecutionPool(ns, planner);
    const rankings = multiTargetRankings(planner, economic, profile).slice(0, targetCount);
    const rows = rankings.map((entry) => inspectTarget(ns, entry, history, evidence, hackFraction));
    const prepared = rows.filter((row) => row.prepared);
    const validation = prepared.filter((row) => row.policy.eligibleForValidation);
    const proven = prepared.filter((row) => row.policy.provenDepth >= 2 && row.policy.eligibleForOverlap);

    ns.tprint("=== MULTI OVERLAP ADVISOR · READ ONLY ===");
    ns.tprint(`[OVERLAP] ${profile.toUpperCase()} · ranking ${multiTargetRankingSource(planner, economic, profile)} · hack ${(hackFraction * 100).toFixed(1)}% · gap ${DEFAULT_STAGE_GAP_MS}ms`);
    ns.tprint(`[OVERLAP] Production RAM ${formatRam(pool.usableRam)} across ${pool.hostCount} host(s)`);
    ns.tprint(`[OVERLAP] Prepared ${prepared.length}/${rows.length} · validate-2 candidates ${validation.length} · dedicated depth-2 proven ${proven.length}`);
    ns.tprint("[OVERLAP] Pipeline history only qualifies validation; real MULTI depth 2 requires dedicated overlap proof.");

    for (const row of rows) {
        const state = !row.prepared
            ? "PREP"
            : row.policy.provenDepth >= 2 && row.policy.eligibleForOverlap
                ? "PROVEN2"
                : row.policy.eligibleForValidation ? "VALIDATE2" : "DEPTH1";
        ns.tprint(`  ${row.hostname.padEnd(18)} ${state.padEnd(9)} | ${formatRam(row.batchRam).padStart(8)} / batch | ${row.policy.source.padEnd(18)} | ${row.policy.reason}`);
    }
}

function inspectTarget(ns, entry, history, evidence, hackFraction) {
    const template = buildPreparedBatchTemplate(ns, entry, hackFraction, DEFAULT_STAGE_GAP_MS);
    const hostname = String(entry?.hostname ?? template?.hostname ?? "");
    const policy = targetOverlapPolicy(history, hostname, evidence);
    return {
        hostname,
        prepared: Boolean(template?.ok && template.preparedNow),
        batchRam: Number(template?.batchRam ?? 0),
        policy,
    };
}
function normalizeProfile(value) {
    const profile = String(value ?? "money").trim().toLowerCase();
    return ["money", "balanced", "xp"].includes(profile) ? profile : "money";
}
function clamp(value, min, max) { return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min; }
function clampInt(value, min, max) { return Math.floor(clamp(value, min, max)); }
function formatRam(value) { return `${Number(value ?? 0).toFixed(Number(value ?? 0) >= 100 ? 0 : 1)} GB`; }
