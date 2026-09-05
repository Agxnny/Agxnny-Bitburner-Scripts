const CONFIG_FILE = "/data/pre4s-trader-config.txt";
const MODEL = "PRE4S_TRADER_CONFIG_V2_SHORTS";

export function defaultTraderConfig() {
    return {
        version: 2,
        model: MODEL,
        mode: "PERCENT",
        percent: 15,
        amount: 1_000_000_000,
        stopLossPercent: 5,
        cashFloor: 100_000_000,
        allowShort: true,
        shortCapitalPercent: 5,
        updatedAt: 0,
    };
}

/** @param {NS} ns */
export function readTraderConfig(ns) {
    if (!ns.fileExists(CONFIG_FILE, "home")) return defaultTraderConfig();
    try {
        return normalizeTraderConfig(JSON.parse(String(ns.read(CONFIG_FILE) || "null")));
    } catch {
        return defaultTraderConfig();
    }
}

/** @param {NS} ns */
export async function writeTraderConfig(ns, config) {
    const next = { ...normalizeTraderConfig(config), updatedAt: Date.now() };
    await ns.write(CONFIG_FILE, JSON.stringify(next), "w");
    return next;
}

export function normalizeTraderConfig(config) {
    const base = defaultTraderConfig();
    const mode = String(config?.mode ?? base.mode).toUpperCase() === "AMOUNT" ? "AMOUNT" : "PERCENT";
    return {
        ...base, ...config,
        version: 2, model: MODEL, mode,
        percent: clamp(Number(config?.percent ?? base.percent), 0, 30),
        amount: Math.max(0, Number(config?.amount ?? base.amount) || 0),
        stopLossPercent: clamp(Number(config?.stopLossPercent ?? base.stopLossPercent), 0, 50),
        cashFloor: Math.max(0, Number(config?.cashFloor ?? base.cashFloor) || 0),
        allowShort: config?.allowShort === undefined ? base.allowShort : Boolean(config.allowShort),
        shortCapitalPercent: clamp(Number(config?.shortCapitalPercent ?? base.shortCapitalPercent), 0, 10),
    };
}

export function configuredCapitalLimit(config, cash, exposure) {
    const normalized = normalizeTraderConfig(config);
    if (normalized.mode === "AMOUNT") return Math.max(0, normalized.amount);
    return (Math.max(0, Number(cash) || 0) + Math.max(0, Number(exposure) || 0)) * normalized.percent / 100;
}

export function stockTraderConfigFile() { return CONFIG_FILE; }
function clamp(v, min, max) { return Math.min(max, Math.max(min, Number(v) || 0)); }
