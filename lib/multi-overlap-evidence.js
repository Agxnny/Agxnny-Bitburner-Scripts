const EVIDENCE_FILE = "/data/multi-overlap-evidence.txt";
const MODEL = "MULTI_TARGET_OVERLAP_EVIDENCE_V2_DYNAMIC_DEPTH";
const LEGACY_MODEL = "MULTI_TARGET_OVERLAP_EVIDENCE_V1";

export function emptyOverlapEvidence() {
    return { version: 2, model: MODEL, targets: {}, updatedAt: 0 };
}

/** Read V2 evidence and migrate V1 depth-2 proof in memory without losing runtime data. @param {NS} ns */
export function readOverlapEvidence(ns) {
    if (!ns.fileExists(EVIDENCE_FILE, "home")) return emptyOverlapEvidence();
    try {
        const parsed = JSON.parse(String(ns.read(EVIDENCE_FILE)));
        if (parsed?.model === MODEL) return { ...emptyOverlapEvidence(), ...parsed, targets: parsed.targets ?? {} };
        if (parsed?.model === LEGACY_MODEL) return migrateV1(parsed);
        return emptyOverlapEvidence();
    } catch { return emptyOverlapEvidence(); }
}

/** Persist one dedicated validation wave at its tested depth. BLOCKED/ABORTED are neutral. @param {NS} ns */
export async function recordOverlapWave(ns, result) {
    const state = readOverlapEvidence(ns);
    const hostname = String(result?.target ?? "").trim();
    if (!hostname) return state;
    const depth = Math.max(2, Math.floor(Number(result?.depth ?? 2)));
    const previous = normalizeTarget(state.targets[hostname], hostname);
    const status = String(result?.status ?? "").toUpperCase();
    const neutral = status === "BLOCKED" || status === "ABORTED";
    const healthy = Boolean(result?.healthy) && !neutral;
    const priorProfile = previous.depths[String(depth)] ?? emptyDepth(depth);
    const consecutiveClean = neutral ? priorProfile.consecutiveClean : healthy ? priorProfile.consecutiveClean + 1 : 0;
    const profile = {
        ...priorProfile,
        depth,
        validationWaves: priorProfile.validationWaves + (neutral ? 0 : 1),
        blockedAttempts: priorProfile.blockedAttempts + (neutral ? 1 : 0),
        cleanWaves: priorProfile.cleanWaves + (healthy ? 1 : 0),
        failedWaves: priorProfile.failedWaves + (!neutral && !healthy ? 1 : 0),
        consecutiveClean,
        proven: priorProfile.proven || consecutiveClean >= 2,
        latestHealthy: neutral ? priorProfile.latestHealthy : healthy,
        maxObservedDriftMs: Math.max(finiteNonNegative(priorProfile.maxObservedDriftMs), finiteNonNegative(result?.maxAbsLandingErrorMs)),
        minObservedSpacingMs: minimumPositive(priorProfile.minObservedSpacingMs, result?.minimumSpacingMs),
        lastHackFraction: finiteNonNegative(result?.hackFraction),
        lastStageGapMs: finiteNonNegative(result?.stageGapMs),
        lastBatchIntervalMs: finiteNonNegative(result?.batchIntervalMs),
        lastStatus: status || (healthy ? "CLEAN" : "FAILED"),
        lastReason: String(result?.reason ?? ""),
        lastRunId: String(result?.runId ?? ""),
        updatedAt: Date.now(),
    };
    const depths = { ...previous.depths, [String(depth)]: profile };
    const provenDepth = highestActiveProvenDepth(depths);
    const nextTarget = {
        ...previous,
        hostname,
        depths,
        provenDepth,
        latestHealthy: profile.latestHealthy,
        lastTestedDepth: depth,
        lastHackFraction: profile.lastHackFraction,
        lastStageGapMs: profile.lastStageGapMs,
        lastStatus: profile.lastStatus,
        lastReason: profile.lastReason,
        updatedAt: Date.now(),
    };
    const next = { ...state, version: 2, model: MODEL, targets: { ...state.targets, [hostname]: nextTarget }, updatedAt: Date.now() };
    await ns.write(EVIDENCE_FILE, JSON.stringify(next), "w");
    return next;
}

/** Highest depth whose own latest validation is healthy and whose lower ladder remains proven. */
export function activeProvenDepth(target) {
    return highestActiveProvenDepth(normalizeTarget(target, target?.hostname ?? "").depths);
}

export function overlapEvidenceFile() { return EVIDENCE_FILE; }

function migrateV1(parsed) {
    const targets = {};
    for (const [hostname, old] of Object.entries(parsed?.targets ?? {})) {
        const target = normalizeTarget(null, hostname);
        if (Number(old?.provenDepth ?? 1) >= 2 || Number(old?.validationWaves ?? 0) > 0) {
            target.depths["2"] = {
                ...emptyDepth(2),
                validationWaves: Number(old.validationWaves ?? 0), blockedAttempts: Number(old.blockedAttempts ?? 0),
                cleanWaves: Number(old.cleanWaves ?? 0), failedWaves: Number(old.failedWaves ?? 0), consecutiveClean: Number(old.consecutiveClean ?? 0),
                proven: Number(old.provenDepth ?? 1) >= 2, latestHealthy: Boolean(old.latestHealthy),
                maxObservedDriftMs: finiteNonNegative(old.maxObservedDriftMs), minObservedSpacingMs: finiteNonNegative(old.minObservedSpacingMs),
                lastHackFraction: finiteNonNegative(old.lastHackFraction), lastStageGapMs: finiteNonNegative(old.lastStageGapMs),
                lastStatus: String(old.lastStatus ?? ""), lastReason: String(old.lastReason ?? ""), lastRunId: String(old.lastRunId ?? ""), updatedAt: Number(old.updatedAt ?? 0),
            };
        }
        targets[hostname] = { ...target, ...old, depths: target.depths, provenDepth: highestActiveProvenDepth(target.depths) };
    }
    return { version: 2, model: MODEL, targets, updatedAt: Number(parsed?.updatedAt ?? 0) };
}

function normalizeTarget(value, hostname) {
    return { hostname, provenDepth: 1, latestHealthy: false, lastTestedDepth: 0, depths: {}, updatedAt: 0, ...(value ?? {}), depths: { ...(value?.depths ?? {}) } };
}
function emptyDepth(depth) {
    return { depth, validationWaves: 0, blockedAttempts: 0, cleanWaves: 0, failedWaves: 0, consecutiveClean: 0, proven: false, latestHealthy: false, maxObservedDriftMs: 0, minObservedSpacingMs: 0, lastHackFraction: 0, lastStageGapMs: 0, lastBatchIntervalMs: 0, lastStatus: "", lastReason: "", lastRunId: "", updatedAt: 0 };
}
function highestActiveProvenDepth(depths) {
    let proven = 1;
    for (const depth of Object.keys(depths ?? {}).map(Number).filter((n) => n >= 2).sort((a, b) => a - b)) {
        const profile = depths[String(depth)];
        if (!profile?.proven || profile?.latestHealthy === false) break;
        proven = depth;
    }
    return proven;
}
function finiteNonNegative(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; }
function minimumPositive(a, b) { const values = [finiteNonNegative(a), finiteNonNegative(b)].filter((n) => n > 0); return values.length ? Math.min(...values) : 0; }
