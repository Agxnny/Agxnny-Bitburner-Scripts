const MIN_DEPTH = 1;
const CURRENT_REAL_MAX_DEPTH = 2;

/**
 * Conservative per-target overlap policy for real MULTI work.
 *
 * Pipeline history may make a target eligible for dedicated depth-2 validation,
 * but real MULTI production only receives depth 2 after separate overlap
 * evidence proves it. A later failed validation demotes active production back
 * to depth 1 even though historical proof remains recorded.
 */
export function targetOverlapPolicy(history, hostname, overlapEvidence = null) {
    const name = String(hostname ?? "");
    const target = history?.targets?.[name] ?? null;
    const dedicated = overlapEvidence?.targets?.[name] ?? null;
    const pipeline = pipelineEligibility(target);

    if (dedicated && Number(dedicated.provenDepth ?? 1) >= 2) {
        if (dedicated.latestHealthy === false) {
            return result(name, 1, pipeline.candidateDepth, false, pipeline.eligible, "DEDICATED_FAILED", String(dedicated.lastReason || "Latest dedicated overlap validation failed"), String(target?.confidence ?? "UNPROVEN"));
        }
        return result(
            name,
            CURRENT_REAL_MAX_DEPTH,
            CURRENT_REAL_MAX_DEPTH,
            true,
            true,
            "DEDICATED_PROOF",
            `${Number(dedicated.consecutiveClean ?? 0)} consecutive clean dedicated overlap wave(s); depth 2 proven`,
            String(target?.confidence ?? "LOW"),
        );
    }

    if (dedicated && dedicated.latestHealthy === false && Number(dedicated.validationWaves ?? 0) > 0) {
        return result(name, 1, pipeline.candidateDepth, false, pipeline.eligible, "DEDICATED_FAILED", String(dedicated.lastReason || "Latest dedicated overlap validation failed"), String(target?.confidence ?? "UNPROVEN"));
    }

    return result(
        name,
        1,
        pipeline.candidateDepth,
        false,
        pipeline.eligible,
        pipeline.eligible ? "PIPELINE_CANDIDATE" : "UNPROVEN",
        pipeline.reason,
        pipeline.confidence,
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

function pipelineEligibility(target) {
    if (!target) {
        return { eligible: false, candidateDepth: 1, confidence: "UNPROVEN", reason: "No real batch history for this target" };
    }
    const latestHealthy = target.latestHealthy !== false;
    const consecutiveClean = Math.max(0, Number(target.consecutiveClean ?? 0));
    const pipelineSamples = Math.max(0, Number(target.pipelineSampleCount ?? 0));
    const confidence = String(target.confidence ?? "UNPROVEN");
    if (!latestHealthy) {
        return { eligible: false, candidateDepth: 1, confidence, reason: "Latest real pipeline sample is unhealthy" };
    }
    if (pipelineSamples >= 2 && consecutiveClean >= 2) {
        return {
            eligible: true,
            candidateDepth: CURRENT_REAL_MAX_DEPTH,
            confidence,
            reason: `${consecutiveClean} consecutive clean real pipeline batch(es); eligible for dedicated depth-2 validation`,
        };
    }
    return {
        eligible: false,
        candidateDepth: 1,
        confidence,
        reason: `Need 2 consecutive clean real pipeline batches; have ${consecutiveClean}`,
    };
}

function result(hostname, provenDepth, candidateDepth, eligibleForOverlap, eligibleForValidation, source, reason, confidence) {
    return {
        version: 2,
        model: "MULTI_TARGET_OVERLAP_POLICY_V2_SEPARATE_PROOF",
        hostname,
        provenDepth: clampDepth(provenDepth),
        candidateDepth: clampDepth(candidateDepth),
        confidence,
        eligibleForOverlap: Boolean(eligibleForOverlap),
        eligibleForValidation: Boolean(eligibleForValidation),
        source,
        reason,
    };
}
function clampDepth(value) {
    const depth = Math.floor(Number(value) || MIN_DEPTH);
    return Math.min(CURRENT_REAL_MAX_DEPTH, Math.max(MIN_DEPTH, depth));
}
