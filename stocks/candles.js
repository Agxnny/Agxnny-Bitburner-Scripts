const DEFAULT_MAX_CANDLES = 60;
const MIN_SAMPLES_PER_CANDLE = 5;

/** Build sampled OHLC candles from recorded price points. */
export function buildCandles(series, maxCandles = DEFAULT_MAX_CANDLES) {
    const points = Array.isArray(series)
        ? series.filter((point) => Number.isFinite(Number(point?.price)) && Number(point.price) > 0 && Number.isFinite(Number(point?.at)))
        : [];
    if (points.length === 0) return { candles: [], bucketSize: 0, intervalMs: 0 };

    const target = Math.max(1, Math.floor(maxCandles));
    const bucketSize = Math.max(MIN_SAMPLES_PER_CANDLE, Math.ceil(points.length / target));
    const candles = [];
    for (let i = 0; i < points.length; i += bucketSize) {
        const bucket = points.slice(i, i + bucketSize);
        const prices = bucket.map((point) => Number(point.price));
        candles.push({
            at: Number(bucket[0].at),
            endAt: Number(bucket.at(-1).at),
            open: prices[0],
            high: Math.max(...prices),
            low: Math.min(...prices),
            close: prices.at(-1),
            samples: bucket.length,
        });
    }

    const sampleIntervals = [];
    for (let i = 1; i < points.length; i++) {
        const delta = Number(points[i].at) - Number(points[i - 1].at);
        if (delta > 0) sampleIntervals.push(delta);
    }
    const baseInterval = median(sampleIntervals);
    return {
        candles: candles.slice(-target),
        bucketSize,
        intervalMs: baseInterval > 0 ? baseInterval * bucketSize : 0,
    };
}

function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
