import { latestStockGap, readStockHistory, readStockMarketState, stockSeries, stockSeriesStats } from "/lib/stock-history.js";
import { buildCandles, filterSeriesByRange } from "/stocks/candles.js";
import { stockStyles as s } from "/stocks/styles.js";

const KEEPER = "/stocks/history-keeper.js";
const REFRESH_MS = 250;
const FOUR_S_GOAL = 25e9;
const CANDLE_FRAMES = [["1m", 60000], ["5m", 300000], ["15m", 900000], ["30m", 1800000], ["1h", 3600000], ["4h", 14400000]];
const HISTORY_RANGES = [["15m", 900000], ["1h", 3600000], ["3h", 10800000], ["6h", 21600000], ["12h", 43200000], ["24h", 86400000], ["ALL", 0]];
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
    cache = { history: readStockHistory(ns), market: readStockMarketState(ns), keeperRunning: ns.scriptRunning(KEEPER, "home"), updatedAt: Date.now() };
    version += 1;
}

function App() {
    const [, rerender] = React.useState(version);
    React.useEffect(() => {
        const id = setInterval(() => rerender((old) => old === version ? old : version), 100);
        return () => clearInterval(id);
    }, []);
    const market = cache.market ?? {};
    const symbols = Array.isArray(market.symbols) ? market.symbols : [];
    const [selected, setSelected] = React.useState(symbols[0]?.symbol ?? "");
    const [view, setView] = React.useState("candles");
    const [frame, setFrame] = React.useState(60000);
    const [range, setRange] = React.useState(0);
    const active = symbols.some((row) => row.symbol === selected) ? selected : symbols[0]?.symbol ?? "";
    return el("div", { style: s.app },
        header(market), hero(market),
        el("div", { style: s.grid }, chartCard(active, symbols, setSelected, view, setView, frame, setFrame, range, setRange), portfolioCard(market)),
        marketTable(symbols, active, setSelected),
        el("div", { style: s.footer },
            el("span", null, "MARKET LAB · observation only · no trading"),
            el("span", null, `History ${sampleAge(cache.history?.updatedAt)} · ${Number(cache.history?.timestamps?.length ?? 0)} samples · ${cache.history?.retention ?? "ALL"}`),
        ),
    );
}

function header(market) {
    const access = market.access ?? {};
    const gap = latestStockGap(cache.history);
    return el("div", { style: s.header },
        el("div", null,
            el("div", { style: s.eyebrow }, "AGXNNY STOCK RESEARCH"),
            el("div", { style: s.title }, "Market Lab"),
            el("div", { style: s.subtitle }, "Fast TIX observation · fixed OHLC timeframes · full-history line view · wall-clock continuity"),
        ),
        el("div", { style: s.badges },
            badge(cache.keeperRunning ? "RECORDER ONLINE" : "RECORDER OFFLINE", cache.keeperRunning ? "good" : "warn"),
            badge(access.tix ? "TIX API" : "NO TIX", access.tix ? "accent" : "warn"),
            badge(access.fourSApi ? "4S API" : "PRE-4S", access.fourSApi ? "good" : "warn"),
            gap ? badge(`LAST GAP ${duration(gap.durationMs)}`, "warn") : badge("CONTINUOUS", "good"),
            badge("TRADING OFF", "accent"),
        ),
    );
}

function hero(market) {
    const p = market.portfolio ?? {};
    const pnl = portfolioPnl(market.positions ?? []);
    const cash = Number(market.cash ?? 0);
    return el("div", { style: s.heroGrid },
        metric("Cash", money(cash)), metric("4S API goal", pct(Math.min(1, cash / FOUR_S_GOAL))),
        metric("Long value", money(p.longValue)), metric("Short value", money(p.shortValue)), metric("Unrealized P&L", signedMoney(pnl.total)),
    );
}

function chartCard(symbol, symbols, setSelected, view, setView, frame, setFrame, range, setRange) {
    const allSeries = symbol ? stockSeries(cache.history, symbol) : [];
    const stats = symbol ? stockSeriesStats(cache.history, symbol) : {};
    const current = symbols.find((row) => row.symbol === symbol);
    const gap = latestStockGap(cache.history);
    const jump = Number(gap?.jumps?.[symbol] ?? 0);
    return el("div", { style: s.card },
        el("div", { style: s.titleRow },
            el("div", { style: { display: "flex", gap: "5px", alignItems: "center" } },
                tabButton("CANDLES", view === "candles", () => setView("candles")),
                tabButton("HISTORY · LINE", view === "history", () => setView("history")),
            ),
            el("select", { value: symbol, onChange: (event) => setSelected(event.target.value), style: s.select },
                ...symbols.map((row) => el("option", { key: row.symbol, value: row.symbol }, row.symbol)),
            ),
        ),
        view === "candles"
            ? candlePanel(allSeries, symbol, current?.price, frame, setFrame)
            : historyPanel(allSeries, symbol, current?.price, range, setRange),
        el("div", { style: s.stats },
            stat("Samples", Number(stats.samples ?? 0)), stat("All-history change", signedPct(stats.change)),
            stat("Tick volatility", pct(stats.tickVolatility)), stat("Range", stats.min > 0 ? `${money(stats.min)} – ${money(stats.max)}` : "—"),
        ),
        continuityNote(stats, gap, jump),
    );
}

