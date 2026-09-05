const DEPTH_LADDER = Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
const HACK_FRACTIONS = Object.freeze([0.05, 0.075, 0.10, 0.125, 0.15, 0.20]);
const STAGE_GAPS_MS = Object.freeze([100, 125, 150, 175, 200, 250]);

/** Pure target-local tuning recommendation. Never promotes beyond dedicated proof. */
export function targetTuningProfile(hostname, evidenceTarget, fallback = {}) {
    const depths = evidenceTarget?.depths ?? {};
    const provenDepth = Math.max(1, Number(evidenceTarget?.provenDepth ?? 1));
    const proven = depths[String(provenDepth)] ?? null;
    return {
        version: 1,
        model: "MULTI_TARGET_TUNING_V1",
        hostname: String(hostname ?? ""),
        provenDepth,
        effectiveDepth: provenDepth,
        hackFraction: clampFraction(proven?.lastHackFraction || fallback.hackFraction || 0.10),
        stageGapMs: clampGap(proven?.lastStageGapMs || fallback.stageGapMs || 200),
        batchIntervalMs: Math.max(0, Number(proven?.lastBatchIntervalMs ?? 0)),
        nextValidation: nextValidationCandidate(provenDepth, proven, depths),
    };
}

/** Pick the next conservative experiment around the last proven operating point. */
export function nextValidationCandidate(provenDepth, provenProfile = null, depths = {}) {
    const current = Math.max(1, Math.floor(Number(provenDepth) || 1));
    const nextDepth = DEPTH_LADDER.find((depth) => depth > current) ?? current;
    const failedNext = depths[String(nextDepth)]?.latestHealthy === false;
    const hack = clampFraction(provenProfile?.lastHackFraction || 0.10);
    const gap = clampGap(provenProfile?.lastStageGapMs || 200);
    if (nextDepth > current && !failedNext) return { kind: "DEPTH", depth: nextDepth, hackFraction: hack, stageGapMs: gap };
    const lowerGap = [...STAGE_GAPS_MS].reverse().find((value) => value < gap);
    if (lowerGap) return { kind: "TIMING", depth: current, hackFraction: hack, stageGapMs: lowerGap };
    const higherHack = HACK_FRACTIONS.find((value) => value > hack + 1e-9);
    if (higherHack) return { kind: "HACK", depth: current, hackFraction: higherHack, stageGapMs: gap };
    return { kind: "HOLD", depth: current, hackFraction: hack, stageGapMs: gap };
}

/** Marginal candidate score used by the future portfolio allocator. */
export function marginalBatchScore(template, localDepth, tuning = {}) {
    const cash = Math.max(0, Number(template?.expectedCash ?? 0));
    const ram = Math.max(1e-9, Number(template?.totalRam ?? template?.batchRam ?? 0));
    const durationMs = Math.max(1, Number(template?.cycleMs ?? template?.weakenTime ?? 1));
    const depthPenalty = 1 + Math.max(0, Number(localDepth ?? 0)) * 0.025;
    const objective = Math.max(0, Number(template?.baseScore ?? 0));
    const moneyEfficiency = cash / (ram * durationMs / 1000);
    return { score: (moneyEfficiency + objective) / depthPenalty, moneyEfficiency, depthPenalty, tuning };
}

export function tuningDepthLadder() { return [...DEPTH_LADDER]; }
export function tuningHackFractions() { return [...HACK_FRACTIONS]; }
export function tuningStageGapsMs() { return [...STAGE_GAPS_MS]; }

function clampFraction(value) { const n = Number(value); return Number.isFinite(n) ? Math.min(0.50, Math.max(0.001, n)) : 0.10; }
function clampGap(value) { const n = Math.round(Number(value)); return Number.isFinite(n) ? Math.min(1000, Math.max(75, n)) : 200; }
