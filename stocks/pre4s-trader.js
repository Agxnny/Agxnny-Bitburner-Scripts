import { readStockHistory } from "/lib/stock-history.js";
import { rankSignals } from "/stocks/signals.js";
import { configuredCapitalLimit, defaultTraderConfig, readTraderConfig, stockTraderConfigFile } from "/lib/stock-trader-config.js";
import { completeTraderAction, readTraderAction, writeTraderAction } from "/lib/stock-trader-actions.js";
import { readTraderPerformance, recordClosedTrade, traderPerformanceSummary } from "/lib/stock-trade-performance.js";
import { performanceCohorts, suggestedRisk } from "/lib/stock-performance-analysis.js";
import { readPositionState, writePositionState, syncPositionState, positionTelemetry } from "/lib/stock-position-state.js";
import { entryQualified, exitDecision, policyThresholds, updatePersistence } from "/lib/stock-trader-policy.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const STATE_FILE = "/data/pre4s-trader-state.txt";
const POLL_MS = 50;
const COMMISSION = 100_000;
const REENTRY_COOLDOWN_MS = 60_000;
const DEFAULT_CAPITAL_FRACTION = 0.15;
const MAX_LONG_SYMBOL_FRACTION = 0.04;
const MAX_SHORT_SYMBOL_FRACTION = 0.015;
const MIN_TRADE_VALUE = 5_000_000;

