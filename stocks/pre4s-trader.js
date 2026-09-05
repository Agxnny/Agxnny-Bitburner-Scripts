import { readStockHistory } from "/lib/stock-history.js";
import { rankSignals } from "/stocks/signals.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const STATE_FILE = "/data/pre4s-trader-state.txt";
const LOOP_MS = 6_000, COMMISSION = 100_000;
const ENTER_SCORE = 0.62, EXIT_SCORE = 0.22;
const DEFAULT_CAPITAL_FRACTION = 0.15, MAX_SYMBOL_FRACTION = 0.04;
const MIN_TRADE_VALUE = 5_000_000, CASH_FLOOR = 100_000_000;

/** Conservative price-inference trader for use before 4S. Longs only by default; pass --short to permit shorts. @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const quiet = isQuiet(ns), args = positionalArgs(ns), allowShort = ns.args.map(String).includes("--short");
    const capitalFraction = clamp(Number(args[0] ?? DEFAULT_CAPITAL_FRACTION), 0.02, 0.30);
    if (ns.getHostname() !== "home") return ns.tprint("ERROR: Run stocks/pre4s-trader.js from home.");
    if (!safe(() => ns.stock.hasTixApiAccess(), false)) return ns.tprint("ERROR: TIX API required.");
    if (!quiet) ns.tprint(`[PRE4S] LIVE · capital ${(capitalFraction * 100).toFixed(0)}% · per-symbol ${(MAX_SYMBOL_FRACTION * 100).toFixed(0)}% · shorts ${allowShort ? "ON" : "OFF"}`);
    while (true) {
        const history = readStockHistory(ns), symbols = safe(() => ns.stock.getSymbols(), []), ranked = rankSignals(history, symbols);
        const cash = ns.getServerMoneyAvailable("home"), positions = symbols.map((s) => position(ns, s));
        const exposure = positions.reduce((sum, p) => sum + p.longShares * p.price + p.shortShares * p.price, 0);
        const equity = cash + exposure, budget = Math.max(0, equity * capitalFraction - exposure);
        let realized = 0, trades = 0;
        for (const signal of ranked) {
            const p = positions.find((x) => x.symbol === signal.symbol); if (!p) continue;
            if (p.longShares > 0 && signal.score < EXIT_SCORE) { const sale = safe(() => ns.stock.sellStock(p.symbol, p.longShares), 0); if (sale > 0) { realized += (sale - p.longAverage) * p.longShares - COMMISSION; trades += 1; } }
            if (p.shortShares > 0 && signal.score > -EXIT_SCORE) { const cover = safe(() => ns.stock.sellShort(p.symbol, p.shortShares), 0); if (cover > 0) { realized += (p.shortAverage - cover) * p.shortShares - COMMISSION; trades += 1; } }
        }
        let remaining = Math.min(budget, Math.max(0, ns.getServerMoneyAvailable("home") - CASH_FLOOR));
        for (const signal of ranked) {
            if (remaining < MIN_TRADE_VALUE || Math.abs(signal.score) < ENTER_SCORE || signal.confidence < 0.60) continue;
            const p = position(ns, signal.symbol); if (p.longShares > 0 || p.shortShares > 0) continue;
            const price = signal.score > 0 ? safe(() => ns.stock.getAskPrice(signal.symbol), 0) : safe(() => ns.stock.getBidPrice(signal.symbol), 0);
            if (!(price > 0)) continue;
            const allocation = Math.min(remaining, equity * MAX_SYMBOL_FRACTION);
            const shares = Math.min(safe(() => ns.stock.getMaxShares(signal.symbol), 0), Math.floor(Math.max(0, allocation - COMMISSION) / price));
            if (shares <= 0 || shares * price < MIN_TRADE_VALUE) continue;
            const fill = signal.score > 0 ? safe(() => ns.stock.buyStock(signal.symbol, shares), 0) : allowShort ? safe(() => ns.stock.buyShort(signal.symbol, shares), 0) : 0;
            if (fill > 0) { remaining -= shares * fill + COMMISSION; trades += 1; }
        }
        await ns.write(STATE_FILE, JSON.stringify({ model: "PRE4S_TRADER_V1", status: "LIVE", capitalFraction, allowShort, cash: ns.getServerMoneyAvailable("home"), equity, exposure, realizedThisCycle: realized, tradesThisCycle: trades, topSignals: ranked.slice(0, 8), updatedAt: Date.now() }), "w");
        await ns.sleep(LOOP_MS);
    }
}
function position(ns, symbol) { const raw = safe(() => ns.stock.getPosition(symbol), [0,0,0,0]); return { symbol, price: safe(() => ns.stock.getPrice(symbol), 0), longShares: Number(raw[0]||0), longAverage: Number(raw[1]||0), shortShares: Number(raw[2]||0), shortAverage: Number(raw[3]||0) }; }
function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }
function clamp(v, min, max) { return Math.min(max, Math.max(min, Number(v) || min)); }
