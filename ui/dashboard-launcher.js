const MAIN_GUI = "/ui/dashboard.js";
const STOCK_GUI = "/stocks/dashboard.js";
const RETRY_MS = 250;
const MAX_ATTEMPTS = 20;

/**
 * Low-RAM deferred dashboard launcher.
 * Lets startup.js release its own RAM before retrying GUI admission.
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    if (ns.getHostname() !== "home") return;

    await ns.sleep(RETRY_MS);
    await ensureRunning(ns, MAIN_GUI, "main GUI");
    await ensureRunning(ns, STOCK_GUI, "stock Market Lab");
}

async function ensureRunning(ns, script, label) {
    if (ns.isRunning(script, "home")) return true;
    if (!ns.fileExists(script, "home")) {
        ns.tprint(`WARNING: ${label} unavailable: ${script} is missing on home.`);
        return false;
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const pid = ns.run(script, 1);
        if (pid > 0) return true;
        if (attempt < MAX_ATTEMPTS) await ns.sleep(RETRY_MS);
    }

    const required = safeScriptRam(ns, script);
    const maxRam = ns.getServerMaxRam("home");
    const usedRam = ns.getServerUsedRam("home");
    const freeRam = Math.max(0, maxRam - usedRam);
    ns.tprint(`WARNING: Could not start ${label} after ${MAX_ATTEMPTS} attempts · need ${required.toFixed(2)} GB · free ${freeRam.toFixed(2)} / ${maxRam.toFixed(2)} GB on home.`);
    return false;
}

function safeScriptRam(ns, script) {
    try { return Number(ns.getScriptRam(script, "home")) || 0; }
    catch { return 0; }
}
