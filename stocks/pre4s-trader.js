import { readStockHistory } from "/lib/stock-history.js";
import { rankSignals } from "/stocks/signals.js";
import { configuredCapitalLimit, defaultTraderConfig, readTraderConfig, stockTraderConfigFile } from "/lib/stock-trader-config.js";
import { completeTraderAction, readTraderAction, writeTraderAction } from "/lib/stock-trader-actions.js";
import { readTraderPerformance, recordClosedTrade, traderPerformanceSummary } from "/lib/stock-trade-performance.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const STATE_FILE = "/data/pre4s-trader-state.txt";
const POLL_MS = 50, COMMISSION = 100_000, MANUAL_REENTRY_COOLDOWN_MS = 60_000;
const LONG_ENTER = 0.62, SHORT_ENTER = -0.72, EXIT_SCORE = 0.22;
const LONG_CONFIDENCE = 0.60, SHORT_CONFIDENCE = 0.72;
const DEFAULT_CAPITAL_FRACTION = 0.15, MAX_LONG_SYMBOL_FRACTION = 0.04, MAX_SHORT_SYMBOL_FRACTION = 0.015;
const MIN_TRADE_VALUE = 5_000_000;

/** Pre-4S price-inference trader with conservative shorts, durable P&L and manual position closes. @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const quiet = isQuiet(ns), args = positionalArgs(ns);
    const cliFraction = clamp(Number(args[0] ?? DEFAULT_CAPITAL_FRACTION), 0, 0.30);
    if (ns.getHostname() !== "home") return ns.tprint("ERROR: Run stocks/pre4s-trader.js from home.");
    if (!safe(() => ns.stock.hasTixApiAccess(), false)) return ns.tprint("ERROR: TIX API required.");
    const symbols = safe(() => ns.stock.getSymbols(), []);
    const manualCooldowns = new Map();
    let fingerprint = "", lastStateAt = 0;
    if (!quiet) ns.tprint("[PRE4S] LIVE · 50ms change detector · conservative shorts · durable P&L · manual closes enabled");

    while (true) {
        const manualClosed = await processManualClose(ns, symbols, manualCooldowns);
        const nextFingerprint = priceFingerprint(ns, symbols);
        const changed = nextFingerprint !== fingerprint;
        if (changed) fingerprint = nextFingerprint;
        if (manualClosed || changed || Date.now() - lastStateAt >= 1_000) {
            await evaluate(ns, symbols, cliFraction, changed, manualCooldowns);
            lastStateAt = Date.now();
        }
        await ns.sleep(POLL_MS);
    }
}

async function processManualClose(ns, symbols, manualCooldowns) {
    const action = readTraderAction(ns);
    if (!action || action.status !== "PENDING" || action.type !== "CLOSE_POSITION") return false;
    const symbol = String(action.symbol ?? ""), side = String(action.side ?? "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
    if (!symbols.includes(symbol)) {
        await writeTraderAction(ns, completeTraderAction(action, "FAILED", `${symbol || "Target"} is not a stock symbol`));
        return false;
    }
    const p = position(ns, symbol);
    const shares = side === "SHORT" ? p.shortShares : p.longShares;
    const entryPrice = side === "SHORT" ? p.shortAverage : p.longAverage;
    if (!(shares > 0)) {
        await writeTraderAction(ns, completeTraderAction(action, "NO_POSITION", `No ${side.toLowerCase()} position is open on ${symbol}`));
        return false;
    }
    const exitPrice = side === "SHORT"
        ? safe(() => ns.stock.sellShort(symbol, shares), 0)
        : safe(() => ns.stock.sellStock(symbol, shares), 0);
    if (!(exitPrice > 0)) {
        await writeTraderAction(ns, completeTraderAction(action, "FAILED", `Manual ${side.toLowerCase()} close failed on ${symbol}`));
        return false;
    }
    const pnl = side === "SHORT" ? (entryPrice - exitPrice) * shares - COMMISSION : (exitPrice - entryPrice) * shares - COMMISSION;
    await recordClosedTrade(ns, { symbol, side, shares, entryPrice, exitPrice, pnl, reason: "MANUAL_EXIT", at: Date.now() });
    manualCooldowns.set(symbol, Date.now() + MANUAL_REENTRY_COOLDOWN_MS);
    await writeTraderAction(ns, completeTraderAction(action, "COMPLETE", `Closed ${side.toLowerCase()} ${symbol}`, { symbol, side, shares, entryPrice, exitPrice, pnl }));
    return true;
}

async function evaluate(ns, symbols, cliFraction, marketChanged, manualCooldowns) {
    pruneCooldowns(manualCooldowns);
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
            if (sale > 0) {
                const pnl = (sale - p.longAverage) * p.longShares - COMMISSION;
                realized += pnl; trades++; if (stop) stopLossExits++;
                await recordClosedTrade(ns, { symbol: p.symbol, side: "LONG", shares: p.longShares, entryPrice: p.longAverage, exitPrice: sale, pnl, reason: stop || "SIGNAL_EXIT", at: Date.now() });
            }
        } else if (p.shortShares > 0 && (stop || signal.score > -EXIT_SCORE)) {
            const cover = safe(() => ns.stock.sellShort(p.symbol, p.shortShares), 0);
            if (cover > 0) {
                const pnl = (p.shortAverage - cover) * p.shortShares - COMMISSION;
                realized += pnl; trades++; if (stop) stopLossExits++;
                await recordClosedTrade(ns, { symbol: p.symbol, side: "SHORT", shares: p.shortShares, entryPrice: p.shortAverage, exitPrice: cover, pnl, reason: stop || "SIGNAL_EXIT", at: Date.now() });
            }
        }
    }

    if (marketChanged) {
        const liveExposure = currentExposure(ns, symbols), totalRemaining = Math.max(0, capitalLimit - liveExposure.total);
        let cashRemaining = Math.max(0, ns.getServerMoneyAvailable("home") - config.cashFloor);
        let shortRemaining = Math.max(0, equity * config.shortCapitalPercent / 100 - liveExposure.short);
        for (const signal of ranked) {
            if (totalRemaining <= MIN_TRADE_VALUE || cashRemaining <= MIN_TRADE_VALUE) break;
            if ((manualCooldowns.get(signal.symbol) ?? 0) > Date.now()) continue;
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
            if (fill > 0) {
                const spent = shares * fill + COMMISSION;
                cashRemaining -= spent;
                if (isShort) shortRemaining -= spent;
                trades++;
            }
        }
    }

    const live = currentExposure(ns, symbols);
    const performance = traderPerformanceSummary(readTraderPerformance(ns));
    const manualAction = readTraderAction(ns);
    await ns.write(STATE_FILE, JSON.stringify({
        model: "PRE4S_TRADER_V6_MANUAL_CLOSE", status: "LIVE", marketChanged,
        allowShort: config.allowShort, capitalMode: config.mode, capitalPercent: config.percent, capitalAmount: config.amount,
        capitalLimit, shortCapitalPercent: config.shortCapitalPercent, shortCapitalLimit: equity * config.shortCapitalPercent / 100,
        stopLossPercent: config.stopLossPercent, cashFloor: config.cashFloor, cash: ns.getServerMoneyAvailable("home"), equity,
        exposure: live.total, longExposure: live.long, shortExposure: live.short,
        realizedThisCycle: realized, tradesThisCycle: trades, stopLossExitsThisCycle: stopLossExits,
        performance, manualAction,
        thresholds: { longEnter: LONG_ENTER, shortEnter: SHORT_ENTER, longConfidence: LONG_CONFIDENCE, shortConfidence: SHORT_CONFIDENCE },
        topSignals: ranked.slice(0, 8), updatedAt: Date.now(),
    }), "w");
}

function currentExposure(ns, symbols) {
    let long = 0, short = 0;
    for (const symbol of symbols) { const p = position(ns, symbol); long += p.longShares * p.price; short += p.shortShares * p.price; }
    return { long, short, total: long + short };
}
function pruneCooldowns(cooldowns) { const now = Date.now(); for (const [symbol, until] of cooldowns.entries()) if (until <= now) cooldowns.delete(symbol); }
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
