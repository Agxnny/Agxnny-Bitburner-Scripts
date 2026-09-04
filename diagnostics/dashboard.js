import {
    isControllerStateStale,
    readControllerState,
    readPlannerState,
    readTacticalPlanState,
} from "/lib/runtime-state.js";
import { readTelemetryState } from "/lib/telemetry.js";

const DIAGNOSTIC_TEST_REQUEST_PORT = 6;
const MANUAL_TESTS = Object.freeze([
    { id: "all", label: "Run smoke tests" },
    { id: "progression-advisor", label: "Test progression" },
]);

let manualTestStatus = "Ready";

/**
 * Lightweight read-only live dashboard plus explicit user-triggered manual test
 * requests. Expensive network/progression analysis is performed by short-lived
 * planners/tests and consumed here as cached state.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.ui.openTail();
    ns.ui.setTailTitle("Bitburner Control - Diagnostics");
    ns.ui.resizeTail(860, 960);

    while (true) {
        render(ns);
        await ns.sleep(1000);
    }
}

/** @param {NS} ns */
function render(ns) {
    const planner = readPlannerState(ns);
    const tactical = readTacticalPlanState(ns);
    const rankedTargets = Array.isArray(planner?.rankings) ? planner.rankings : [];
    const controller = readControllerState(ns);
    const controllerStale = isControllerStateStale(controller);
    const telemetry = readTelemetryState(ns);
    const network = planner?.network ?? null;
    const workerRam = planner?.workerRam ?? {};

    const homeMaxRam = ns.getServerMaxRam("home");
    const homeUsedRam = ns.getServerUsedRam("home");
    const homeFreeRam = Math.max(0, homeMaxRam - homeUsedRam);

    ns.clearLog();
    ns.print("┌──────────────────────── BITBURNER DIAGNOSTICS ────────────────────────┐");
    ns.print(`│ Planner      ${planner ? `cached ${formatAge(Math.max(0, Date.now() - Number(planner.updatedAt ?? 0)))} ago` : "WAITING"}`);
    ns.print(`│ Hack level   ${String(planner?.hackingLevel ?? "?").padEnd(8)} Home RAM ${formatRam(homeUsedRam)} / ${formatRam(homeMaxRam)}`);
    ns.print(`│ Free RAM     ${formatRam(homeFreeRam).padEnd(10)} Port tools ${Number(network?.portToolCount ?? 0)}/5`);

    ns.print("├──────────────────────────── CONTROLLER ───────────────────────────────┤");
    renderController(ns, controller, controllerStale);

    ns.print("├───────────────────────────── NETWORK ─────────────────────────────────┤");
    renderNetwork(ns, network);

    ns.print("├───────────────────────────── WORKERS ─────────────────────────────────┤");
    ns.print(`│ hack.js      ${formatRam(workerRam["/hacking/workers/hack.js"] ?? 0)}`);
    ns.print(`│ grow.js      ${formatRam(workerRam["/hacking/workers/grow.js"] ?? 0)}`);
    ns.print(`│ weaken.js    ${formatRam(workerRam["/hacking/workers/weaken.js"] ?? 0)}`);

    ns.print("├────────────────────────── AVAILABLE TOOLS ────────────────────────────┤");
    const tools = Array.isArray(network?.availableTools) ? network.availableTools : [];
    ns.print(`│ ${tools.length > 0 ? tools.join(", ") : "None / planner data unavailable"}`);

    ns.print("├────────────────────────── TARGET RANKING ─────────────────────────────┤");
    renderTargetRanking(ns, rankedTargets, planner);

    ns.print("├──────────────────────── LIVE FUNCTION CHECKS ────────────────────────┤");
    renderLiveChecks(ns, { controller, controllerStale, planner, tactical, telemetry });

    ns.print("├──────────────────────── MANUAL TEST CONTROLS ────────────────────────┤");
    renderManualTestControls(ns);

    ns.print("├─────────────────────────── QUICK CHECKS ──────────────────────────────┤");
    ns.print(`│ Planner    ${planner?.selectedTarget ? "PASS" : "WAIT"}`);
    ns.print(`│ Network    ${Number(network?.discovered ?? 0) > 0 ? "PASS" : "WAIT"}`);
    ns.print(`│ Workers    ${["/hacking/workers/hack.js", "/hacking/workers/grow.js", "/hacking/workers/weaken.js"].every((path) => Number(workerRam[path] ?? 0) > 0) ? "PASS" : "WAIT"}`);
    ns.print(`│ Controller ${controller && !controllerStale ? "PASS" : "WAIT"}`);
    ns.print("└───────────────────────────────────────────────────────────────────────┘");
}

function renderNetwork(ns, network) {
    if (!network) {
        ns.print("│ WAITING - refresh hacking/planner.js");
        return;
    }

    ns.print(`│ Discovered   ${Number(network.discovered ?? 0)}`);
    ns.print(`│ Rooted       ${Number(network.rooted ?? 0)}`);
    ns.print(`│ Rootable now ${Number(network.rootableNow ?? 0)}`);
    ns.print(`│ HGW targets  ${Number(network.hgwTargets ?? 0)}`);
    ns.print(`│ Blocked $$$  ${Number(network.blockedMoney ?? 0)}`);
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

    ns.print(`│ Controller state   ${state.controller && !state.controllerStale ? "PASS" : "WAIT"}`);
    ns.print(`│ Planner state      ${state.planner?.selectedTarget ? "PASS" : "WAIT"}`);
    ns.print(`│ Tactical state     ${tacticalHealthy ? `PASS (${formatAge(tacticalAge)})` : state.tactical ? `STALE (${formatAge(tacticalAge)})` : "WAIT"}`);
    ns.print(`│ Income telemetry   ${telemetryHealthy ? `PASS (${formatAge(telemetryAge)})` : state.telemetry ? `STALE (${formatAge(telemetryAge)})` : "WAIT"}`);
    ns.print("│ Progression logic  MANUAL - use Test progression button");
}

/** @param {NS} ns */
function renderManualTestControls(ns) {
    const children = MANUAL_TESTS.map((test) => React.createElement(
        "button",
        {
            key: test.id,
            onClick: () => queueManualTest(ns, test),
            style: {
                marginRight: "8px",
                marginBottom: "4px",
                padding: "4px 9px",
                border: "1px solid #666",
                borderRadius: "4px",
                background: "#222",
                color: "#ddd",
                cursor: "pointer",
                fontFamily: "monospace",
            },
        },
        test.label,
    ));

    children.push(React.createElement(
        "span",
        { key: "status", style: { marginLeft: "4px", fontFamily: "monospace", opacity: 0.85 } },
        ` ${manualTestStatus}`,
    ));

    ns.printRaw(React.createElement(
        "div",
        { style: { paddingLeft: "8px", minHeight: "28px" } },
        ...children,
    ));
}

/** Queue a test request; a remote launcher consumes Port 6 and runs the test. */
function queueManualTest(ns, test) {
    const request = JSON.stringify({ test: test.id, requestedAt: Date.now() });
    ns.writePort(DIAGNOSTIC_TEST_REQUEST_PORT, request);
    manualTestStatus = `${test.label} queued`;
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
