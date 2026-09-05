const MIN_DEPTH = 1;
const CURRENT_REAL_MAX_DEPTH = 2;

/**
 * Conservative per-target overlap policy for real MULTI work.
 *
 * Port 19 history currently proves repeated pipeline health, but the only
 * explicitly validated real same-target overlap mode is depth 2. Therefore this
 * policy never promotes real MULTI beyond depth 2 yet, even if the older
 * recommendedDepth ladder reports 4/8 from accumulated clean samples.
 */
export function targetOverlapPolicy(history, hostname) {
    const target = history?.targets?.[String(hostname ?? "")] ?? null;
    if (!target) return result(hostname, 1, "UNPROVEN", "No real batch history for this target", false);

    const latestHealthy = target.latestHealthy !== false;
    const consecutiveClean = Math.max(0, Number(target.consecutiveClean ?? 0));
    const pipelineSamples = Math.max(0, Number(target.pipelineSampleCount ?? 0));
    if (!latestHealthy) {
        return result(hostname, 1, String(target.confidence ?? "UNPROVEN"), "Latest real pipeline sample is unhealthy", false);
    }
    if (pipelineSamples >= 2 && consecutiveClean >= 2) {
        return result(
            hostname,
            CURRENT_REAL_MAX_DEPTH,
            String(target.confidence ?? "LOW"),
            `${consecutiveClean} consecutive clean real pipeline batch(es); depth 2 eligible`,
            true,
        );
    }
    return result(
        hostname,
        1,
        String(target.confidence ?? "UNPROVEN"),
        `Need 2 consecutive clean real pipeline batches; have ${consecutiveClean}`,
        false,
    );
}

/** Apply current active depth and an optional global admission budget. */
export function canAdmitTargetOverlap(policy, activeDepth, globalInFlight, globalCap) {
    const depth = Math.max(0, Math.floor(Number(activeDepth) || 0));
    const inFlight = Math.max(0, Math.floor(Number(globalInFlight) || 0));
    const cap = Math.max(1, Math.floor(Number(globalCap) || 1));
    if (inFlight >= cap) return { ok: false, reason: "global live cap reached" };
    if (depth >= Number(policy?.provenDepth ?? 1)) return { ok: false, reason: "target overlap proof cap reached" };
    return { ok: true, reason: "within global and per-target proof caps" };
}

export function currentRealOverlapMaxDepth() { return CURRENT_REAL_MAX_DEPTH; }

function result(hostname, provenDepth, confidence, reason, eligible) {
    return {
        version: 1,
        model: "MULTI_TARGET_OVERLAP_POLICY_V1",
        hostname: String(hostname ?? ""),
        provenDepth: clampDepth(provenDepth),
        confidence,
        eligibleForOverlap: Boolean(eligible),
        reason,
    };
}
function clampDepth(value) {
    const depth = Math.floor(Number(value) || MIN_DEPTH);
    return Math.min(CURRENT_REAL_MAX_DEPTH, Math.max(MIN_DEPTH, depth));
}
