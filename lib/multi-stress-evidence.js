const EVIDENCE_FILE = "/data/multi-stress-evidence.txt";
const MODEL = "MULTI_STRESS_EVIDENCE_V1";

export function emptyStressEvidence() {
    return {
        version: 1,
        model: MODEL,
        provenDepth: 1,
        highestAttemptedDepth: 1,
        cleanWaves: 0,
        failedDepth: 0,
        maxObservedDriftMs: 0,
        minObservedSpacingMs: 0,
        uniqueTargets: [],
        updatedAt: 0,
    };
}

/** @param {NS} ns */
export function readStressEvidence(ns) {
    if (!ns.fileExists(EVIDENCE_FILE, "home")) return emptyStressEvidence();
    try {
        const parsed = JSON.parse(String(ns.read(EVIDENCE_FILE)));
        if (parsed?.model !== MODEL) return emptyStressEvidence();
        return { ...emptyStressEvidence(), ...parsed };
    } catch {
        return emptyStressEvidence();
    }
}

/** Merge a completed stress snapshot into durable evidence. BLOCKED/ABORTED runs never reduce proof. @param {NS} ns */
export async function recordStressEvidence(ns, stress) {
    const current = readStressEvidence(ns);
    const status = String(stress?.status ?? "");
    const highestCleanDepth = Math.max(1, Number(stress?.highestCleanDepth ?? 1));
    const currentDepth = Math.max(1, Number(stress?.currentDepth ?? 1));
    const failedDepth = ["FAILED", "SAFETY_STOP"].includes(status) ? currentDepth : 0;
    const targets = new Set([...(current.uniqueTargets ?? []), ...(stress?.uniqueTargets ?? [])].map(String));
    const spacings = [Number(current.minObservedSpacingMs ?? 0), Number(stress?.minObservedSpacingMs ?? 0)].filter((v) => v > 0);
    const next = {
        ...current,
        provenDepth: Math.max(Number(current.provenDepth ?? 1), highestCleanDepth),
        highestAttemptedDepth: Math.max(Number(current.highestAttemptedDepth ?? 1), currentDepth),
        cleanWaves: Number(current.cleanWaves ?? 0) + Number(stress?.totalCleanWaves ?? 0),
        failedDepth: failedDepth || Number(current.failedDepth ?? 0),
        maxObservedDriftMs: Math.max(Number(current.maxObservedDriftMs ?? 0), Number(stress?.maxObservedDriftMs ?? 0)),
        minObservedSpacingMs: spacings.length ? Math.min(...spacings) : 0,
        uniqueTargets: [...targets].sort(),
        lastStatus: status,
        lastReason: String(stress?.reason ?? ""),
        updatedAt: Date.now(),
    };
    await ns.write(EVIDENCE_FILE, JSON.stringify(next), "w");
    return next;
}

export function stressEvidenceFile() { return EVIDENCE_FILE; }
