const LONG_ENTER = 0.62;
const SHORT_ENTER = -0.72;
const LONG_CONFIDENCE = 0.60;
const SHORT_CONFIDENCE = 0.72;
const ENTRY_TICKS = 3;

export function updatePersistence(state, signals, marketChanged, now = Date.now()) {
    const next = { ...(state ?? {}) };
    if (!marketChanged) return next;

    for (const signal of signals ?? []) {
        const prior = next[signal.symbol] ?? { long: 0, short: 0 };
        const longQualified = signal.score >= LONG_ENTER && signal.confidence >= LONG_CONFIDENCE;
        const shortQualified = signal.score <= SHORT_ENTER && signal.confidence >= SHORT_CONFIDENCE;
        next[signal.symbol] = {
            long: longQualified ? prior.long + 1 : 0,
            short: shortQualified ? prior.short + 1 : 0,
            lastScore: Number(signal.score ?? 0),
            lastConfidence: Number(signal.confidence ?? 0),
            at: now,
        };
    }
    return next;
}

export function entryQualified(signal, persistence, side) {
    const state = persistence?.[signal.symbol] ?? {};
    if (side === "SHORT") {
        return signal.score <= SHORT_ENTER
            && signal.confidence >= SHORT_CONFIDENCE
            && Number(state.short ?? 0) >= ENTRY_TICKS;
    }
    return signal.score >= LONG_ENTER
        && signal.confidence >= LONG_CONFIDENCE
        && Number(state.long ?? 0) >= ENTRY_TICKS;
}

export function volatilityStop(signal, configuredPercent) {
    if (!(Number(configuredPercent) > 0)) return 0;
    const configured = Number(configuredPercent) / 100;
    const observed = Math.max(0, Number(signal?.volatility ?? 0)) * 18;
    return clamp(Math.max(configured, observed), 0.04, 0.10);
}

export function exitDecision(side, signal, telemetry, configuredStopPercent, now = Date.now()) {
    if (!telemetry) return null;

    const profit = Number(telemetry.lastProfit ?? 0);
    const peak = Number(telemetry.peakProfit ?? profit);
    const heldMs = Math.max(0, now - Number(telemetry.openedAt ?? now));
    const emergencyStop = volatilityStop(signal, configuredStopPercent);

    if (emergencyStop > 0 && profit <= -emergencyStop) {
        return { reason: `${side}_VOL_STOP`, emergencyStop };
    }

    // Bank meaningful winners instead of allowing them to round-trip back to flat.
    if (peak >= 0.04) {
        const trailingGiveback = peak >= 0.10 ? 0.025 : peak >= 0.07 ? 0.020 : 0.015;
        if (profit <= peak - trailingGiveback) {
            return { reason: `${side}_TRAIL`, trailingGiveback, peakProfit: peak };
        }
    }

    // Hard profit harvest: once a position is strongly profitable, take it if
    // momentum is no longer strongly supportive rather than waiting for reversal.
    if (profit >= 0.08) {
        const stillStrong = side === "LONG"
            ? signal.score >= 0.45 && signal.confidence >= 0.55
            : signal.score <= -0.50 && signal.confidence >= 0.65;
        if (!stillStrong) return { reason: `${side}_TAKE_PROFIT`, profit };
    }

    const reversed = side === "LONG" ? signal.score <= -0.18 : signal.score >= 0.18;
    const weak = side === "LONG" ? signal.score < 0.05 : signal.score > -0.05;
    if (reversed) return { reason: "SIGNAL_REVERSAL" };
    if (heldMs >= 120_000 && weak) return { reason: "STALE_SIGNAL_EXIT" };

    return null;
}

export function policyThresholds() {
    return { longEnter: LONG_ENTER, shortEnter: SHORT_ENTER, longConfidence: LONG_CONFIDENCE, shortConfidence: SHORT_CONFIDENCE, entryTicks: ENTRY_TICKS };
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
}
