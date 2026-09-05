const AUTO_TARGET_CANDLES = 70;
const GAP_FACTOR = 2.25;

/** Filter a stock series to a wall-clock lookback. rangeMs <= 0 means all retained history. */
export function filterSeriesByRange(series, rangeMs = 0) {
    const points = validPoints(series);
    const range = Math.max(0, Number(rangeMs) || 0);
    if (!range || points.length < 2) return points;
    const cutoff = Number(points.at(-1).at) - range;
    return points.filter((point) => Number(point.at) >= cutoff);
}

/** Build wall-clock aligned OHLC candles without bridging recorder gaps. */
export function buildCandles(series, intervalMs = 0, expectedIntervalMs = 6000) {
    const points = validPoints(series);
    if (!points.length) return { candles: [], intervalMs: 0 };

    const expected = Math.max(1, Number(expectedIntervalMs) || 6000);
    const span = Math.max(expected, Number(points.at(-1).at) - Number(points[0].at));
    const interval = Math.max(expected, Number(intervalMs) > 0 ? Number(intervalMs) : niceInterval(span / AUTO_TARGET_CANDLES, expected));
    const gapThreshold = expected * GAP_FACTOR;
    const candles = [];
    let current = null;
    let previous = null;

    for (const point of points) {
        const gapBefore = previous && Number(point.at) - Number(previous.at) > gapThreshold;
        const bucketAt = Math.floor(Number(point.at) / interval) * interval;
        if (!current || gapBefore || current.bucketAt !== bucketAt) {
            if (current) candles.push(current);
            current = makeCandle(point, bucketAt, Boolean(gapBefore));
        } else {
            updateCandle(current, point);
        }
        previous = point;
    }
    if (current) candles.push(current);
    return { candles, intervalMs: interval };
}

function makeCandle(point, bucketAt, gapBefore) {
    const price = Number(point.price);
    return {
        bucketAt,
        at: Number(point.at),
        endAt: Number(point.at),
        open: price,
        high: price,
        low: price,
        close: price,
        samples: 1,
        gapBefore,
    };
}

function updateCandle(candle, point) {
    const price = Number(point.price);
    candle.endAt = Number(point.at);
    candle.high = Math.max(candle.high, price);
    candle.low = Math.min(candle.low, price);
    candle.close = price;
    candle.samples += 1;
}

function validPoints(series) {
    return Array.isArray(series)
        ? series.filter((point) => Number.isFinite(Number(point?.price)) && Number(point.price) > 0 && Number.isFinite(Number(point?.at)))
        : [];
}

function niceInterval(raw, floor) {
    const choices = [1000, 5000, 10000, 30000, 60000, 300000, 900000, 1800000, 3600000, 14400000, 86400000];
    const minimum = Math.max(Number(floor) || 1, Number(raw) || 1);
    return choices.find((value) => value >= minimum) ?? Math.ceil(minimum / 86400000) * 86400000;
}
