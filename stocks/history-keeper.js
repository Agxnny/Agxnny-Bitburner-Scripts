import { appendStockSample, emptyStockHistory, readStockHistory, readStockMarketState, writeStockHistory, writeStockMarketState } from "/lib/stock-history.js";
import { isQuiet, tprint } from "/lib/output.js";

const POLL_MS = 200;
const HEARTBEAT_MS = 1000;
const EXPECTED_MARKET_TICK_MS = 6000;
const MAX_SAMPLES = 0;

/** Persistent stock price recorder. Observation only; no trading. @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const quiet = isQuiet(ns);
    if (ns.getHostname() !== "home") {
        tprint(ns, "ERROR: Run stocks/history-keeper.js from home.");
        return;
    }

    const previousMarket = readStockMarketState(ns);
    if (!hasTix(ns)) {
        await publishUnavailable(ns, "TIX API unavailable");
        tprint(ns, "[STOCK-HISTORY] TIX API unavailable; recorder parked.");
        while (!hasTix(ns)) await ns.sleep(1000);
    }

    let history = readStockHistory(ns);
    if (history.model !== "STOCK_HISTORY_V1_COMPACT") history = emptyStockHistory();
    history.maxSamples = 0;
    history.retention = "ALL";
    history.intervalMs = Math.max(1, Number(history.intervalMs ?? EXPECTED_MARKET_TICK_MS));

    let priorFingerprint = "";
    let lastPersistAt = 0;
    let firstSample = true;
    const staleHeartbeat = Number(previousMarket?.heartbeatAt ?? previousMarket?.updatedAt ?? 0);

    if (!quiet) ns.tprint(`[STOCK-HISTORY] Polling TIX every ${POLL_MS}ms · persisting actual price updates · retention ALL`);

    while (true) {
        const startedAt = Date.now();
        if (!hasTix(ns)) {
            await publishUnavailable(ns, "TIX API unavailable");
            await ns.sleep(1000);
            continue;
        }

        const snapshot = collectSnapshot(ns);
        const fingerprint = priceFingerprint(snapshot.symbols);
        const changed = fingerprint !== priorFingerprint;
        const now = snapshot.updatedAt;

        if (changed) {
            const prices = Object.fromEntries(snapshot.symbols.map((row) => [row.symbol, row.price]));
            const gapFrom = firstSample && staleHeartbeat > 0 ? staleHeartbeat : 0;
            history = appendStockSample(history, { at: now, prices, gapFrom, suppressGap: !firstSample }, MAX_SAMPLES);
            history.intervalMs = observedInterval(history, EXPECTED_MARKET_TICK_MS);
            await writeStockHistory(ns, history);
            priorFingerprint = fingerprint;
            firstSample = false;
            await writeStockMarketState(ns, snapshot);
            lastPersistAt = now;
        } else if (now - lastPersistAt >= HEARTBEAT_MS) {
            await writeStockMarketState(ns, snapshot);
            lastPersistAt = now;
        }

        await ns.sleep(Math.max(25, POLL_MS - (Date.now() - startedAt)));
    }
}

function collectSnapshot(ns) {
    const symbols = safe(() => ns.stock.getSymbols(), []);
    const rows = symbols.map((symbol) => ({
        symbol,
        price: number(safe(() => ns.stock.getPrice(symbol), 0)),
        ask: number(safe(() => ns.stock.getAskPrice(symbol), 0)),
        bid: number(safe(() => ns.stock.getBidPrice(symbol), 0)),
        maxShares: number(safe(() => ns.stock.getMaxShares(symbol), 0)),
    }));
    const positions = symbols.map((symbol) => position(ns, symbol)).filter((row) => row.longShares > 0 || row.shortShares > 0);
    const longValue = positions.reduce((sum, row) => sum + row.longShares * row.price, 0);
    const shortValue = positions.reduce((sum, row) => sum + row.shortShares * row.price, 0);
    return {
        status: "RECORDING",
        updatedAt: Date.now(),
        access: {
            wse: Boolean(safe(() => ns.stock.hasWseAccount(), false)),
            tix: Boolean(safe(() => ns.stock.hasTixApiAccess(), false)),
            fourS: Boolean(safe(() => ns.stock.has4SData(), false)),
            fourSApi: Boolean(safe(() => ns.stock.has4SDataTixApi(), false)),
        },
        cash: number(safe(() => ns.getServerMoneyAvailable("home"), 0)),
        symbols: rows,
        positions,
        portfolio: { longValue, shortValue, grossExposure: longValue + shortValue },
    };
}

function position(ns, symbol) {
    const raw = safe(() => ns.stock.getPosition(symbol), [0, 0, 0, 0]);
    return {
        symbol,
        price: number(safe(() => ns.stock.getPrice(symbol), 0)),
        longShares: number(raw?.[0]),
        longAverage: number(raw?.[1]),
        shortShares: number(raw?.[2]),
        shortAverage: number(raw?.[3]),
    };
}

function observedInterval(history, fallback) {
    const values = history?.timestamps ?? [];
    if (values.length < 3) return Number(history?.intervalMs ?? fallback);
    const deltas = [];
    for (let i = Math.max(1, values.length - 20); i < values.length; i++) {
        const delta = Number(values[i]) - Number(values[i - 1]);
        if (delta > 500 && delta < 30000) deltas.push(delta);
    }
    if (!deltas.length) return Number(history?.intervalMs ?? fallback);
    deltas.sort((a, b) => a - b);
    return deltas[Math.floor(deltas.length / 2)];
}

function priceFingerprint(rows) {
    return rows.map((row) => `${row.symbol}:${Number(row.price).toFixed(6)}`).join("|");
}

async function publishUnavailable(ns, reason) {
    await writeStockMarketState(ns, {
        status: "WAITING",
        reason,
        access: {
            wse: Boolean(safe(() => ns.stock.hasWseAccount(), false)),
            tix: Boolean(safe(() => ns.stock.hasTixApiAccess(), false)),
            fourS: Boolean(safe(() => ns.stock.has4SData(), false)),
            fourSApi: Boolean(safe(() => ns.stock.has4SDataTixApi(), false)),
        },
        cash: ns.getServerMoneyAvailable("home"),
        symbols: [],
        positions: [],
        portfolio: { longValue: 0, shortValue: 0, grossExposure: 0 },
    });
}
function hasTix(ns) { return Boolean(safe(() => ns.stock.hasTixApiAccess(), false)); }
function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }
function number(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