function candlePanel(series, symbol, currentPrice, frame, setFrame) {
    const expected = Number(cache.history?.intervalMs ?? 6000);
    const visibleRange = frame * 70;
    const visible = filterSeriesByRange(series, visibleRange);
    const built = buildCandles(visible, frame, expected);
    return el(React.Fragment, null,
        controlStrip(CANDLE_FRAMES, frame, setFrame),
        candleChart(built.candles, symbol, currentPrice, frame),
    );
}

function historyPanel(series, symbol, currentPrice, range, setRange) {
    const visible = filterSeriesByRange(series, range);
    return el(React.Fragment, null,
        controlStrip(HISTORY_RANGES, range, setRange),
        lineChart(visible, symbol, currentPrice, range === 0),
    );
}

function controlStrip(options, value, setter) {
    return el("div", { style: { display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "7px" } },
        ...options.map(([label, option]) => tabButton(label, value === option, () => setter(option))),
    );
}

function candleChart(candles, symbol, currentPrice, frame) {
    if (!candles.length) return emptyChart(`${symbol || "—"} · collecting ${duration(frame)} candles…`);
    const lows = candles.map((c) => c.low), highs = candles.map((c) => c.high);
    const min = Math.min(...lows), max = Math.max(...highs), priceRange = Math.max(1e-9, max - min);
    const width = 1000, height = 280, padX = 20, padY = 24;
    const slot = (width - padX * 2) / Math.max(1, candles.length);
    const bodyWidth = Math.max(2, Math.min(12, slot * 0.58));
    const y = (price) => height - padY - ((price - min) / priceRange) * (height - padY * 2);
    const elements = [];
    for (let i = 0; i < candles.length; i++) {
        const c = candles[i], x = padX + slot * i + slot / 2;
        const openY = y(c.open), closeY = y(c.close), highY = y(c.high), lowY = y(c.low);
        const direction = c.close > c.open ? 1 : c.close < c.open ? -1 : 0;
        const color = direction > 0 ? "#72d6a0" : direction < 0 ? "#ff8f8f" : "#9aa7b3";
        const fill = direction > 0 ? "#163c2a" : direction < 0 ? "#4a2020" : "#26313a";
        if (c.gapBefore) elements.push(el("line", { key: `gap-${i}`, x1: x - slot / 2, y1: padY, x2: x - slot / 2, y2: height - padY, stroke: "#d9a441", strokeWidth: 1, strokeDasharray: "4 5", opacity: 0.8 }));
        elements.push(el("line", { key: `wick-${i}`, x1: x, y1: highY, x2: x, y2: lowY, stroke: color, strokeWidth: 1.4, vectorEffect: "non-scaling-stroke" }));
        elements.push(el("rect", { key: `body-${i}`, x: x - bodyWidth / 2, y: Math.min(openY, closeY), width: bodyWidth, height: Math.max(2, Math.abs(closeY - openY)), fill, stroke: color, strokeWidth: 1.2, vectorEffect: "non-scaling-stroke" }));
    }
    return chartShell(`${symbol} · ${duration(frame)} OHLC · ${candles.length} candles`, currentPrice ?? candles.at(-1).close, min, max, elements);
}

function lineChart(series, symbol, currentPrice, allHistory) {
    if (series.length < 2) return emptyChart(`${symbol || "—"} · collecting history…`);
    const prices = series.map((point) => point.price).filter((value) => value > 0);
    const min = Math.min(...prices), max = Math.max(...prices), priceRange = Math.max(1e-9, max - min);
    const width = 1000, height = 280, padX = 20, padY = 24;
    const y = (price) => height - padY - ((price - min) / priceRange) * (height - padY * 2);
    const elements = [];
    let segment = [];
    const expected = Number(cache.history?.intervalMs ?? 6000) * 2.25;
    const flush = (key) => {
        if (segment.length > 1) elements.push(el("polyline", { key, points: segment.join(" "), fill: "none", stroke: "#6eb6e5", strokeWidth: 2, vectorEffect: "non-scaling-stroke" }));
        segment = [];
    };
    for (let i = 0; i < series.length; i++) {
        const point = series[i];
        const prior = series[i - 1];
        if (prior && point.at - prior.at > expected) {
            flush(`seg-${i}`);
            const gx = padX + (i / Math.max(1, series.length - 1)) * (width - padX * 2);
            elements.push(el("line", { key: `gap-${i}`, x1: gx, y1: padY, x2: gx, y2: height - padY, stroke: "#d9a441", strokeWidth: 1, strokeDasharray: "4 5", opacity: 0.8 }));
        }
        const x = padX + (i / Math.max(1, series.length - 1)) * (width - padX * 2);
        segment.push(`${x.toFixed(1)},${y(point.price).toFixed(1)}`);
    }
    flush("seg-final");
    return chartShell(`${symbol} · ${allHistory ? "ALL HISTORY" : duration(series.at(-1).at - series[0].at)} · line`, currentPrice ?? series.at(-1).price, min, max, elements);
}

