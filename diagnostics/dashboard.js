import { analyzeNetwork, getAvailablePortOpeners } from "/lib/network.js";
import {
    isControllerStateStale,
    readControllerState,
    readPlannerState,
    readTacticalPlanState,
} from "/lib/runtime-state.js";
import { readTelemetryState } from "/lib/telemetry.js";
import { buildProgressionAdvice, GoalType } from "/lib/progression.js";

/**
 * Optional diagnostic dashboard.
 *
 * This remains read-only. Target rankings are consumed from the planner's cached
 * snapshot instead of recomputed here, reducing duplicate analysis work.
 *
 * The dashboard intentionally does not mirror every standalone diagnostic. It
 * only carries compact live checks for subsystems where continuous visibility is
 * useful while developing the automation.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");

    ns.ui.openTail();
    ns.ui.setTailTitle("Bitburner Control - Diagnostics");
    ns.ui.resizeTail(860, 970);

    while (true) {
        render(ns);
        await ns.sleep(1000);
    }
}

/** @param {NS} ns */
function render(ns) {
    const servers = analyzeNetwork(ns);
    const tools = getAvailablePortOpeners(ns);
    const planner = readPlannerState(ns);
    const tactical = readTacticalPlanState(ns);
    const rankedTargets = Array.isArray(planner?.rankings) ? planner.rankings : [];
    const controller = readControllerState(ns);
    const controllerStale = isControllerStateStale(controller);
    const telemetry = readTelemetryState(ns);
    const progression = buildProgressionAdvice(ns, telemetry);

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
        "hacking/planner.js",
        "hacking/targets.js",
        "hacking/workers/hack.js",
        "hacking/workers/grow.js",
        "hacking/workers/weaken.js",
        "lib/execution.js",
        "lib/network.js",
        "lib/progression.js",
        "lib/runtime-state.js",
        "lib/state.js",
        "lib/targets.js",
        "lib/telemetry.js",
        "network/deploy.js",
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

    ns.clearLog();
    ns.print("┌──────────────────────── BITBURNER DIAGNOSTICS ────────────────────────┐");
    ns.print(`│ Status       ${missingFiles.length === 0 ? "OK" : "FILES MISSING"}`);
    ns.print(`│ Hack level   ${String(ns.getHackingLevel()).padEnd(8)} Home RAM ${formatRam(homeUsedRam)} / ${formatRam(homeMaxRam)}`);
    ns.print(`│ Free RAM     ${formatRam(homeFreeRam).padEnd(10)} Port tools ${tools.length}/5`);
    ns.print("├──────────────────────────── CONTROLLER ───────────────────────────────┤");
    renderController(ns, controller, controllerStale);
    ns.print("├───────────────────────────── NETWORK ─────────────────────────────────┤");
    ns.print(`│ Discovered   ${servers.length}`);
    ns.print(`│ Rooted       ${rooted.length}`);
    ns.print(`│ Rootable now ${rootable.length}`);
    ns.print(`│ HGW targets  ${hackableMoney.length}`);
    ns.print(`│ Blocked $$$  ${blockedMoney.length}`);
    ns.print("├───────────────────────────── WORKERS ─────────────────────────────────┤");
    ns.print(`│ hack.js      ${formatRam(workerRam.hack)}`);
    ns.print(`│ grow.js      ${formatRam(workerRam.grow)}`);
    ns.print(`│ weaken.js    ${formatRam(workerRam.weaken)}`);
    ns.print("├────────────────────────── AVAILABLE TOOLS ────────────────────────────┤");
    ns.print(`│ ${tools.length > 0 ? tools.map((tool) => tool.file).join(", ") : "None"}`);

    if (missingFiles.length > 0) {
        ns.print("├────────────────────────── MISSING FILES ──────────────────────────────┤");
        for (const file of missingFiles) ns.print(`│ ! ${file}`);
    }

    ns.print("├────────────────────────── TARGET RANKING ─────────────────────────────┤");
    renderTargetRanking(ns, rankedTargets, planner);

    ns.print("├──────────────────────── LIVE FUNCTION CHECKS ────────────────────────┤");
    renderLiveChecks(ns, { controller, controllerStale, planner, tactical, telemetry, progression });

    ns.print("├─────────────────────────── QUICK CHECKS ──────────────────────────────┤");
    ns.print(`│ Files      ${missingFiles.length === 0 ? "PASS" : "FAIL"}`);
    ns.print(`│ Discovery  ${servers.length > 0 ? "PASS" : "FAIL"}`);
    ns.print(`│ Workers    ${Object.values(workerRam).every((ram) => ram > 0) ? "PASS" : "FAIL"}`);
    ns.print(`│ Planner    ${planner?.selectedTarget ? "PASS" : "WAIT"}`);
    ns.print(`│ Controller ${controller && !controllerStale ? "PASS" : "WAIT"}`);
    ns.print("└───────────────────────────────────────────────────────────────────────┘");
}

