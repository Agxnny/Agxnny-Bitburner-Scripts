const HISTORY_FILE = "/data/stock-history.txt";
const SNAPSHOT_FILE = "/data/stock-market-state.txt";
const MODEL = "STOCK_HISTORY_V1_COMPACT";
const SNAPSHOT_MODEL = "STOCK_MARKET_STATE_V1";

export function emptyStockHistory() {
    return { version: 1, model: MODEL, intervalMs: 6000, maxSamples: 1800, timestamps: [], prices: {}, updatedAt: 0 };
}

/** @param {NS} ns */
export function readStockHistory(ns) {
    if (!ns.fileExists(HISTORY_FILE, "home")) return emptyStockHistory();
    try {
        const parsed = JSON.parse(String(ns.read(HISTORY_FILE)));
        return parsed?.model === MODEL ? { ...emptyStockHistory(), ...parsed, prices: parsed.prices ?? {} } : emptyStockHistory();
    } catch { return emptyStockHistory(); }
}

/** @param {NS} ns */
export async function writeStockHistory(ns, state) {
    await ns.write(HISTORY_FILE, JSON.stringify(state), "w");
}

export function appendStockSample(history, sample, maxSamples = 1800) {
    const next = { ...history, timestamps: [...(history.timestamps ?? []), Number(sample.at ?? Date.now())], prices: { ...(history.prices ?? {}) } };
    const symbols = Object.keys(sample.prices ?? {});
    for (const symbol of symbols) next.prices[symbol] = [...(next.prices[symbol] ?? []), Number(sample.prices[symbol] ?? 0)];
    const overflow = Math.max(0, next.timestamps.length - maxSamples);
    if (overflow > 0) {
        next.timestamps = next.timestamps.slice(overflow);
        for (const symbol of Object.keys(next.prices)) next.prices[symbol] = next.prices[symbol].slice(overflow);
    }
    next.maxSamples = maxSamples;
    next.updatedAt = Number(sample.at ?? Date.now());
    return next;
}

export function emptyStockMarketState() {
    return { version: 1, model: SNAPSHOT_MODEL, status: "OFFLINE", symbols: [], positions: [], updatedAt: 0 };
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
    await ns.write(SNAPSHOT_FILE, JSON.stringify({ ...state, version: 1, model: SNAPSHOT_MODEL, updatedAt: Date.now() }), "w");
}

export function stockSeries(history, symbol) {
    const prices = history?.prices?.[symbol] ?? [];
    const timestamps = history?.timestamps ?? [];
    const count = Math.min(prices.length, timestamps.length);
    return Array.from({ length: count }, (_, index) => ({ at: Number(timestamps[index]), price: Number(prices[index]) }));
}

export function stockSeriesStats(history, symbol) {
    const series = stockSeries(history, symbol).filter((point) => point.price > 0);
    if (series.length < 2) return { samples: series.length, change: 0, tickVolatility: 0, min: series[0]?.price ?? 0, max: series[0]?.price ?? 0 };
    const returns = [];
    for (let i = 1; i < series.length; i += 1) returns.push(series[i - 1].price > 0 ? series[i].price / series[i - 1].price - 1 : 0);
    const mean = returns.reduce((sum, value) => sum + value, 0) / Math.max(1, returns.length);
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length);
    const values = series.map((point) => point.price);
    return {
        samples: series.length,
        change: series.at(-1).price / series[0].price - 1,
        tickVolatility: Math.sqrt(variance),
        min: Math.min(...values),
        max: Math.max(...values),
    };
}

export function stockHistoryFile() { return HISTORY_FILE; }
export function stockMarketStateFile() { return SNAPSHOT_FILE; }