/** Adaptive pre-4S trader with persistent entries and profit-aware exits. @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const quiet = isQuiet(ns);
    const args = positionalArgs(ns);
    const cliFraction = clamp(Number(args[0] ?? DEFAULT_CAPITAL_FRACTION), 0, 0.30);

    if (ns.getHostname() !== "home") return ns.tprint("ERROR: Run stocks/pre4s-trader.js from home.");
    if (!safe(() => ns.stock.hasTixApiAccess(), false)) return ns.tprint("ERROR: TIX API required.");

    const symbols = safe(() => ns.stock.getSymbols(), []);
    const cooldowns = new Map();
    let fingerprint = "";
    let lastStateAt = 0;
    let persistence = {};
    let positionState = readPositionState(ns);

    if (!quiet) ns.tprint("[PRE4S] V7 · persistent entries · adaptive stops · trailing profits · evidence-scaled risk");

    while (true) {
        const manualClosed = await processManualClose(ns, symbols, cooldowns);
        const nextFingerprint = priceFingerprint(ns, symbols);
        const changed = nextFingerprint !== fingerprint;
        if (changed) fingerprint = nextFingerprint;

        if (manualClosed || changed || Date.now() - lastStateAt >= 1_000) {
            const result = await evaluate(ns, symbols, cliFraction, changed, cooldowns, persistence, positionState);
            persistence = result.persistence;
            positionState = result.positionState;
            lastStateAt = Date.now();
        }
        await ns.sleep(POLL_MS);
    }
}

async function evaluate(ns, symbols, cliFraction, marketChanged, cooldowns, persistence, positionState) {
    pruneCooldowns(cooldowns);
    const history = readStockHistory(ns);
    const ranked = rankSignals(history, symbols);
    const positions = symbols.map((symbol) => position(ns, symbol));
    const cash = ns.getServerMoneyAvailable("home");
    const exposureBefore = currentExposure(ns, symbols);
    const equity = cash + exposureBefore.total;
    const config = activeConfig(ns, cliFraction);
    const performanceState = readTraderPerformance(ns);
    const risk = suggestedRisk(performanceState);
    const configuredLimit = configuredCapitalLimit(config, cash, exposureBefore.total);
    const capitalLimit = configuredLimit * risk.multiplier;

    persistence = updatePersistence(persistence, ranked, marketChanged);
    positionState = syncPositionState(positionState, positions, ranked);
    await writePositionState(ns, positionState);

    let realized = 0;
    let trades = 0;

    for (const signal of ranked) {
        const p = positions.find((row) => row.symbol === signal.symbol);
        if (!p) continue;
        const side = p.longShares > 0 ? "LONG" : p.shortShares > 0 ? "SHORT" : "";
        if (!side) continue;

        const telemetry = positionTelemetry(positionState, p.symbol);
        const decision = exitDecision(side, signal, telemetry, config.stopLossPercent);
        if (!decision) continue;

        const shares = side === "LONG" ? p.longShares : p.shortShares;
        const entryPrice = side === "LONG" ? p.longAverage : p.shortAverage;
        const exitPrice = side === "LONG"
            ? safe(() => ns.stock.sellStock(p.symbol, shares), 0)
            : safe(() => ns.stock.sellShort(p.symbol, shares), 0);
        if (!(exitPrice > 0)) continue;

        const pnl = side === "LONG"
            ? (exitPrice - entryPrice) * shares - COMMISSION
            : (entryPrice - exitPrice) * shares - COMMISSION;

        realized += pnl;
        trades += 1;
        cooldowns.set(p.symbol, Date.now() + REENTRY_COOLDOWN_MS);
        await recordClosedTrade(ns, {
            symbol: p.symbol,
            side,
            shares,
            entryPrice,
            exitPrice,
            pnl,
            reason: decision.reason,
            at: Date.now(),
            entryScore: telemetry?.entryScore,
            entryConfidence: telemetry?.entryConfidence,
            peakProfit: telemetry?.peakProfit,
            worstProfit: telemetry?.worstProfit,
            heldMs: Date.now() - Number(telemetry?.openedAt ?? Date.now()),
        });
    }

    if (marketChanged) {
        const live = currentExposure(ns, symbols);
        let totalRemaining = Math.max(0, capitalLimit - live.total);
        let cashRemaining = Math.max(0, ns.getServerMoneyAvailable("home") - config.cashFloor);
        let shortRemaining = Math.max(0, equity * config.shortCapitalPercent / 100 * risk.multiplier - live.short);

        for (const signal of ranked) {
            if (totalRemaining <= MIN_TRADE_VALUE || cashRemaining <= MIN_TRADE_VALUE) break;
            if ((cooldowns.get(signal.symbol) ?? 0) > Date.now()) continue;

            const p = position(ns, signal.symbol);
            if (p.longShares > 0 || p.shortShares > 0) continue;

            const isLong = entryQualified(signal, persistence, "LONG");
            const isShort = config.allowShort
                && entryQualified(signal, persistence, "SHORT")
                && shortRemaining >= MIN_TRADE_VALUE;
            if (!isLong && !isShort) continue;

            const price = isLong
                ? safe(() => ns.stock.getAskPrice(signal.symbol), 0)
                : safe(() => ns.stock.getBidPrice(signal.symbol), 0);
            if (!(price > 0)) continue;

            const symbolFraction = isLong ? MAX_LONG_SYMBOL_FRACTION : MAX_SHORT_SYMBOL_FRACTION;
            const allocation = Math.min(
                totalRemaining,
                cashRemaining,
                equity * symbolFraction * risk.multiplier,
                isShort ? shortRemaining : Infinity,
            );
            const shares = Math.min(
                safe(() => ns.stock.getMaxShares(signal.symbol), 0),
                Math.floor(Math.max(0, allocation - COMMISSION) / price),
            );
            if (shares <= 0 || shares * price < MIN_TRADE_VALUE) continue;

            const fill = isLong
                ? safe(() => ns.stock.buyStock(signal.symbol, shares), 0)
                : safe(() => ns.stock.buyShort(signal.symbol, shares), 0);
            if (fill > 0) {
                const spent = shares * fill + COMMISSION;
                totalRemaining -= spent;
                cashRemaining -= spent;
                if (isShort) shortRemaining -= spent;
                trades += 1;
            }
        }
    }

    const live = currentExposure(ns, symbols);
    const freshPerformance = readTraderPerformance(ns);
    const performance = {
        ...traderPerformanceSummary(freshPerformance),
        cohorts: performanceCohorts(freshPerformance),
        risk,
    };

    await ns.write(STATE_FILE, JSON.stringify({
        model: "PRE4S_TRADER_V7_ADAPTIVE",
        status: "LIVE",
        marketChanged,
        allowShort: config.allowShort,
        capitalMode: config.mode,
        capitalPercent: config.percent,
        capitalAmount: config.amount,
        configuredCapitalLimit: configuredLimit,
        capitalLimit,
        risk,
        shortCapitalPercent: config.shortCapitalPercent,
        shortCapitalLimit: equity * config.shortCapitalPercent / 100 * risk.multiplier,
        stopLossPercent: config.stopLossPercent,
        cashFloor: config.cashFloor,
        cash: ns.getServerMoneyAvailable("home"),
        equity,
        exposure: live.total,
        longExposure: live.long,
        shortExposure: live.short,
        realizedThisCycle: realized,
        tradesThisCycle: trades,
        performance,
        thresholds: policyThresholds(),
        signals: ranked,
        topSignals: ranked.slice(0, 8),
        updatedAt: Date.now(),
    }), "w");

    return { persistence, positionState };
}

async function processManualClose(ns, symbols, cooldowns) {
    const action = readTraderAction(ns);
    if (!action || action.status !== "PENDING" || action.type !== "CLOSE_POSITION") return false;
    const symbol = String(action.symbol ?? "");
    const side = String(action.side ?? "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";

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
        await writeTraderAction(ns, completeTraderAction(action, "FAILED", `Manual close failed on ${symbol}`));
        return false;
    }

    const pnl = side === "SHORT"
        ? (entryPrice - exitPrice) * shares - COMMISSION
        : (exitPrice - entryPrice) * shares - COMMISSION;
    await recordClosedTrade(ns, { symbol, side, shares, entryPrice, exitPrice, pnl, reason: "MANUAL_EXIT", at: Date.now() });
    cooldowns.set(symbol, Date.now() + REENTRY_COOLDOWN_MS);
    await writeTraderAction(ns, completeTraderAction(action, "COMPLETE", `Closed ${side.toLowerCase()} ${symbol}`, { pnl }));
    return true;
}

function currentExposure(ns, symbols) {
    let long = 0, short = 0;
    for (const symbol of symbols) {
        const p = position(ns, symbol);
        long += p.longShares * p.price;
        short += p.shortShares * p.price;
    }
    return { long, short, total: long + short };
}

function pruneCooldowns(cooldowns) {
    const now = Date.now();
    for (const [symbol, until] of cooldowns.entries()) if (until <= now) cooldowns.delete(symbol);
}

function priceFingerprint(ns, symbols) {
    return symbols.map((symbol) => `${symbol}:${safe(() => ns.stock.getPrice(symbol), 0)}`).join("|");
}

function activeConfig(ns, cliFraction) {
    return ns.fileExists(stockTraderConfigFile(), "home")
        ? readTraderConfig(ns)
        : { ...defaultTraderConfig(), percent: cliFraction * 100 };
}

function position(ns, symbol) {
    const raw = safe(() => ns.stock.getPosition(symbol), [0, 0, 0, 0]);
    return {
        symbol,
        price: safe(() => ns.stock.getPrice(symbol), 0),
        longShares: Number(raw[0] || 0),
        longAverage: Number(raw[1] || 0),
        shortShares: Number(raw[2] || 0),
        shortAverage: Number(raw[3] || 0),
    };
}

function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }
function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || 0)); }
