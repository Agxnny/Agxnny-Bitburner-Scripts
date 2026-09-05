const STATE_FILE = "/data/pre4s-position-state.txt";
const MODEL = "PRE4S_POSITION_STATE_V1";

export function readPositionState(ns) {
    if (!ns.fileExists(STATE_FILE, "home")) return empty();
    try {
        const parsed = JSON.parse(String(ns.read(STATE_FILE) || "null"));
        return parsed?.model === MODEL ? { ...empty(), ...parsed, positions: parsed.positions ?? {} } : empty();
    } catch {
        return empty();
    }
}

export async function writePositionState(ns, state) {
    await ns.write(STATE_FILE, JSON.stringify({ ...state, version: 1, model: MODEL, updatedAt: Date.now() }), "w");
}

export function syncPositionState(state, positions, signals, now = Date.now()) {
    const next = { ...(state?.positions ?? {}) };
    const signalMap = new Map((signals ?? []).map((signal) => [signal.symbol, signal]));

    for (const position of positions) {
        const side = position.longShares > 0 ? "LONG" : position.shortShares > 0 ? "SHORT" : "";
        if (!side) {
            delete next[position.symbol];
            continue;
        }

        const entryPrice = side === "LONG" ? position.longAverage : position.shortAverage;
        const price = position.price;
        const profit = side === "LONG" ? price / entryPrice - 1 : entryPrice / price - 1;
        const prior = next[position.symbol];
        const signal = signalMap.get(position.symbol);

        next[position.symbol] = prior && prior.side === side
            ? {
                ...prior,
                lastPrice: price,
                lastProfit: profit,
                peakProfit: Math.max(Number(prior.peakProfit ?? profit), profit),
                worstProfit: Math.min(Number(prior.worstProfit ?? profit), profit),
                updatedAt: now,
            }
            : {
                symbol: position.symbol,
                side,
                openedAt: now,
                entryPrice,
                entryScore: Number(signal?.score ?? 0),
                entryConfidence: Number(signal?.confidence ?? 0),
                lastPrice: price,
                lastProfit: profit,
                peakProfit: profit,
                worstProfit: profit,
                updatedAt: now,
            };
    }

    return { ...empty(), ...state, positions: next, updatedAt: now };
}

export function positionTelemetry(state, symbol) {
    return state?.positions?.[symbol] ?? null;
}

export function stockPositionStateFile() { return STATE_FILE; }

function empty() {
    return { version: 1, model: MODEL, positions: {}, updatedAt: 0 };
}
