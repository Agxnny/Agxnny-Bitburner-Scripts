const HISTORY_FILE = "/data/stock-history.txt";
const SNAPSHOT_FILE = "/data/stock-market-state.txt";
const MODEL = "STOCK_HISTORY_V1_COMPACT";
const SNAPSHOT_MODEL = "STOCK_MARKET_STATE_V1";
const GAP_FACTOR = 2.25;
const MAX_GAPS = 64;

export function emptyStockHistory() {
    return { version: 1, model: MODEL, intervalMs: 6000, maxSamples: 0, retention: "ALL", timestamps: [], prices: {}, gaps: [], updatedAt: 0 };
}

/** @param {NS} ns */
export function readStockHistory(ns) {
    if (!ns.fileExists(HISTORY_FILE, "home")) return emptyStockHistory();
    try {
        const parsed = JSON.parse(String(ns.read(HISTORY_FILE)));
        return parsed?.model === MODEL
            ? { ...emptyStockHistory(), ...parsed, maxSamples: 0, retention: "ALL", prices: parsed.prices ?? {}, gaps: parsed.gaps ?? [] }
            : emptyStockHistory();
    } catch { return emptyStockHistory(); }
}

/** @param {NS} ns */
export async function writeStockHistory(ns, state) {
    await ns.write(HISTORY_FILE, JSON.stringify(state), "w");
}

export function appendStockSample(history, sample, maxSamples = 0) {
    const at = Number(sample.at ?? Date.now());
    const previousAt = Number(history?.timestamps?.at(-1) ?? 0);
    const previousPrices = latestPrices(history);
    const next = {
        ...history,
        timestamps: [...(history.timestamps ?? []), at],
        prices: { ...(history.prices ?? {}) },
        gaps: [...(history.gaps ?? [])],
    };

    const symbols = Object.keys(sample.prices ?? {});
    for (const symbol of symbols) next.prices[symbol] = [...(next.prices[symbol] ?? []), Number(sample.prices[symbol] ?? 0)];

    const expected = Math.max(1, Number(history?.intervalMs ?? 6000));
    const gapFrom = Number(sample.gapFrom ?? 0);
    const inferredFrom = sample.suppressGap ? 0 : previousAt;
    const from = gapFrom > 0 ? gapFrom : inferredFrom;
    if (from > 0 && at - from > expected * GAP_FACTOR) recordGap(next, from, at, symbols, previousPrices, sample.prices);

    const limit = Math.max(0, Math.floor(Number(maxSamples) || 0));
    const overflow = limit > 0 ? Math.max(0, next.timestamps.length - limit) : 0;
    if (overflow > 0) {
        next.timestamps = next.timestamps.slice(overflow);
        for (const symbol of Object.keys(next.prices)) next.prices[symbol] = next.prices[symbol].slice(overflow);
    }
    next.maxSamples = limit;
    next.retention = limit > 0 ? "ROLLING" : "ALL";
    next.updatedAt = at;
    return next;
}

function recordGap(next, from, to, symbols, previousPrices, currentPrices) {
    const jumps = {};
    for (const symbol of symbols) {
        const before = Number(previousPrices[symbol] ?? 0);
        const after = Number(currentPrices?.[symbol] ?? 0);
        if (before > 0 && after > 0) jumps[symbol] = after / before - 1;
    }
    next.gaps.push({ from, to, durationMs: to - from, jumps });
    next.gaps = next.gaps.slice(-MAX_GAPS);
}

export function emptyStockMarketState() {
    return { version: 1, model: SNAPSHOT_MODEL, status: "OFFLINE", symbols: [], positions: [], updatedAt: 0, heartbeatAt: 0 };
}

/** @param {NS} ns */
export function readStockMarketState(ns) {
    if (!ns.fileExists(SNAPSHOT_FILE, "home")) return emptyStockMarketState();
    try {
        const parsed = JSON.parse(String(ns.read(SNAPSHOT_FILE)));
        return parsed?.model === SNAPSHOT_MODEL ? { ...emptyStockMarketState(), ...parsed } : emptyStockMarketState();
    } catch { return emptyStockMarketState(); }
}

/** @param {NS} ns */
export async function writeStockMarketState(ns, state) {
    const now = Date.now();
    await ns.write(SNAPSHOT_FILE, JSON.stringify({ ...state, version: 1, model: SNAPSHOT_MODEL, updatedAt: now, heartbeatAt: now }), "w");
}

export function stockSeries(history, symbol) {
    const prices = history?.prices?.[symbol] ?? [];
    const timestamps = history?.timestamps ?? [];
    const count = Math.min(prices.length, timestamps.length);
    return Array.from({ length: count }, (_, index) => ({ at: Number(timestamps[index]), price: Number(prices[index]) }));
}

export function stockSeriesStats(history, symbol) {
    const series = stockSeries(history, symbol).filter((point) => point.price > 0);
    const expected = Math.max(1, Number(history?.intervalMs ?? 6000));
    if (series.length < 2) return { samples: series.length, change: 0, tickVolatility: 0, min: series[0]?.price ?? 0, max: series[0]?.price ?? 0, gapCount: 0, largestGapMs: 0 };
    const returns = [];
    let gapCount = 0, largestGapMs = 0;
    for (let i = 1; i < series.length; i += 1) {
        const elapsed = series[i].at - series[i - 1].at;
        if (elapsed > expected * GAP_FACTOR) {
            gapCount += 1;
            largestGapMs = Math.max(largestGapMs, elapsed);
            continue;
        }
        returns.push(series[i - 1].price > 0 ? series[i].price / series[i - 1].price - 1 : 0);
    }
    const mean = returns.reduce((sum, value) => sum + value, 0) / Math.max(1, returns.length);
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length);
    const values = series.map((point) => point.price);
    return { samples: series.length, change: series.at(-1).price / series[0].price - 1, tickVolatility: Math.sqrt(variance), min: Math.min(...values), max: Math.max(...values), gapCount, largestGapMs };
}

export function latestStockGap(history) {
    return Array.isArray(history?.gaps) ? history.gaps.at(-1) ?? null : null;
}

function latestPrices(history) {
    const result = {};
    for (const [symbol, values] of Object.entries(history?.prices ?? {})) result[symbol] = Number(values?.at(-1) ?? 0);
    return result;
}

export function stockHistoryFile() { return HISTORY_FILE; }
export function stockMarketStateFile() { return SNAPSHOT_FILE; }
