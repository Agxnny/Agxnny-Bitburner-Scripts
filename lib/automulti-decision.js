const MIN_DEPTH = 2;
const MAX_DEPTH = 12;
const DEFAULT_STAGE_GAP_MS = 200;
const DEFAULT_FALLBACK_PROVEN_DEPTH = 2;

const PROFILE_WEIGHTS = Object.freeze({
    money: { money: 1.00, xp: 0.00 },
    balanced: { money: 0.70, xp: 0.30 },
    xp: { money: 0.00, xp: 1.00 },
});

/**
 * Pure AUTOMULTI decision engine. No Netscript calls.
 *
 * Input scenarios are precomputed live snapshots for different profile/hack%
 * combinations. This module only decides which safe configuration is best.
 */
export function chooseAutoMultiDecision(input = {}) {
    const objective = normalizeProfile(input.objective);
    const evidence = input.evidence ?? {};
    const scenarios = Array.isArray(input.scenarios) ? input.scenarios : [];
    const fallbackDepth = clampInt(input.fallbackProvenDepth ?? DEFAULT_FALLBACK_PROVEN_DEPTH, MIN_DEPTH, MAX_DEPTH);
    const durableDepth = clampInt(evidence.provenDepth ?? 1, 1, MAX_DEPTH);
    const provenDepth = Math.max(fallbackDepth, durableDepth);

    const evaluated = scenarios
        .map((scenario) => evaluateScenario(scenario, objective, provenDepth))
        .filter((scenario) => scenario.preparedCount >= MIN_DEPTH && scenario.possibleDepth >= MIN_DEPTH)
        .sort(compareScenario);

    if (!evaluated.length) {
        return {
            version: 1,
            model: "AUTOMULTI_DECISION_V1",
            status: "BLOCKED",
            objective,
            reason: "No scenario has at least two prepared, RAM-feasible targets",
            possibleDepth: 0,
            provenDepth,
            effectiveDepth: 0,
            validationDepth: 0,
            shouldValidate: false,
            config: null,
            alternatives: [],
        };
    }

    const best = evaluated[0];
    const effectiveDepth = Math.min(best.possibleDepth, provenDepth, MAX_DEPTH);
    const validationDepth = best.possibleDepth > provenDepth ? Math.min(MAX_DEPTH, provenDepth + 1) : 0;
    const targetCount = chooseTargetCount(best.preparedCount, effectiveDepth);

    return {
        version: 1,
        model: "AUTOMULTI_DECISION_V1",
        status: effectiveDepth >= MIN_DEPTH ? "READY" : "BLOCKED",
        objective,
        reason: decisionReason(best, provenDepth, effectiveDepth, validationDepth),
        possibleDepth: best.possibleDepth,
        provenDepth,
        durableProvenDepth: durableDepth,
        fallbackProvenDepth: fallbackDepth,
        effectiveDepth,
        validationDepth,
        shouldValidate: validationDepth > effectiveDepth,
        config: {
            profile: best.profile,
            targetCount,
            globalDepth: effectiveDepth,
            hackPercent: best.hackPercent,
            stageGapMs: best.stageGapMs,
        },
        metrics: {
            preparedCount: best.preparedCount,
            feasibleCount: best.feasibleCount,
            usableRamGb: best.usableRamGb,
            selectedBatchRamGb: best.selectedBatchRamGb,
            objectiveScore: best.objectiveScore,
            moneyRate: best.moneyRate,
            xpRate: best.xpRate,
        },
        selectedTargets: best.selectedTargets.slice(0, effectiveDepth),
        alternatives: evaluated.slice(1, 5).map(compactScenario),
    };
}

