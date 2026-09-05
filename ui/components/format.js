export function compactMs(value) {
    const sec = Math.max(0, Number(value ?? 0)) / 1000;
    if (!Number.isFinite(sec)) return "—";
    if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
    const min = Math.floor(sec / 60);
    const rem = Math.floor(sec % 60);
    return min < 60 ? `${min}m ${rem}s` : `${Math.floor(min / 60)}h ${min % 60}m`;
}

export function countdownTo(timestamp) {
    const n = Number(timestamp ?? 0);
    if (!(n > 0)) return "—";
    const remaining = n - Date.now();
    return remaining >= 0 ? `${compactMs(remaining)} left` : `${compactMs(-remaining)} ago`;
}

export function duration(sec) {
    const n = Math.max(0, Number(sec ?? 0));
    if (!Number.isFinite(n)) return "∞";
    if (n < 60) return `${n.toFixed(0)}s`;
    if (n < 3600) return `${Math.floor(n / 60)}m ${Math.floor(n % 60)}s`;
    return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
}

export function age(ts) {
    const n = Number(ts ?? 0);
    if (!n) return "never";
    const sec = Math.max(0, (Date.now() - n) / 1000);
    if (sec < 60) return `${sec.toFixed(0)}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    return `${Math.floor(sec / 3600)}h ago`;
}

export function moneyFmt(v) {
    const n = Math.max(0, Number(v ?? 0));
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}t`;
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}b`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}m`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}k`;
    return `$${n.toFixed(0)}`;
}

export function ramFmt(v) { return `${Math.max(0, Number(v ?? 0)).toFixed(2)} GB`; }
export function num(v) { return Number(v ?? 0).toFixed(2); }
export function pct(v) { return `${(Math.max(0, Number(v ?? 0)) * 100).toFixed(0)}%`; }
export function pctFine(v) { const n = Number(v); return Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : "—"; }
export function msFmt(v) { const n = Number(v); return Number.isFinite(n) ? `${n.toFixed(0)} ms` : "—"; }
export function signedMs(v) { const n = Number(v); return Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(0)} ms` : "—"; }
export function signedNum(v, d = 3) { const n = Number(v); return Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(d)}` : "—"; }

export function stageShort(name) {
    return name === "WEAKEN_HACK" ? "W1"
        : name === "WEAKEN_GROW" ? "W2"
        : name === "HACK" ? "H"
        : name === "GROW" ? "G"
        : String(name ?? "?");
}

export function batchThreadsText(t) {
    return `${Number(t?.hack ?? 0)}H / ${Number(t?.weakenHack ?? 0)}W / ${Number(t?.grow ?? 0)}G / ${Number(t?.weakenGrow ?? 0)}W`;
}

export function parseMoney(value) {
    const text = String(value ?? "").trim().toLowerCase().replaceAll(",", "").replaceAll("$", "");
    const match = text.match(/^([0-9]+(?:\.[0-9]+)?)([kmbt]?)$/);
    if (!match) return NaN;
    const multiplier = match[2] === "k" ? 1e3 : match[2] === "m" ? 1e6 : match[2] === "b" ? 1e9 : match[2] === "t" ? 1e12 : 1;
    return Number(match[1]) * multiplier;
}
