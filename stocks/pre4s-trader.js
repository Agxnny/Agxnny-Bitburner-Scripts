import { readStockHistory } from "/lib/stock-history.js";
import { rankSignals } from "/stocks/signals.js";
import { configuredCapitalLimit, defaultTraderConfig, readTraderConfig, stockTraderConfigFile } from "/lib/stock-trader-config.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const STATE_FILE = "/data/pre4s-trader-state.txt";
const POLL_MS = 50, COMMISSION = 100_000;
const LONG_ENTER = 0.62, SHORT_ENTER = -0.72, EXIT_SCORE = 0.22;
const LONG_CONFIDENCE = 0.60, SHORT_CONFIDENCE = 0.72;
const DEFAULT_CAPITAL_FRACTION = 0.15, MAX_LONG_SYMBOL_FRACTION = 0.04, MAX_SHORT_SYMBOL_FRACTION = 0.015;
const MIN_TRADE_VALUE = 5_000_000;

/** Pre-4S price-inference trader. Conservative shorts are enabled by config by default. @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const quiet = isQuiet(ns), args = positionalArgs(ns);
    const cliFraction = clamp(Number(args[0] ?? DEFAULT_CAPITAL_FRACTION), 0, 0.30);
    if (ns.getHostname() !== "home") return ns.tprint("ERROR: Run stocks/pre4s-trader.js from home.");
    if (!safe(() => ns.stock.hasTixApiAccess(), false)) return ns.tprint("ERROR: TIX API required.");
    const symbols = safe(() => ns.stock.getSymbols(), []);
    let fingerprint = "", lastStateAt = 0;
    if (!quiet) ns.tprint("[PRE4S] LIVE · 50ms change detector · conservative shorts available · dashboard risk controls enabled");

    while (true) {
        const nextFingerprint = priceFingerprint(ns, symbols);
        const changed = nextFingerprint !== fingerprint;
        if (changed) fingerprint = nextFingerprint;
        if (changed || Date.now() - lastStateAt >= 1_000) {
            await evaluate(ns, symbols, cliFraction, changed);
            lastStateAt = Date.now();
        }
        await ns.sleep(POLL_MS);
    }
}

async function evaluate(ns, symbols, cliFraction, marketChanged) {
    const history = readStockHistory(ns), ranked = rankSignals(history, symbols);
    const cash = ns.getServerMoneyAvailable("home"), positions = symbols.map((s) => position(ns, s));
    const longExposure = positions.reduce((sum, p) => sum + p.longShares * p.price, 0);
    const shortExposure = positions.reduce((sum, p) => sum + p.shortShares * p.price, 0);
    const exposure = longExposure + shortExposure, equity = cash + exposure;
    const config = activeConfig(ns, cliFraction), capitalLimit = configuredCapitalLimit(config, cash, exposure);
    let realized = 0, trades = 0, stopLossExits = 0;

    for (const signal of ranked) {
        const p = positions.find((x) => x.symbol === signal.symbol); if (!p) continue;
        const stop = stopLossReason(ns, p, config.stopLossPercent);
        if (p.longShares > 0 && (stop || signal.score < EXIT_SCORE)) {
            const sale = safe(() => ns.stock.sellStock(p.symbol, p.longShares), 0);
            if (sale > 0) { realized += (sale - p.longAverage) * p.longShares - COMMISSION; trades++; if (stop) stopLossExits++; }
        } else if (p.shortShares > 0 && (stop || signal.score > -EXIT_SCORE)) {
            const cover = safe(() => ns.stock.sellShort(p.symbol, p.shortShares), 0);
            if (cover > 0) { realized += (p.shortAverage - cover) * p.shortShares - COMMISSION; trades++; if (stop) stopLossExits++; }
        }
    }

    if (marketChanged) {
        const liveExposure = currentExposure(ns, symbols), totalRemaining = Math.max(0, capitalLimit - liveExposure.total);
        let cashRemaining = Math.max(0, ns.getServerMoneyAvailable("home") - config.cashFloor);
        let shortRemaining = Math.max(0, equity * config.shortCapitalPercent / 100 - liveExposure.short);
        for (const signal of ranked) {
            if (totalRemaining <= MIN_TRADE_VALUE || cashRemaining <= MIN_TRADE_VALUE) break;
            const p = position(ns, signal.symbol); if (p.longShares > 0 || p.shortShares > 0) continue;
            const isLong = signal.score >= LONG_ENTER && signal.confidence >= LONG_CONFIDENCE;
            const isShort = config.allowShort && signal.score <= SHORT_ENTER && signal.confidence >= SHORT_CONFIDENCE && shortRemaining >= MIN_TRADE_VALUE;
            if (!isLong && !isShort) continue;
            const price = isLong ? safe(() => ns.stock.getAskPrice(signal.symbol), 0) : safe(() => ns.stock.getBidPrice(signal.symbol), 0);
            if (!(price > 0)) continue;
            const symbolCap = equity * (isLong ? MAX_LONG_SYMBOL_FRACTION : MAX_SHORT_SYMBOL_FRACTION);
            const allocation = Math.min(totalRemaining, cashRemaining, symbolCap, isShort ? shortRemaining : Infinity);
            const shares = Math.min(safe(() => ns.stock.getMaxShares(signal.symbol), 0), Math.floor(Math.max(0, allocation - COMMISSION) / price));
            if (shares <= 0 || shares * price < MIN_TRADE_VALUE) continue;
            const fill = isLong ? safe(() => ns.stock.buyStock(signal.symbol, shares), 0) : safe(() => ns.stock.buyShort(signal.symbol, shares), 0);
            if (fill > 0) { const spent = shares * fill + COMMISSION; cashRemaining -= spent; if (isShort) shortRemaining -= spent; trades++; }
        }
    }

    const live = currentExposure(ns, symbols);
    await ns.write(STATE_FILE, JSON.stringify({
        model: "PRE4S_TRADER_V4_CONSERVATIVE_SHORTS", status: "LIVE", marketChanged,
        allowShort: config.allowShort, capitalMode: config.mode, capitalPercent: config.percent, capitalAmount: config.amount,
        capitalLimit, shortCapitalPercent: config.shortCapitalPercent, shortCapitalLimit: equity * config.shortCapitalPercent / 100,
        stopLossPercent: config.stopLossPercent, cashFloor: config.cashFloor, cash: ns.getServerMoneyAvailable("home"), equity,
        exposure: live.total, longExposure: live.long, shortExposure: live.short,
        realizedThisCycle: realized, tradesThisCycle: trades, stopLossExitsThisCycle: stopLossExits,
        thresholds: { longEnter: LONG_ENTER, shortEnter: SHORT_ENTER, longConfidence: LONG_CONFIDENCE, shortConfidence: SHORT_CONFIDENCE },
        topSignals: ranked.slice(0, 8), updatedAt: Date.now(),
    }), "w");
}

function currentExposure(ns, symbols) {
    let long = 0, short = 0;
    for (const symbol of symbols) { const p = position(ns, symbol); long += p.longShares * p.price; short += p.shortShares * p.price; }
    return { long, short, total: long + short };
}
function priceFingerprint(ns, symbols) { return symbols.map((s) => `${s}:${safe(() => ns.stock.getPrice(s), 0)}`).join("|"); }
function stopLossReason(ns, p, percent) {
    const loss = Math.max(0, Number(percent) || 0) / 100; if (!(loss > 0)) return "";
    if (p.longShares > 0 && p.longAverage > 0 && safe(() => ns.stock.getBidPrice(p.symbol), p.price) <= p.longAverage * (1 - loss)) return "LONG_STOP";
    if (p.shortShares > 0 && p.shortAverage > 0 && safe(() => ns.stock.getAskPrice(p.symbol), p.price) >= p.shortAverage * (1 + loss)) return "SHORT_STOP";
    return "";
}
function activeConfig(ns, cliFraction) { return ns.fileExists(stockTraderConfigFile(), "home") ? readTraderConfig(ns) : { ...defaultTraderConfig(), percent: cliFraction * 100 }; }
function position(ns, symbol) { const raw = safe(() => ns.stock.getPosition(symbol), [0,0,0,0]); return { symbol, price: safe(() => ns.stock.getPrice(symbol), 0), longShares: Number(raw[0]||0), longAverage: Number(raw[1]||0), shortShares: Number(raw[2]||0), shortAverage: Number(raw[3]||0) }; }
function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }
function clamp(v, min, max) { return Math.min(max, Math.max(min, Number(v) || 0)); }
