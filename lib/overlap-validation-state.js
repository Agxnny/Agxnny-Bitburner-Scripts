const STATE_FILE = "/data/multi-overlap-validation-state.txt";
const MODEL = "MULTI_OVERLAP_VALIDATION_STATE_V1";

export function emptyOverlapValidationState() {
    return { version: 1, model: MODEL, status: "IDLE", updatedAt: 0 };
}

/** @param {NS} ns */
export function readOverlapValidationState(ns) {
    if (!ns.fileExists(STATE_FILE, "home")) return emptyOverlapValidationState();
    try {
        const parsed = JSON.parse(String(ns.read(STATE_FILE)));
        return parsed?.model === MODEL ? { ...emptyOverlapValidationState(), ...parsed } : emptyOverlapValidationState();
    } catch { return emptyOverlapValidationState(); }
}

/** @param {NS} ns */
export async function publishOverlapValidationState(ns, patch) {
    const next = { ...readOverlapValidationState(ns), ...patch, version: 1, model: MODEL, updatedAt: Date.now() };
    await ns.write(STATE_FILE, JSON.stringify(next), "w");
    return next;
}

export function overlapValidationStateFile() { return STATE_FILE; }
