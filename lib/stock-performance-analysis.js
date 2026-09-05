export function performanceCohorts(state) {
    const trades = Array.isArray(state?.trades) ? state.trades : [];
    const reasons = [...new Set(trades.map((trade) => String(trade.reason ?? "UNKNOWN")))];
    return {
        bySide: {
            LONG: cohort(trades.filter((trade) => trade.side === "LONG")),
            SHORT: cohort(trades.filter((trade) => trade.side === "SHORT")),
        },
        byReason: Object.fromEntries(reasons.map((reason) => [reason, cohort(trades.filter((trade) => trade.reason === reason))])),
    };
}

export function suggestedRisk(state) {
    const stats = cohort(Array.isArray(state?.trades) ? state.trades : []);
    if (stats.trades < 20) return { grade: "LEARNING", multiplier: 0.50, reason: `${stats.trades}/20 closes` };
    if (stats.profitFactor >= 1.25 && stats.expectancy > 0) {
        return { grade: stats.trades >= 40 ? "PROVEN" : "PROMISING", multiplier: stats.trades >= 40 ? 1.0 : 0.75, reason: `PF ${format(stats.profitFactor)}` };
    }
    if (stats.profitFactor < 0.80 || stats.expectancy < 0) return { grade: "REDUCE", multiplier: 0.35, reason: `PF ${format(stats.profitFactor)}` };
    return { grade: "CAUTION", multiplier: 0.50, reason: `PF ${format(stats.profitFactor)}` };
}

function cohort(trades) {
    let grossProfit = 0, grossLoss = 0, wins = 0, pnl = 0;
    for (const trade of trades) {
        const value = Number(trade.pnl ?? 0);
        pnl += value;
        if (value > 0) { wins += 1; grossProfit += value; }
        else grossLoss += Math.max(0, -value);
    }
    return {
        trades: trades.length,
        wins,
        winRate: trades.length ? wins / trades.length : 0,
        pnl,
        expectancy: trades.length ? pnl / trades.length : 0,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    };
}

function format(value) { return Number.isFinite(value) ? value.toFixed(2) : "∞"; }
