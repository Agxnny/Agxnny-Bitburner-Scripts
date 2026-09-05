const ACTION_FILE = "/data/pre4s-trader-action.txt";
const MODEL = "PRE4S_TRADER_ACTION_V1";

export function createClosePositionRequest(symbol, side) {
    const normalizedSide = String(side ?? "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
    return {
        version: 1,
        model: MODEL,
        id: `close-${Date.now().toString(36)}-${String(symbol ?? "").toLowerCase()}`,
        type: "CLOSE_POSITION",
        symbol: String(symbol ?? ""),
        side: normalizedSide,
        status: "PENDING",
        requestedAt: Date.now(),
        processedAt: 0,
        reason: "",
        result: null,
    };
}

/** @param {NS} ns */
export function readTraderAction(ns) {
    if (!ns.fileExists(ACTION_FILE, "home")) return null;
    try {
        const parsed = JSON.parse(String(ns.read(ACTION_FILE) || "null"));
        return parsed?.model === MODEL ? parsed : null;
    } catch {
        return null;
    }
}

/** @param {NS} ns */
export async function writeTraderAction(ns, action) {
    await ns.write(ACTION_FILE, JSON.stringify({ ...action, version: 1, model: MODEL }), "w");
}

export function completeTraderAction(action, status, reason, result = null) {
    return { ...action, status, reason: String(reason ?? ""), result, processedAt: Date.now() };
}

export function stockTraderActionFile() { return ACTION_FILE; }
