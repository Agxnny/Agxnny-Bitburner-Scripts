const PERFORMANCE_FILE = "/data/pre4s-trader-performance.txt";
const MODEL = "PRE4S_TRADER_PERFORMANCE_V1";
const MAX_TRADES = 500;

export function emptyTraderPerformance() {
    return {
        version: 1,
        model: MODEL,
        realizedPnl: 0,
        longRealizedPnl: 0,
        shortRealizedPnl: 0,
        closedTrades: 0,
        wins: 0,
        losses: 0,
        longTrades: 0,
        shortTrades: 0,
        grossProfit: 0,
        grossLoss: 0,
        peakRealizedPnl: 0,
        maxDrawdown: 0,
        trades: [],
        updatedAt: 0,
    };
}

/** @param {NS} ns */
export function readTraderPerformance(ns) {
    if (!ns.fileExists(PERFORMANCE_FILE, "home")) return emptyTraderPerformance();
    try {
        const parsed = JSON.parse(String(ns.read(PERFORMANCE_FILE) || "null"));
        return parsed?.model === MODEL ? { ...emptyTraderPerformance(), ...parsed, trades: Array.isArray(parsed.trades) ? parsed.trades : [] } : emptyTraderPerformance();
    } catch {
        return emptyTraderPerformance();
    }
}

/** @param {NS} ns */
export async function recordClosedTrade(ns, trade) {
    const state = readTraderPerformance(ns);
    const pnl = Number(trade?.pnl ?? 0);
    const side = String(trade?.side ?? "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
    const realizedPnl = Number(state.realizedPnl ?? 0) + pnl;
    const peakRealizedPnl = Math.max(Number(state.peakRealizedPnl ?? 0), realizedPnl);
    const drawdown = Math.max(0, peakRealizedPnl - realizedPnl);
    const next = {
        ...state,
        realizedPnl,
        longRealizedPnl: Number(state.longRealizedPnl ?? 0) + (side === "LONG" ? pnl : 0),
        shortRealizedPnl: Number(state.shortRealizedPnl ?? 0) + (side === "SHORT" ? pnl : 0),
        closedTrades: Number(state.closedTrades ?? 0) + 1,
        wins: Number(state.wins ?? 0) + (pnl > 0 ? 1 : 0),
        losses: Number(state.losses ?? 0) + (pnl < 0 ? 1 : 0),
        longTrades: Number(state.longTrades ?? 0) + (side === "LONG" ? 1 : 0),
        shortTrades: Number(state.shortTrades ?? 0) + (side === "SHORT" ? 1 : 0),
        grossProfit: Number(state.grossProfit ?? 0) + Math.max(0, pnl),
        grossLoss: Number(state.grossLoss ?? 0) + Math.max(0, -pnl),
        peakRealizedPnl,
        maxDrawdown: Math.max(Number(state.maxDrawdown ?? 0), drawdown),
        trades: [...(state.trades ?? []), normalizeTrade(trade, side, pnl)].slice(-MAX_TRADES),
        updatedAt: Date.now(),
    };
    await ns.write(PERFORMANCE_FILE, JSON.stringify(next), "w");
    return next;
}

export function traderPerformanceSummary(state) {
    const closedTrades = Number(state?.closedTrades ?? 0);
    const wins = Number(state?.wins ?? 0);
    const grossProfit = Number(state?.grossProfit ?? 0);
    const grossLoss = Number(state?.grossLoss ?? 0);
    return {
        realizedPnl: Number(state?.realizedPnl ?? 0),
        longRealizedPnl: Number(state?.longRealizedPnl ?? 0),
        shortRealizedPnl: Number(state?.shortRealizedPnl ?? 0),
        closedTrades,
        wins,
        losses: Number(state?.losses ?? 0),
        winRate: closedTrades > 0 ? wins / closedTrades : 0,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
        maxDrawdown: Number(state?.maxDrawdown ?? 0),
        recentTrades: (state?.trades ?? []).slice(-8).reverse(),
        updatedAt: Number(state?.updatedAt ?? 0),
    };
}

function normalizeTrade(trade, side, pnl) {
    return {
        at: Number(trade?.at ?? Date.now()),
        symbol: String(trade?.symbol ?? ""),
        side,
        shares: Math.max(0, Number(trade?.shares ?? 0)),
        entryPrice: Math.max(0, Number(trade?.entryPrice ?? 0)),
        exitPrice: Math.max(0, Number(trade?.exitPrice ?? 0)),
        pnl,
        reason: String(trade?.reason ?? "SIGNAL"),
    };
}

export function stockTraderPerformanceFile() { return PERFORMANCE_FILE; }
