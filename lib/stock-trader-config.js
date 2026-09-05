const CONFIG_FILE = "/data/pre4s-trader-config.txt";
const MODEL = "PRE4S_TRADER_CONFIG_V1";

export function defaultTraderConfig() {
    return {
        version: 1,
        model: MODEL,
        mode: "PERCENT",
        percent: 15,
        amount: 1_000_000_000,
        cashFloor: 100_000_000,
        updatedAt: 0,
    };
}

/** @param {NS} ns */
export function readTraderConfig(ns) {
    if (!ns.fileExists(CONFIG_FILE, "home")) return defaultTraderConfig();
    try {
        const parsed = JSON.parse(String(ns.read(CONFIG_FILE) || "null"));
        return normalizeTraderConfig(parsed);
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
        ...base,
        ...config,
        version: 1,
        model: MODEL,
        mode,
        percent: clamp(Number(config?.percent ?? base.percent), 0, 30),
        amount: Math.max(0, Number(config?.amount ?? base.amount) || 0),
        cashFloor: Math.max(0, Number(config?.cashFloor ?? base.cashFloor) || 0),
    };
}

export function configuredCapitalLimit(config, cash, exposure) {
    const normalized = normalizeTraderConfig(config);
    if (normalized.mode === "AMOUNT") return Math.max(0, normalized.amount);
    const playerCash = Math.max(0, Number(cash) || 0);
    const currentExposure = Math.max(0, Number(exposure) || 0);
    const preTradeCash = playerCash + currentExposure;
    return preTradeCash * normalized.percent / 100;
}

export function stockTraderConfigFile() { return CONFIG_FILE; }
