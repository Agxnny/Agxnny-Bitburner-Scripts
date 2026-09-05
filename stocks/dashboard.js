import { readStockHistory, readStockMarketState, stockSeries, stockSeriesStats } from "/lib/stock-history.js";
import { stockStyles as s } from "/stocks/styles.js";

const KEEPER = "/stocks/history-keeper.js";
const REFRESH_MS = 1000;
const FOUR_S_GOAL = 25e9;
let cache = { history: null, market: null, keeperRunning: false, updatedAt: 0 };
let version = 0;

/** Separate read-only React dashboard for stock history and portfolio. @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    if (ns.getHostname() !== "home") return;
    if (!ns.scriptRunning(KEEPER, "home")) ns.run(KEEPER, 1, "--quiet");
    ns.ui.openTail();
    ns.ui.setTailTitle("Agxnny Stocks · Market Lab");
    ns.ui.resizeTail(1120, 760);
    refresh(ns);
    ns.clearLog();
    ns.printRaw(el(App));
    while (true) {
        refresh(ns);
        await ns.sleep(REFRESH_MS);
    }
}

function refresh(ns) {
    cache = {
        history: readStockHistory(ns),
        market: readStockMarketState(ns),
        keeperRunning: ns.scriptRunning(KEEPER, "home"),
        updatedAt: Date.now(),
    };
    version += 1;
}

function App() {
    const [, rerender] = React.useState(version);
    React.useEffect(() => {
        const id = setInterval(() => rerender((old) => old === version ? old : version), 250);
        return () => clearInterval(id);
    }, []);
    const market = cache.market ?? {};
    const symbols = Array.isArray(market.symbols) ? market.symbols : [];
    const [selected, setSelected] = React.useState(symbols[0]?.symbol ?? "");
    const active = symbols.some((row) => row.symbol === selected) ? selected : symbols[0]?.symbol ?? "";
    return el("div", { style: s.app },
        header(market),
        hero(market),
        el("div", { style: s.grid }, chartCard(active, symbols, setSelected), portfolioCard(market)),
        marketTable(symbols, active, setSelected),
        el("div", { style: s.footer },
            el("span", null, "MARKET LAB · observation only · no trading"),
            el("span", null, `History ${sampleAge(cache.history?.updatedAt)} · ${Number(cache.history?.timestamps?.length ?? 0)} samples`),
        ),
    );
}

function header(market) {
    const access = market.access ?? {};
    return el("div", { style: s.header },
        el("div", null,
            el("div", { style: s.eyebrow }, "AGXNNY STOCK RESEARCH"),
            el("div", { style: s.title }, "Market Lab"),
            el("div", { style: s.subtitle }, "Persistent price history · volatility baseline · portfolio observability"),
        ),
        el("div", { style: s.badges },
            badge(cache.keeperRunning ? "RECORDER ONLINE" : "RECORDER OFFLINE", cache.keeperRunning ? "good" : "warn"),
            badge(access.tix ? "TIX API" : "NO TIX", access.tix ? "accent" : "warn"),
            badge(access.fourSApi ? "4S API" : "PRE-4S", access.fourSApi ? "good" : "warn"),
            badge("TRADING OFF", "accent"),
        ),
    );
}

function hero(market) {
    const p = market.portfolio ?? {};
    const pnl = portfolioPnl(market.positions ?? []);
    const cash = Number(market.cash ?? 0);
    return el("div", { style: s.heroGrid },
        metric("Cash", money(cash)),
        metric("4S API goal", `${pct(Math.min(1, cash / FOUR_S_GOAL))}`),
        metric("Long value", money(p.longValue)),
        metric("Short value", money(p.shortValue)),
        metric("Unrealized P&L", signedMoney(pnl.total)),
    );
}

function chartCard(symbol, symbols, setSelected) {
    const series = symbol ? stockSeries(cache.history, symbol) : [];
    const stats = symbol ? stockSeriesStats(cache.history, symbol) : {};
    const current = symbols.find((row) => row.symbol === symbol);
    return el("div", { style: s.card },
        el("div", { style: s.titleRow },
            el("span", { style: s.cardTitle }, "Price history"),
            el("select", { value: symbol, onChange: (event) => setSelected(event.target.value), style: s.select },
                ...symbols.map((row) => el("option", { key: row.symbol, value: row.symbol }, row.symbol)),
            ),
        ),
        priceChart(series, symbol, current?.price),
        el("div", { style: s.stats },
            stat("Samples", Number(stats.samples ?? 0)),
            stat("Window change", signedPct(stats.change)),
            stat("Tick volatility", pct(stats.tickVolatility)),
            stat("Range", stats.min > 0 ? `${money(stats.min)} – ${money(stats.max)}` : "—"),
        ),
        el("div", { style: s.note }, "Volatility is currently the standard deviation of recorded tick-to-tick returns. The collector stores roughly three hours at the default 6-second cadence."),
    );
}

function priceChart(series, symbol, currentPrice) {
    if (series.length < 2) return el("div", { style: s.chartWrap }, el("div", { style: s.chartLabel }, `${symbol || "—"} · collecting baseline…`));
    const prices = series.map((point) => point.price).filter((value) => value > 0);
    const min = Math.min(...prices), max = Math.max(...prices), range = Math.max(1e-9, max - min);
    const width = 1000, height = 280, pad = 18;
    const points = series.map((point, index) => {
        const x = pad + (index / Math.max(1, series.length - 1)) * (width - pad * 2);
        const y = height - pad - ((point.price - min) / range) * (height - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const mid = height / 2;
    return el("div", { style: s.chartWrap },
        el("div", { style: s.chartLabel }, `${symbol} · ${duration(series.at(-1).at - series[0].at)} window`),
        el("div", { style: s.chartLast }, money(currentPrice ?? series.at(-1).price)),
        el("svg", { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", style: s.svg },
            el("line", { x1: pad, y1: mid, x2: width - pad, y2: mid, stroke: "#1e2a34", strokeWidth: 1 }),
            el("polyline", { points, fill: "none", stroke: "#6eb6e5", strokeWidth: 2, vectorEffect: "non-scaling-stroke" }),
        ),
    );
}

function portfolioCard(market) {
    const rows = Array.isArray(market.positions) ? market.positions : [];
    const pnl = portfolioPnl(rows);
    return el("div", { style: s.card },
        el("div", { style: s.titleRow }, el("span", { style: s.cardTitle }, "Portfolio"), badge(rows.length ? `${rows.length} OPEN` : "FLAT", rows.length ? "accent" : "good")),
        rows.length ? el("div", { style: s.table },
            el("div", { style: { ...s.row, ...s.rowHead } }, el("span", null, "Symbol"), el("span", { style: s.right }, "Side"), el("span", { style: s.right }, "Shares"), el("span", { style: s.right }, "Value"), el("span", { style: s.right }, "P&L")),
            ...rows.map((row) => portfolioRow(row)),
        ) : el("div", { style: s.note }, "No stock positions are open. This dashboard is observation-only and will not place trades."),
        el("div", { style: s.stats },
            stat("Long P&L", signedMoney(pnl.long)),
            stat("Short P&L", signedMoney(pnl.short)),
            stat("Gross exposure", money(market.portfolio?.grossExposure)),
            stat("Open positions", rows.length),
        ),
    );
}

function portfolioRow(row) {
    const long = Number(row.longShares ?? 0) > 0;
    const shares = long ? Number(row.longShares) : Number(row.shortShares ?? 0);
    const average = long ? Number(row.longAverage ?? 0) : Number(row.shortAverage ?? 0);
    const price = Number(row.price ?? 0);
    const value = shares * price;
    const pnl = long ? (price - average) * shares : (average - price) * shares;
    return el("div", { key: `${row.symbol}-${long ? "L" : "S"}`, style: s.row },
        el("span", { style: s.symbol }, row.symbol),
        el("span", { style: s.right }, long ? "LONG" : "SHORT"),
        el("span", { style: s.right }, integer(shares)),
        el("span", { style: s.right }, money(value)),
        el("span", { style: pnl >= 0 ? s.goodText : s.badText }, signedMoney(pnl)),
    );
}

function marketTable(symbols, active, setSelected) {
    return el("div", { style: { ...s.card, marginTop: "7px" } },
        el("div", { style: s.titleRow }, el("span", { style: s.cardTitle }, "Market watch"), el("span", { style: s.dim }, `${symbols.length} symbols`)),
        el("div", { style: s.table },
            el("div", { style: { ...s.row, ...s.rowHead } }, el("span", null, "Symbol"), el("span", { style: s.right }, "Price"), el("span", { style: s.right }, "Window"), el("span", { style: s.right }, "Volatility"), el("span", { style: s.right }, "Samples")),
            ...symbols.map((row) => {
                const stats = stockSeriesStats(cache.history, row.symbol);
                return el("button", { key: row.symbol, onClick: () => setSelected(row.symbol), style: { ...s.row, width: "100%", borderTop: 0, borderLeft: 0, borderRight: 0, background: row.symbol === active ? "#101d28" : "transparent", fontFamily: "monospace", cursor: "pointer", color: "inherit", textAlign: "left" } },
                    el("span", { style: s.symbol }, row.symbol),
                    el("span", { style: s.right }, money(row.price)),
                    el("span", { style: Number(stats.change ?? 0) >= 0 ? s.goodText : s.badText }, signedPct(stats.change)),
                    el("span", { style: s.right }, pct(stats.tickVolatility)),
                    el("span", { style: s.right }, Number(stats.samples ?? 0)),
                );
            }),
        ),
    );
}

function portfolioPnl(rows) {
    let long = 0, short = 0;
    for (const row of rows) {
        long += (Number(row.price ?? 0) - Number(row.longAverage ?? 0)) * Number(row.longShares ?? 0);
        short += (Number(row.shortAverage ?? 0) - Number(row.price ?? 0)) * Number(row.shortShares ?? 0);
    }
    return { long, short, total: long + short };
}
function metric(label, value) { return el("div", { style: s.hero }, el("div", { style: s.heroLabel }, label), el("div", { style: s.heroValue }, value)); }
function stat(label, value) { return el("div", { style: s.stat }, el("div", { style: s.statLabel }, label), el("div", { style: s.statValue }, String(value))); }
function badge(text, tone) { return el("span", { style: { ...s.badge, ...(s[tone] ?? {}) } }, text); }
function el(type, props, ...children) { return React.createElement(type, props, ...children); }
function money(value) { const n = Number(value) || 0; if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}t`; if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}b`; if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}m`; if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(2)}k`; return `$${n.toFixed(2)}`; }
function signedMoney(value) { const n = Number(value) || 0; return `${n >= 0 ? "+" : "-"}${money(Math.abs(n))}`; }
function pct(value) { return `${((Number(value) || 0) * 100).toFixed(2)}%`; }
function signedPct(value) { const n = Number(value) || 0; return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`; }
function integer(value) { return Math.floor(Number(value) || 0).toLocaleString(); }
function sampleAge(at) { const sec = Math.max(0, Math.floor((Date.now() - Number(at ?? 0)) / 1000)); return at ? `${sec}s ago` : "never"; }
function duration(ms) { const sec = Math.max(0, Math.floor(Number(ms) / 1000)); if (sec < 60) return `${sec}s`; if (sec < 3600) return `${Math.floor(sec / 60)}m`; return `${(sec / 3600).toFixed(1)}h`; }
