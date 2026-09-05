import { stockSeries } from "/lib/stock-history.js";

const WINDOWS_MS = [5 * 60_000, 15 * 60_000, 30 * 60_000];

/** Price-only pre-4S signal. Returns score in [-1,1] plus confidence diagnostics. */
export function stockSignal(history, symbol, now = Date.now()) {
    const series = stockSeries(history, symbol).filter((p) => p.price > 0 && now - p.at <= WINDOWS_MS.at(-1));
    if (series.length < 12) return empty(symbol, series.length, "insufficient history");
    const windows = WINDOWS_MS.map((ms) => windowSignal(series, now - ms));
    const valid = windows.filter((w) => w.samples >= 4);
    if (valid.length < 2) return empty(symbol, series.length, "insufficient window coverage");
    const weighted = valid.reduce((sum, w, i) => sum + w.score * (i + 1), 0) / valid.reduce((sum, _, i) => sum + i + 1, 0);
    const agreement = Math.abs(valid.reduce((sum, w) => sum + Math.sign(w.score), 0)) / valid.length;
    const volatility = rmsReturns(series);
    const strength = clamp(Math.abs(weighted) * 5_000, 0, 1);
    const confidence = clamp(0.55 * agreement + 0.45 * strength, 0, 1);
    const score = clamp(weighted * 5_000, -1, 1) * confidence;
    return { symbol, score, confidence, direction: score > 0 ? "LONG" : score < 0 ? "SHORT" : "FLAT", samples: series.length, volatility, windows };
}

export function rankSignals(history, symbols, now = Date.now()) {
    return symbols.map((s) => stockSignal(history, s, now)).sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
}

function windowSignal(series, cutoff) {
    const points = series.filter((p) => p.at >= cutoff);
    if (points.length < 4) return { samples: points.length, momentum: 0, tickBias: 0, slope: 0, score: 0 };
    const first = points[0].price, last = points.at(-1).price;
    const momentum = first > 0 ? last / first - 1 : 0;
    let up = 0, down = 0;
    for (let i = 1; i < points.length; i += 1) { if (points[i].price > points[i - 1].price) up += 1; else if (points[i].price < points[i - 1].price) down += 1; }
    const tickBias = (up - down) / Math.max(1, up + down);
    const slope = regressionReturn(points);
    return { samples: points.length, momentum, tickBias, slope, score: momentum * 0.45 + slope * 0.35 + tickBias * 0.0002 };
}
function regressionReturn(points) {
    const base = points[0].price; if (!(base > 0)) return 0;
    const n = points.length, xs = points.map((_, i) => i), ys = points.map((p) => p.price / base - 1);
    const mx = (n - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0; for (let i = 0; i < n; i += 1) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    return den > 0 ? (num / den) * (n - 1) : 0;
}
function rmsReturns(series) { let sum = 0, n = 0; for (let i = 1; i < series.length; i += 1) { const r = series[i - 1].price > 0 ? series[i].price / series[i - 1].price - 1 : 0; sum += r * r; n += 1; } return n ? Math.sqrt(sum / n) : 0; }
function empty(symbol, samples, reason) { return { symbol, score: 0, confidence: 0, direction: "FLAT", samples, volatility: 0, windows: [], reason }; }
function clamp(v, min, max) { return Math.min(max, Math.max(min, Number(v) || 0)); }
