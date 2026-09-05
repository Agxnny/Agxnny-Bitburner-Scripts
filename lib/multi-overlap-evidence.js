const EVIDENCE_FILE = "/data/multi-overlap-evidence.txt";
const MODEL = "MULTI_TARGET_OVERLAP_EVIDENCE_V1";

export function emptyOverlapEvidence() {
    return { version: 1, model: MODEL, targets: {}, updatedAt: 0 };
}

/** @param {NS} ns */
export function readOverlapEvidence(ns) {
    if (!ns.fileExists(EVIDENCE_FILE, "home")) return emptyOverlapEvidence();
    try {
        const parsed = JSON.parse(String(ns.read(EVIDENCE_FILE)));
        if (parsed?.model !== MODEL) return emptyOverlapEvidence();
        return { ...emptyOverlapEvidence(), ...parsed, targets: parsed.targets ?? {} };
    } catch {
        return emptyOverlapEvidence();
    }
}

/** Persist one real depth-2 validation wave. BLOCKED/ABORTED attempts are neutral. @param {NS} ns */
export async function recordOverlapWave(ns, result) {
    const state = readOverlapEvidence(ns);
    const hostname = String(result?.target ?? "").trim();
    if (!hostname) return state;

    const previous = state.targets[hostname] ?? emptyTarget(hostname);
    const status = String(result?.status ?? "").toUpperCase();
    const neutral = status === "BLOCKED" || status === "ABORTED";
    const healthy = Boolean(result?.healthy) && !neutral;
    const consecutiveClean = neutral
        ? Number(previous.consecutiveClean ?? 0)
        : healthy ? Number(previous.consecutiveClean ?? 0) + 1 : 0;
    const drift = finiteNonNegative(result?.maxAbsLandingErrorMs);
    const spacing = finitePositive(result?.minimumSpacingMs);
    const spacings = [finitePositive(previous.minObservedSpacingMs), spacing].filter((value) => value > 0);
    const nextTarget = {
        ...previous,
        hostname,
        validationWaves: Number(previous.validationWaves ?? 0) + (neutral ? 0 : 1),
        blockedAttempts: Number(previous.blockedAttempts ?? 0) + (neutral ? 1 : 0),
        cleanWaves: Number(previous.cleanWaves ?? 0) + (healthy ? 1 : 0),
        failedWaves: Number(previous.failedWaves ?? 0) + (!neutral && !healthy ? 1 : 0),
        consecutiveClean,
        provenDepth: Math.max(Number(previous.provenDepth ?? 1), consecutiveClean >= 2 ? 2 : 1),
        latestHealthy: neutral ? Boolean(previous.latestHealthy) : healthy,
        maxObservedDriftMs: Math.max(finiteNonNegative(previous.maxObservedDriftMs), drift),
        minObservedSpacingMs: spacings.length ? Math.min(...spacings) : 0,
        lastHackFraction: finiteNonNegative(result?.hackFraction),
        lastStageGapMs: finiteNonNegative(result?.stageGapMs),
        lastStatus: status || (healthy ? "CLEAN" : "FAILED"),
        lastReason: String(result?.reason ?? ""),
        lastRunId: String(result?.runId ?? ""),
        updatedAt: Date.now(),
    };

    const next = {
        ...state,
        targets: { ...state.targets, [hostname]: nextTarget },
        updatedAt: Date.now(),
    };
    await ns.write(EVIDENCE_FILE, JSON.stringify(next), "w");
    return next;
}

export function overlapEvidenceFile() { return EVIDENCE_FILE; }

function emptyTarget(hostname) {
    return {
        hostname,
        provenDepth: 1,
        validationWaves: 0,
        blockedAttempts: 0,
        cleanWaves: 0,
        failedWaves: 0,
        consecutiveClean: 0,
        latestHealthy: false,
        maxObservedDriftMs: 0,
        minObservedSpacingMs: 0,
        updatedAt: 0,
    };
}
function finiteNonNegative(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}
function finitePositive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}
