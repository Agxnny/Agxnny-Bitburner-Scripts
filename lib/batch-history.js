const MAX_SAMPLES_PER_TARGET = 16;
const MONEY_TOLERANCE = 0.995;
const SECURITY_TOLERANCE = 0.05;
const MAX_LANDING_ERROR_MS = 150;
const MIN_SPACING_MS = 75;

export function appendBatchHistory(history, complete) {
    const state = normalizeHistory(history);
    const target = String(complete?.target ?? "").trim();
    if (!target) return state;

    const sample = makeSample(complete);
    const current = state.targets[target] ?? { samples: [] };
    const samples = [...current.samples, sample].slice(-MAX_SAMPLES_PER_TARGET);
    state.targets[target] = summarizeTarget(target, samples);
    state.updatedAt = Date.now();
    return state;
}

export function normalizeHistory(history) {
    const input = history && typeof history === "object" ? history : {};
    const targets = {};
    for (const [hostname, entry] of Object.entries(input.targets ?? {})) {
        const samples = Array.isArray(entry?.samples) ? entry.samples.slice(-MAX_SAMPLES_PER_TARGET) : [];
        targets[hostname] = summarizeTarget(hostname, samples);
    }
    return {
        version: 1,
        model: "ROLLING_BATCH_HISTORY_V1",
        maxSamplesPerTarget: MAX_SAMPLES_PER_TARGET,
        targets,
        updatedAt: Number(input.updatedAt ?? 0),
    };
}

export function getTargetBatchSafety(history, hostname) {
    const state = normalizeHistory(history);
    const target = state.targets[String(hostname ?? "")];
    if (!target) {
        return {
            hostname: String(hostname ?? ""),
            sampleCount: 0,
            cleanSamples: 0,
            consecutiveClean: 0,
            recommendedDepth: 1,
            confidence: "UNPROVEN",
            reason: "No real completed-batch history yet",
        };
    }
    return target;
}

function makeSample(complete) {
    const landing = complete?.landing ?? {};
    const final = complete?.final ?? {};
    const orderCorrect = Boolean(landing.orderCorrect);
    const missingJobs = Math.max(0, Number(landing.missingJobs ?? landing.totalMissingJobs ?? 0));
    const maxAbsLandingErrorMs = Math.max(0, Number(landing.maxAbsLandingErrorMs ?? 0));
    const minimumSpacingMs = Math.max(0, Number(landing.minimumSpacingMs ?? 0));
    const moneyPercent = Number(final.moneyPercent ?? 0);
    const securityDelta = Math.max(0, Number(final.securityDelta ?? Infinity));
    const healthy = orderCorrect
        && missingJobs === 0
        && moneyPercent >= MONEY_TOLERANCE
        && securityDelta <= SECURITY_TOLERANCE
        && maxAbsLandingErrorMs <= MAX_LANDING_ERROR_MS
        && minimumSpacingMs >= MIN_SPACING_MS;

    return {
        batchId: String(complete?.batchId ?? ""),
        finishedAt: Number(complete?.finishedAt ?? complete?.updatedAt ?? Date.now()),
        healthy,
        orderCorrect,
        missingJobs,
        moneyPercent,
        securityDelta,
        maxAbsLandingErrorMs,
        minimumSpacingMs,
        maxAllocationSpreadMs: Math.max(0, Number(landing.maxAllocationSpreadMs ?? 0)),
        batchIntervalMs: Math.max(0, Number(complete?.batchIntervalMs ?? 0)),
        gapMs: Math.max(0, Number(complete?.gapMs ?? 0)),
    };
}

function summarizeTarget(hostname, samples) {
    let consecutiveClean = 0;
    for (let i = samples.length - 1; i >= 0; i -= 1) {
        if (!samples[i]?.healthy) break;
        consecutiveClean += 1;
    }
    const cleanSamples = samples.filter((sample) => sample?.healthy).length;
    const maxAbsLandingErrorMs = samples.length ? Math.max(...samples.map((s) => Number(s.maxAbsLandingErrorMs ?? 0))) : 0;
    const minSpacingMs = samples.length ? Math.min(...samples.map((s) => Number(s.minimumSpacingMs ?? Infinity))) : 0;
    const maxRecoveryMoneyError = samples.length ? Math.max(...samples.map((s) => Math.max(0, 1 - Number(s.moneyPercent ?? 0)))) : 0;
    const maxSecurityDelta = samples.length ? Math.max(...samples.map((s) => Number(s.securityDelta ?? 0))) : 0;

    let recommendedDepth = 1;
    if (consecutiveClean >= 8) recommendedDepth = 8;
    else if (consecutiveClean >= 4) recommendedDepth = 4;
    else if (consecutiveClean >= 2) recommendedDepth = 2;

    const confidence = consecutiveClean >= 8 ? "HIGH" : consecutiveClean >= 4 ? "MEDIUM" : consecutiveClean >= 2 ? "LOW" : "UNPROVEN";
    const latest = samples.length ? samples[samples.length - 1] : null;
    return {
        hostname,
        samples,
        sampleCount: samples.length,
        cleanSamples,
        consecutiveClean,
        recommendedDepth,
        confidence,
        latestHealthy: Boolean(latest?.healthy),
        lastFinishedAt: Number(latest?.finishedAt ?? 0),
        maxAbsLandingErrorMs,
        minSpacingMs: Number.isFinite(minSpacingMs) ? minSpacingMs : 0,
        maxRecoveryMoneyError,
        maxSecurityDelta,
        reason: latest?.healthy
            ? `${consecutiveClean} consecutive clean real batch(es)`
            : samples.length
                ? "Latest real batch failed safety history criteria"
                : "No real completed-batch history yet",
    };
}
