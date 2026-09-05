const DEFAULT_MAX_CANDLES = 60;
const MIN_SAMPLES_PER_CANDLE = 5;
const GAP_FACTOR = 2.25;

/** Build sampled OHLC candles from recorded price points without bridging recorder gaps. */
export function buildCandles(series, maxCandles = DEFAULT_MAX_CANDLES, expectedIntervalMs = 6000) {
    const points = Array.isArray(series)
        ? series.filter((point) => Number.isFinite(Number(point?.price)) && Number(point.price) > 0 && Number.isFinite(Number(point?.at)))
        : [];
    if (points.length === 0) return { candles: [], bucketSize: 0, intervalMs: 0 };

    const target = Math.max(1, Math.floor(maxCandles));
    const bucketSize = Math.max(MIN_SAMPLES_PER_CANDLE, Math.ceil(points.length / target));
    const gapThreshold = Math.max(1, Number(expectedIntervalMs) || 6000) * GAP_FACTOR;
    const candles = [];
    let bucket = [];
    let gapBefore = false;

    const flush = () => {
        if (!bucket.length) return;
        const prices = bucket.map((point) => Number(point.price));
        candles.push({
            at: Number(bucket[0].at),
            endAt: Number(bucket.at(-1).at),
            open: prices[0],
            high: Math.max(...prices),
            low: Math.min(...prices),
            close: prices.at(-1),
            samples: bucket.length,
            gapBefore,
        });
        bucket = [];
        gapBefore = false;
    };

    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        const prior = points[i - 1];
        const isGap = prior && Number(point.at) - Number(prior.at) > gapThreshold;
        if (isGap || bucket.length >= bucketSize) flush();
        if (isGap) gapBefore = true;
        bucket.push(point);
    }
    flush();

    const baseInterval = median(points.slice(1).map((point, index) => Number(point.at) - Number(points[index].at)).filter((delta) => delta > 0 && delta <= gapThreshold));
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