function renderLiveChecks(ns, state) {
    const telemetryAge = state.telemetry?.updatedAt
        ? Math.max(0, Date.now() - Number(state.telemetry.updatedAt))
        : Infinity;
    const telemetryHealthy = Boolean(state.telemetry) && telemetryAge <= 5000;

    const tacticalAge = state.tactical?.updatedAt
        ? Math.max(0, Date.now() - Number(state.tactical.updatedAt))
        : Infinity;
    const tacticalHealthy = Boolean(state.tactical) && tacticalAge <= 15000;

    const advice = state.progression;
    const selected = advice?.selected;
    const home = advice?.candidates?.find((candidate) => candidate.type === GoalType.HOME_RAM);
    const cloud = advice?.candidates?.find((candidate) => candidate.type === GoalType.PURCHASED_SERVER);
    const homeCore = advice?.context?.homeCore;
    const advisorHealthy = Number(advice?.version ?? 0) >= 4
        && Boolean(selected?.id)
        && Array.isArray(advice?.candidates)
        && Boolean(home)
        && (Boolean(cloud) || Number(advice?.context?.cloud?.owned ?? 0) >= Number(advice?.context?.cloud?.serverLimit ?? Infinity));

    ns.print(`│ Controller state   ${state.controller && !state.controllerStale ? "PASS" : "WAIT"}`);
    ns.print(`│ Planner state      ${state.planner?.selectedTarget ? "PASS" : "WAIT"}`);
    ns.print(`│ Tactical state     ${tacticalHealthy ? `PASS (${formatAge(tacticalAge)})` : state.tactical ? `STALE (${formatAge(tacticalAge)})` : "WAIT"}`);
    ns.print(`│ Income telemetry   ${telemetryHealthy ? `PASS (${formatAge(telemetryAge)})` : state.telemetry ? `STALE (${formatAge(telemetryAge)})` : "WAIT"}`);
    ns.print(`│ Progression logic  ${advisorHealthy ? "PASS" : "FAIL"} | v${Number(advice?.version ?? 0)} | ${String(selected?.type ?? "none")}`);

    if (homeCore) {
        ns.print(`│ Home threshold     ${Number(advice.context.homeRam ?? 0)}GB / ${Number(homeCore.thresholdRam ?? 0)}GB | ${homeCore.belowThreshold ? "BOOSTED" : "NORMAL"}`);
    }

    if (selected) {
        ns.print(`│ Advisor selection  ${selected.title} | value ${Number(selected.valueScore ?? 0).toFixed(2)}`);
    }
}

/** @param {NS} ns @param {object|null} controller @param {boolean} stale */
function renderController(ns, controller, stale) {
    if (!controller) {
        ns.print("│ State        WAITING - run hacking/controller.js");
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
    const chance = Number(controller.analysis?.hackChance ?? 0) * 100;
    const hackTimeMs = Number(controller.analysis?.hackTimeMs ?? 0);
    const score = Number(controller.selection?.score ?? 0);
    const execution = controller.execution ?? {};

    ns.print(`│ State        ${stale ? "STALE" : "LIVE"} (${ageSeconds}s old)   Mode ${String(controller.selection?.mode ?? "?")}`);
    ns.print(`│ Target       ${String(controller.hostname ?? "unknown")}   Rank ${formatRank(controller.selection?.rank)}`);
    ns.print(`│ Phase        ${String(controller.phase ?? "unknown")}   Action ${String(controller.action ?? "unknown")}`);
    ns.print(`│ Money        ${formatMoney(moneyCurrent)} / ${formatMoney(moneyMax)} (${moneyPercent.toFixed(1)}%)`);
    ns.print(`│ Security     ${securityCurrent.toFixed(2)} / ${securityMin.toFixed(2)} (+${securityDelta.toFixed(2)})`);
    ns.print(`│ Analysis     chance ${chance.toFixed(1)}% | hack ${(hackTimeMs / 1000).toFixed(1)}s | score ${formatScore(ns, score)}`);
    ns.print(`│ RAM pool     ${Number(execution.hostCount ?? 0)} host(s) | ${formatRam(execution.usableRam ?? 0)} usable | reserve ${formatRam(execution.homeReserveGb ?? 0)}`);
    ns.print(`│ Jobs         ${Number(execution.activeJobs ?? 0)} active | ${Number(execution.activeThreads ?? 0)} thread(s)`);
    ns.print(`│ Reason       ${String(controller.reason ?? "")}`);
}

/** @param {NS} ns @param {object[]} targets @param {object|null} planner */
function renderTargetRanking(ns, targets, planner) {
    if (targets.length === 0) {
        ns.print("│ No cached planner data. Run hacking/planner.js.");
        return;
    }

    const ageSeconds = Math.max(0, (Date.now() - Number(planner?.updatedAt ?? 0)) / 1000);
    const ramHosts = Array.isArray(planner?.executionHosts) ? planner.executionHosts.length : 0;
    ns.print(`│ Cached plan  ${ageSeconds.toFixed(0)}s old | hacking level ${String(planner?.hackingLevel ?? "?")} | RAM hosts ${ramHosts}`);

    for (const target of targets.slice(0, 6)) {
        const rank = `#${target.rank}`.padEnd(4);
        const host = target.hostname.padEnd(19);
        const score = formatScore(ns, target.score).padStart(9);
        const chance = `${(target.hacking.chance * 100).toFixed(0)}%`.padStart(4);
        const time = `${(target.timing.hackMs / 1000).toFixed(1)}s`.padStart(6);
        const prep = `${(target.money.percent * 100).toFixed(0)}% $ / +${target.security.delta.toFixed(2)} sec`;
        ns.print(`│ ${rank}${host} score ${score} | ${chance} | ${time} | ${prep}`);
    }
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

function formatRank(rank) {
    const value = Number(rank);
    return value > 0 ? `#${value}` : "manual";
}

function formatAge(milliseconds) {
    if (!Number.isFinite(milliseconds)) return "unknown";
    if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
    return `${(milliseconds / 1000).toFixed(1)}s`;
}

/** @param {NS} ns @param {number} score */
function formatScore(ns, score) {
    if (!Number.isFinite(score)) return "0";
    return ns.format.number(score, 2);
}