function chartShell(label, currentPrice, min, max, elements) {
    const width = 1000, height = 280, mid = height / 2;
    return el("div", { style: s.chartWrap },
        el("div", { style: s.chartLabel }, label), el("div", { style: s.chartLast }, money(currentPrice)),
        el("svg", { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", style: s.svg },
            el("line", { x1: 20, y1: mid, x2: width - 20, y2: mid, stroke: "#1e2a34", strokeWidth: 1 }), ...elements,
        ),
        el("div", { style: { position: "absolute", right: "8px", bottom: "7px", color: "#657789", fontSize: "9px" } }, `${money(min)} – ${money(max)}`),
    );
}

function emptyChart(label) { return el("div", { style: s.chartWrap }, el("div", { style: s.chartLabel }, label)); }

function continuityNote(stats, gap, jump) {
    if (!gap) return el("div", { style: s.note }, "Wall-clock timestamps preserve continuity. Candles never bridge recorder gaps, and full-history line segments break across missing intervals.");
    return el("div", { style: { ...s.note, borderLeftColor: "#8a6728" } },
        `Recorder gap: ${duration(gap.durationMs)} from ${clock(gap.from)} to ${clock(gap.to)}. Selected-stock endpoint change: ${signedPct(jump)}. `,
        `The missing path is intentionally not reconstructed. ${Number(stats.gapCount ?? 0)} gap(s) intersect retained data.`,
    );
}

function portfolioCard(market) {
    const rows = Array.isArray(market.positions) ? market.positions : [];
    const pnl = portfolioPnl(rows);
    return el("div", { style: s.card },
        el("div", { style: s.titleRow }, el("span", { style: s.cardTitle }, "Portfolio"), badge(rows.length ? `${rows.length} OPEN` : "FLAT", rows.length ? "accent" : "good")),
        rows.length ? el("div", { style: s.table },
            el("div", { style: { ...s.row, ...s.rowHead } }, el("span", null, "Symbol"), el("span", { style: s.right }, "Side"), el("span", { style: s.right }, "Shares"), el("span", { style: s.right }, "Value"), el("span", { style: s.right }, "P&L")),
            ...rows.map(portfolioRow),
        ) : el("div", { style: s.note }, "No stock positions are open. This dashboard is observation-only and will not place trades."),
        el("div", { style: s.stats }, stat("Long P&L", signedMoney(pnl.long)), stat("Short P&L", signedMoney(pnl.short)), stat("Gross exposure", money(market.portfolio?.grossExposure)), stat("Open positions", rows.length)),
    );
}

function portfolioRow(row) {
    const long = Number(row.longShares ?? 0) > 0;
    const shares = long ? Number(row.longShares) : Number(row.shortShares ?? 0);
    const average = long ? Number(row.longAverage ?? 0) : Number(row.shortAverage ?? 0);
    const price = Number(row.price ?? 0), value = shares * price;
    const pnl = long ? (price - average) * shares : (average - price) * shares;
    return el("div", { key: `${row.symbol}-${long ? "L" : "S"}`, style: s.row },
        el("span", { style: s.symbol }, row.symbol), el("span", { style: s.right }, long ? "LONG" : "SHORT"),
        el("span", { style: s.right }, integer(shares)), el("span", { style: s.right }, money(value)),
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
                    el("span", { style: s.symbol }, row.symbol), el("span", { style: s.right }, money(row.price)),
                    el("span", { style: Number(stats.change ?? 0) >= 0 ? s.goodText : s.badText }, signedPct(stats.change)),
                    el("span", { style: s.right }, pct(stats.tickVolatility)), el("span", { style: s.right }, Number(stats.samples ?? 0)),
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
function tabButton(text, active, onClick) { return el("button", { onClick, style: { ...s.badge, ...(active ? s.accent : {}), cursor: "pointer", fontFamily: "monospace" } }, text); }
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
function duration(ms) { const sec = Math.max(0, Math.floor(Number(ms) / 1000)); if (sec < 60) return `${sec}s`; if (sec < 3600) return `${Math.floor(sec / 60)}m`; if (sec < 86400) return `${(sec / 3600).toFixed(sec < 14400 ? 1 : 0)}h`; return `${(sec / 86400).toFixed(1)}d`; }
function clock(at) { return Number(at) > 0 ? new Date(Number(at)).toLocaleTimeString() : "—"; }