function evaluateScenario(scenario, objective, provenDepth) {
    const profile = normalizeProfile(scenario.profile ?? objective);
    const candidates = (Array.isArray(scenario.candidates) ? scenario.candidates : [])
        .filter((candidate) => candidate?.prepared === true && Number(candidate?.batchRamGb ?? 0) > 0)
        .map((candidate) => scoreCandidate(candidate, objective))
        .sort((a, b) => b.objectiveScore - a.objectiveScore || b.moneyRate - a.moneyRate || a.hostname.localeCompare(b.hostname));

    const usableRamGb = Math.max(0, Number(scenario.usableRamGb ?? 0));
    let ram = 0;
    const feasible = [];
    for (const candidate of candidates) {
        if (feasible.length >= MAX_DEPTH) break;
        const nextRam = ram + candidate.batchRamGb;
        if (nextRam > usableRamGb + 1e-9) continue;
        feasible.push(candidate);
        ram = nextRam;
    }

    const possibleDepth = Math.min(MAX_DEPTH, feasible.length);
    const effectiveDepth = Math.min(possibleDepth, provenDepth);
    const selected = feasible.slice(0, Math.max(MIN_DEPTH, effectiveDepth));
    return {
        profile,
        hackPercent: Number(scenario.hackPercent ?? 10),
        stageGapMs: clampInt(scenario.stageGapMs ?? DEFAULT_STAGE_GAP_MS, 75, 5000),
        preparedCount: candidates.length,
        feasibleCount: feasible.length,
        possibleDepth,
        usableRamGb,
        selectedBatchRamGb: sum(selected, "batchRamGb"),
        objectiveScore: sum(selected, "objectiveScore"),
        moneyRate: sum(selected, "moneyRate"),
        xpRate: sum(selected, "xpRate"),
        selectedTargets: feasible.map((candidate) => candidate.hostname),
    };
}

function scoreCandidate(candidate, objective) {
    const weights = PROFILE_WEIGHTS[objective];
    const moneyRate = Math.max(0, Number(candidate.moneyRate ?? 0));
    const xpRate = Math.max(0, Number(candidate.xpRate ?? 0));
    const moneyEfficiency = Math.max(0, Number(candidate.moneyEfficiency ?? 0));
    const xpEfficiency = Math.max(0, Number(candidate.xpEfficiency ?? 0));
    const objectiveScore = weights.money * (moneyRate + moneyEfficiency * 0.05)
        + weights.xp * (xpRate + xpEfficiency * 0.05);
    return {
        hostname: String(candidate.hostname ?? ""),
        batchRamGb: Math.max(0, Number(candidate.batchRamGb ?? 0)),
        moneyRate,
        xpRate,
        moneyEfficiency,
        xpEfficiency,
        objectiveScore,
    };
}

function chooseTargetCount(preparedCount, effectiveDepth) {
    const buffer = effectiveDepth >= 6 ? 3 : 2;
    return clampInt(Math.max(effectiveDepth, Math.min(preparedCount, effectiveDepth + buffer)), MIN_DEPTH, MAX_DEPTH);
}

function decisionReason(best, provenDepth, effectiveDepth, validationDepth) {
    if (best.possibleDepth > provenDepth) {
        return `Run depth ${effectiveDepth}; ${best.possibleDepth} appears possible but only ${provenDepth} is proven. Validate depth ${validationDepth} separately.`;
    }
    return `Run depth ${effectiveDepth}; limited by ${best.possibleDepth < MAX_DEPTH ? "prepared/RAM feasibility" : "configured maximum"}.`;
}

function compactScenario(scenario) {
    return {
        profile: scenario.profile,
        hackPercent: scenario.hackPercent,
        stageGapMs: scenario.stageGapMs,
        possibleDepth: scenario.possibleDepth,
        preparedCount: scenario.preparedCount,
        objectiveScore: scenario.objectiveScore,
    };
}

function compareScenario(a, b) {
    return b.objectiveScore - a.objectiveScore
        || b.possibleDepth - a.possibleDepth
        || a.selectedBatchRamGb - b.selectedBatchRamGb
        || a.hackPercent - b.hackPercent;
}

function normalizeProfile(value) {
    const profile = String(value ?? "money").toLowerCase();
    return PROFILE_WEIGHTS[profile] ? profile : "money";
}
function clampInt(value, min, max) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}
function sum(items, field) { return items.reduce((total, item) => total + Number(item?.[field] ?? 0), 0); }
