import { analyzeNetwork, getAvailablePortOpeners } from "/lib/network.js";
import { isControllerStateStale, readControllerState } from "/lib/runtime-state.js";

/**
 * Lightweight diagnostic dashboard for the early project stages.
 *
 * Read-only: this script does not root servers, launch workers, or alter targets.
 * It continuously validates the network/capability layer and displays the latest
 * controller state published through the shared runtime-state channel.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");

    ns.ui.openTail();
    ns.ui.setTailTitle("Bitburner Control - Diagnostics");
    ns.ui.resizeTail(760, 760);

    while (true) {
        render(ns);
        await ns.sleep(1000);
    }
}

/** @param {NS} ns */
function render(ns) {
    const servers = analyzeNetwork(ns);
    const tools = getAvailablePortOpeners(ns);
    const controller = readControllerState(ns);
    const controllerStale = isControllerStateStale(controller);

    const rooted = servers.filter((s) => s.hasRoot);
    const rootable = servers.filter((s) => !s.hasRoot && s.canRootNow);
    const hackableMoney = servers.filter((s) => s.canHackNow && s.target.hasMoney);
    const blockedMoney = servers.filter((s) => !s.canBecomeHackableNow && s.target.hasMoney);

    const homeMaxRam = ns.getServerMaxRam("home");
    const homeUsedRam = ns.getServerUsedRam("home");
    const homeFreeRam = Math.max(0, homeMaxRam - homeUsedRam);

    const requiredFiles = [
        "gitpull.js",
        "hacking/controller.js",
        "hacking/workers/hack.js",
        "hacking/workers/grow.js",
        "hacking/workers/weaken.js",
        "lib/network.js",
        "lib/runtime-state.js",
        "lib/state.js",
        "network/inspect.js",
        "network/root.js",
        "diagnostics/dashboard.js",
    ];

    const missingFiles = requiredFiles.filter((file) => !ns.fileExists(file, "home"));
    const workerRam = {
        hack: safeScriptRam(ns, "hacking/workers/hack.js"),
        grow: safeScriptRam(ns, "hacking/workers/grow.js"),
        weaken: safeScriptRam(ns, "hacking/workers/weaken.js"),
    };

    const topTargets = [...hackableMoney]
        .sort((a, b) => b.target.maxMoney - a.target.maxMoney)
        .slice(0, 8);

    ns.clearLog();
    ns.print("┌──────────────────── BITBURNER DIAGNOSTICS ────────────────────┐");
    ns.print(`│ Status       ${missingFiles.length === 0 ? "OK" : "FILES MISSING"}`);
    ns.print(`│ Hack level   ${String(ns.getHackingLevel()).padEnd(8)} Home RAM ${formatRam(homeUsedRam)} / ${formatRam(homeMaxRam)}`);
    ns.print(`│ Free RAM     ${formatRam(homeFreeRam).padEnd(10)} Port tools ${tools.length}/5`);
    ns.print("├──────────────────────── CONTROLLER ────────────────────────────┤");
    renderController(ns, controller, controllerStale);
    ns.print("├──────────────────────── NETWORK ───────────────────────────────┤");
    ns.print(`│ Discovered   ${servers.length}`);
    ns.print(`│ Rooted       ${rooted.length}`);
    ns.print(`│ Rootable now ${rootable.length}`);
    ns.print(`│ HGW targets  ${hackableMoney.length}`);
    ns.print(`│ Blocked $$$  ${blockedMoney.length}`);
    ns.print("├──────────────────────── WORKERS ───────────────────────────────┤");
    ns.print(`│ hack.js      ${formatRam(workerRam.hack)}`);
    ns.print(`│ grow.js      ${formatRam(workerRam.grow)}`);
    ns.print(`│ weaken.js    ${formatRam(workerRam.weaken)}`);
    ns.print("├────────────────────── AVAILABLE TOOLS ─────────────────────────┤");
    ns.print(`│ ${tools.length > 0 ? tools.map((tool) => tool.file).join(", ") : "None"}`);

    if (missingFiles.length > 0) {
        ns.print("├────────────────────── MISSING FILES ───────────────────────────┤");
        for (const file of missingFiles) ns.print(`│ ! ${file}`);
    }

    ns.print("├──────────────────── TOP HGW-READY TARGETS ─────────────────────┤");
    if (topTargets.length === 0) {
        ns.print("│ No rooted money targets meet the current hacking level.");
    } else {
        for (const server of topTargets) {
            const host = server.hostname.padEnd(20);
            const money = ns.format.number(server.target.maxMoney, 2).padStart(10);
            const req = String(server.hacking.requiredLevel).padStart(4);
            ns.print(`│ ${host} $${money}  req ${req}`);
        }
    }

    ns.print("├────────────────────── QUICK CHECKS ────────────────────────────┤");
    ns.print(`│ Files      ${missingFiles.length === 0 ? "PASS" : "FAIL"}`);
    ns.print(`│ Discovery  ${servers.length > 0 ? "PASS" : "FAIL"}`);
    ns.print(`│ Workers    ${Object.values(workerRam).every((ram) => ram > 0) ? "PASS" : "FAIL"}`);
    ns.print(`│ Controller ${controller && !controllerStale ? "PASS" : "WAIT"}`);
    ns.print("└────────────────────────────────────────────────────────────────┘");
}

/** @param {NS} ns @param {object|null} controller @param {boolean} stale */
function renderController(ns, controller, stale) {
    if (!controller) {
        ns.print("│ State        WAITING - run hacking/controller.js <target>");
        return;
    }

    const ageMs = Math.max(0, Date.now() - Number(controller.updatedAt ?? 0));
    const ageSeconds = (ageMs / 1000).toFixed(1);
    const moneyCurrent = Number(controller.money?.current ?? 0);
    const moneyMax = Number(controller.money?.max ?? 0);
    const moneyPercent = moneyMax > 0 ? (moneyCurrent / moneyMax) * 100 : 0;
    const securityCurrent = Number(controller.security?.current ?? 0);
    const securityMin = Number(controller.security?.minimum ?? 0);
    const securityDelta = securityCurrent - securityMin;

    ns.print(`│ State        ${stale ? "STALE" : "LIVE"} (${ageSeconds}s old)`);
    ns.print(`│ Target       ${String(controller.hostname ?? "unknown")}`);
    ns.print(`│ Phase        ${String(controller.phase ?? "unknown")}`);
    ns.print(`│ Action       ${String(controller.action ?? "unknown")}`);
    ns.print(`│ Money        ${formatMoney(moneyCurrent)} / ${formatMoney(moneyMax)} (${moneyPercent.toFixed(1)}%)`);
    ns.print(`│ Security     ${securityCurrent.toFixed(2)} / ${securityMin.toFixed(2)} (+${securityDelta.toFixed(2)})`);
    ns.print(`│ Reason       ${String(controller.reason ?? "")}`);
}

/** @param {NS} ns @param {string} file */
function safeScriptRam(ns, file) {
    if (!ns.fileExists(file, "home")) return 0;
    return ns.getScriptRam(file, "home");
}

function formatRam(gb) {
    return `${Number(gb).toFixed(2)} GB`;
}

function formatMoney(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "$0";

    if (Math.abs(number) >= 1e9) return `$${(number / 1e9).toFixed(2)}b`;
    if (Math.abs(number) >= 1e6) return `$${(number / 1e6).toFixed(2)}m`;
    if (Math.abs(number) >= 1e3) return `$${(number / 1e3).toFixed(2)}k`;
    return `$${number.toFixed(0)}`;
}
