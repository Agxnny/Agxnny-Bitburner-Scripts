import { appendStockSample, emptyStockHistory, readStockHistory, writeStockHistory, writeStockMarketState } from "/lib/stock-history.js";
import { isQuiet, tprint } from "/lib/output.js";

const SAMPLE_MS = 6_000;
const MAX_SAMPLES = 1_800;

/** Persistent stock price recorder. No trading. @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const quiet = isQuiet(ns);
    if (ns.getHostname() !== "home") {
        tprint(ns, "ERROR: Run stocks/history-keeper.js from home.");
        return;
    }
    if (!hasTix(ns)) {
        await publishUnavailable(ns, "TIX API unavailable");
        tprint(ns, "[STOCK-HISTORY] TIX API unavailable; recorder parked.");
        while (!hasTix(ns)) await ns.sleep(10_000);
    }

    let history = readStockHistory(ns);
    if (history.model !== "STOCK_HISTORY_V1_COMPACT") history = emptyStockHistory();
    if (!quiet) ns.tprint(`[STOCK-HISTORY] Recording every ${SAMPLE_MS / 1000}s · rolling ${MAX_SAMPLES} samples (~${(MAX_SAMPLES * SAMPLE_MS / 3600000).toFixed(1)}h)`);

    while (true) {
        const startedAt = Date.now();
        if (!hasTix(ns)) {
            await publishUnavailable(ns, "TIX API unavailable");
            await ns.sleep(SAMPLE_MS);
            continue;
        }

        const snapshot = collectSnapshot(ns);
        history = appendStockSample(history, { at: snapshot.updatedAt, prices: Object.fromEntries(snapshot.symbols.map((row) => [row.symbol, row.price])) }, MAX_SAMPLES);
        history.intervalMs = SAMPLE_MS;
        await writeStockHistory(ns, history);
        await writeStockMarketState(ns, snapshot);

        const delay = Math.max(250, SAMPLE_MS - (Date.now() - startedAt));
        await ns.sleep(delay);
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
