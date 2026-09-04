import {
    isControllerStateStale,
    readCloudPurchaseState,
    readControllerState,
    readEconomyState,
    readEconomyTargetState,
    readManualMoneyGoalState,
    readPlannerState,
    readRootState,
    readTacticalPlanState,
} from "/lib/runtime-state.js";
import { readTelemetryState } from "/lib/telemetry.js";

const TEST_REQUEST_PORT = 6;
const TABS = Object.freeze(["Overview", "Targets", "Economy", "Network", "Diagnostics"]);
let activeTab = "Overview";
let actionStatus = "Ready";

/**
 * Main Bitburner control-plane GUI.
 *
 * This script intentionally consumes cached runtime state only. Expensive game
 * analysis and progression logic stay in the remote planner/services so the UI
 * remains a lightweight home process.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.ui.openTail();
    ns.ui.setTailTitle("Agxnny Control Plane");
    ns.ui.resizeTail(1050, 760);

    while (true) {
        render(ns);
        await ns.sleep(750);
    }
}

function render(ns) {
    const state = snapshot(ns);
    ns.clearLog();
    ns.printRaw(renderApp(ns, state));
}

function snapshot(ns) {
    return {
        controller: readControllerState(ns),
        planner: readPlannerState(ns),
        tactical: readTacticalPlanState(ns),
        economy: readEconomyState(ns),
        economic: readEconomyTargetState(ns),
        telemetry: readTelemetryState(ns),
        root: readRootState(ns),
        purchase: readCloudPurchaseState(ns),
        manualGoal: readManualMoneyGoalState(ns),
    };
}

function renderApp(ns, s) {
    return el("div", { style: styles.app },
        renderHeader(s),
        renderTabs(),
        el("div", { style: styles.body }, renderActiveTab(ns, s)),
    );
}

function renderHeader(s) {
    const controllerLive = s.controller && !isControllerStateStale(s.controller);
    const selected = s.economic?.selectedTarget ?? null;
    const lock = Boolean(s.manualGoal?.active);
    return el("div", { style: styles.header },
        el("div", null,
            el("div", { style: styles.title }, "AGXNNY // BITBURNER CONTROL PLANE"),
            el("div", { style: styles.subtle }, `Controller ${controllerLive ? "ONLINE" : "WAITING"}  •  Strategy ${selected ? `${selected.hostname} @ ${pct(selected.moneyTargetPercent)}` : "pending"}`),
        ),
        el("div", { style: styles.headerRight },
            badge(lock ? "SPENDING LOCKED" : "AUTO SPEND", lock ? "warn" : "ok"),
            badge(String(s.controller?.phase ?? "BOOTING"), controllerLive ? "ok" : "muted"),
        ),
    );
}

function renderTabs() {
    return el("div", { style: styles.tabs }, ...TABS.map((tab) => el("button", {
        key: tab,
        onClick: () => { activeTab = tab; },
        style: { ...styles.tab, ...(activeTab === tab ? styles.tabActive : {}) },
    }, tab)));
}

function renderActiveTab(ns, s) {
    if (activeTab === "Targets") return renderTargets(s);
    if (activeTab === "Economy") return renderEconomy(s);
    if (activeTab === "Network") return renderNetwork(s);
    if (activeTab === "Diagnostics") return renderDiagnostics(ns, s);
    return renderOverview(s);
}

function renderOverview(s) {
    const c = s.controller ?? {};
    const money = c.money ?? {};
    const sec = c.security ?? {};
    const exec = c.execution ?? {};
    const tele = s.telemetry ?? {};
    return grid(
        panel("ACTIVE HGW", rows([
            ["Target", c.hostname ?? "waiting"],
            ["Phase", c.phase ?? "waiting"],
            ["Action", c.action ?? "waiting"],
            ["Reason", c.reason ?? "No controller state"],
        ])),
        panel("TARGET STATE", rows([
            ["Money", `${moneyFmt(money.current)} / ${moneyFmt(money.max)}`],
            ["Desired", pct(money.desiredPercent)],
            ["Security", `${num(sec.current)} / ${num(sec.minimum)} (+${num(Math.max(0, Number(sec.current ?? 0) - Number(sec.minimum ?? 0)))})`],
            ["Tactical", c.tactical?.status ?? "waiting"],
        ])),
        panel("REMOTE EXECUTION", rows([
            ["Hosts", String(exec.hostCount ?? 0)],
            ["Usable RAM", ramFmt(exec.usableRam)],
            ["Active jobs", String(exec.activeJobs ?? 0)],
            ["Threads", String(exec.activeThreads ?? 0)],
            ["Policy", "REMOTE ONLY"],
        ])),
        panel("INCOME", rows([
            ["1 minute", `${moneyFmt(tele.incomePerSecond1m)}/s`],
            ["5 minute", `${moneyFmt(tele.incomePerSecond5m)}/s`],
            ["Lifetime", `${moneyFmt(tele.incomePerSecond)}/s`],
            ["Hack events", String(tele.hackEvents ?? 0)],
        ])),
        panel("ECONOMY", economySummary(s), true),
        panel("SYSTEM", systemSummary(s), true),
    );
}

function renderTargets(s) {
    const selected = s.economic?.selectedTarget ?? null;
    const rankings = Array.isArray(s.economic?.rankings) ? s.economic.rankings : [];
    const rejected = Array.isArray(s.economic?.rejectedTargets) ? s.economic.rejectedTargets : [];
    return el("div", null,
        panel("TARGET REASONING", selected ? rows([
            ["Selected", `${selected.hostname} @ ${pct(selected.moneyTargetPercent)}`],
            ["Prep", `${duration(selected.prepSeconds)} raw → ${duration(selected.weightedPrepSeconds)} weighted`],
            ["Income", `${moneyFmt(selected.steadyIncomePerSecond)}/s`],
            ["Economic ETA", duration(selected.economicEtaSeconds)],
            ["Why", selected.reason ?? "No cached reason"],
        ]) : text("Waiting for economic target state."), true),
        panel("ECONOMIC RANKING", el("div", null, ...rankings.slice(0, 8).map((r, i) => targetRow(r, i))), true),
        panel("IGNORED / FILTERED", rejected.length ? el("div", null, ...rejected.slice(0, 8).map((r) => row(String(r.hostname), String(r.reason ?? "filtered")))) : text("No targets currently filtered."), true),
    );
}

function renderEconomy(s) {
    const e = s.economy ?? {};
    const goal = e.goal ?? {};
    const manual = s.manualGoal ?? {};
    const purchase = s.purchase ?? {};
    return grid(
        panel("ACTIVE MONEY GOAL", rows([
            ["Mode", e.mode ?? "waiting"],
            ["Goal", goal.title ?? "No goal"],
            ["Current cash", moneyFmt(e.cash)],
            ["Remaining", moneyFmt(goal.remaining)],
            ["Ready", goal.ready ? "YES" : "NO"],
        ])),
        panel("MANUAL SAVINGS LOCK", rows([
            ["Status", manual.active ? "ACTIVE" : "OFF"],
            ["Target cash", manual.active ? moneyFmt(manual.targetCash) : "—"],
            ["Title", manual.title || "—"],
            ["Auto purchasing", manual.active ? "BLOCKED" : "ENABLED"],
        ])),
        panel("CLOUD PURCHASE", rows([
            ["Status", purchase.status ?? "No purchase state"],
            ["Last host", purchase.hostname || "—"],
            ["RAM", purchase.ram ? ramFmt(purchase.ram) : "—"],
            ["Reason", purchase.reason ?? "—"],
        ])),
        panel("COMMANDS", el("div", null,
            command("Set savings goal", "run economy/manual-goal.js 50m"),
            command("Check savings goal", "run economy/manual-goal.js status"),
            command("Clear savings goal", "run economy/manual-goal.js clear"),
            command("Economic report", "run diagnostics/economy-targets.js"),
        )),
    );
}

function renderNetwork(s) {
    const n = s.planner?.network ?? {};
    const root = s.root ?? {};
    const hosts = Array.isArray(s.planner?.executionHosts) ? s.planner.executionHosts.filter((h) => h.hostname !== "home") : [];
    return el("div", null,
        grid(
            panel("DISCOVERY", rows([
                ["Discovered", String(n.discovered ?? 0)],
                ["Rooted", String(n.rooted ?? 0)],
                ["Rootable now", String(n.rootableNow ?? 0)],
                ["HGW targets", String(n.hgwTargets ?? 0)],
            ])),
            panel("ROOTING", rows([
                ["Port tools", String(root.portToolCount ?? n.portToolCount ?? 0)],
                ["Newly rooted", String(root.newlyRooted ?? 0)],
                ["Last check", age(root.updatedAt)],
                ["Tools", Array.isArray(root.availableTools) && root.availableTools.length ? root.availableTools.join(", ") : "none"],
            ])),
        ),
        panel("REMOTE RAM POOL", el("div", null, ...hosts.slice(0, 14).map((h) => row(String(h.hostname), `${ramFmt(h.maxRam)} max`))), true),
    );
}

function renderDiagnostics(ns, s) {
    const tacticalAge = s.tactical?.updatedAt ? Date.now() - Number(s.tactical.updatedAt) : Infinity;
    const telemetryAge = s.telemetry?.updatedAt ? Date.now() - Number(s.telemetry.updatedAt) : Infinity;
    return grid(
        panel("LIVE HEALTH", rows([
            ["Controller", s.controller && !isControllerStateStale(s.controller) ? "PASS" : "WAIT"],
            ["Planner", s.planner?.selectedTarget ? "PASS" : "WAIT"],
            ["Economy", s.economic?.selectedTarget ? "PASS" : "WAIT"],
            ["Tactical", tacticalAge < 15000 ? "PASS" : "STALE/WAIT"],
            ["Telemetry", telemetryAge < 5000 ? "PASS" : "STALE/WAIT"],
        ])),
        panel("MANUAL TESTS", el("div", null,
            actionButton(ns, "Smoke tests", "all"),
            actionButton(ns, "Progression test", "progression-advisor"),
            el("div", { style: styles.status }, actionStatus),
        )),
        panel("USEFUL COMMANDS", el("div", null,
            command("RAM audit", "run diagnostics/mem-audit.js"),
            command("Income report", "run diagnostics/income.js"),
            command("Network inspect", "run network/inspect.js"),
            command("Force root check", "run network/root.js"),
        )),
        panel("STATE AGES", rows([
            ["Planner", age(s.planner?.updatedAt)],
            ["Economy", age(s.economy?.updatedAt)],
            ["Target strategy", age(s.economic?.updatedAt)],
            ["Root", age(s.root?.updatedAt)],
            ["Cloud purchase", age(s.purchase?.updatedAt)],
        ])),
    );
}

function economySummary(s) {
    const e = s.economy ?? {};
    const goal = e.goal ?? {};
    return rows([
        ["Mode", e.mode ?? "waiting"],
        ["Goal", goal.title ?? "No goal"],
        ["Cash", moneyFmt(e.cash)],
        ["Remaining", moneyFmt(goal.remaining)],
        ["Manual lock", s.manualGoal?.active ? "ACTIVE" : "off"],
    ]);
}

function systemSummary(s) {
    const p = s.planner ?? {};
    const n = p.network ?? {};
    return rows([
        ["Hacking level", String(p.hackingLevel ?? "?")],
        ["Planner age", age(p.updatedAt)],
        ["Servers discovered", String(n.discovered ?? 0)],
        ["Port tools", String(n.portToolCount ?? s.root?.portToolCount ?? 0)],
        ["Root check", age(s.root?.updatedAt)],
    ]);
}

function targetRow(r, index) {
    return el("div", { key: `${r.hostname}-${index}`, style: styles.targetRow },
        el("span", { style: styles.rank }, `#${r.economicRank ?? index + 1}`),
        el("span", { style: styles.host }, String(r.hostname)),
        el("span", { style: styles.metric }, pct(r.moneyTargetPercent)),
        el("span", { style: styles.metric }, `${moneyFmt(r.steadyIncomePerSecond)}/s`),
        el("span", { style: styles.metricWide }, duration(r.economicEtaSeconds)),
    );
}

function actionButton(ns, label, test) {
    return el("button", {
        key: test,
        style: styles.button,
        onClick: () => {
            ns.writePort(TEST_REQUEST_PORT, JSON.stringify({ test, requestedAt: Date.now() }));
            actionStatus = `${label} queued`;
        },
    }, label);
}

function command(label, value) {
    return el("div", { style: styles.command },
        el("div", { style: styles.commandLabel }, label),
        el("div", { style: styles.code }, value),
    );
}

function panel(title, content, wide = false) {
    return el("div", { style: { ...styles.panel, ...(wide ? styles.wide : {}) } },
        el("div", { style: styles.panelTitle }, title),
        content,
    );
}

function grid(...children) { return el("div", { style: styles.grid }, ...children); }
function rows(values) { return el("div", null, ...values.map(([k, v]) => row(k, v))); }
function row(k, v) { return el("div", { style: styles.row }, el("span", { style: styles.key }, k), el("span", { style: styles.value }, String(v))); }
function text(v) { return el("div", { style: styles.subtle }, v); }
function badge(label, tone) { return el("span", { style: { ...styles.badge, ...(tone === "ok" ? styles.badgeOk : tone === "warn" ? styles.badgeWarn : {}) } }, label); }
function el(type, props, ...children) { return React.createElement(type, props, ...children); }

function pct(v) { return `${(Math.max(0, Number(v ?? 0)) * 100).toFixed(0)}%`; }
function num(v) { return Number(v ?? 0).toFixed(2); }
function moneyFmt(v) {
    const n = Math.max(0, Number(v ?? 0));
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}t`;
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}b`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}m`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}k`;
    return `$${n.toFixed(0)}`;
}
function ramFmt(v) { return `${Math.max(0, Number(v ?? 0)).toFixed(2)} GB`; }
function age(ts) {
    const n = Number(ts ?? 0);
    if (!n) return "never";
    const sec = Math.max(0, (Date.now() - n) / 1000);
    if (sec < 60) return `${sec.toFixed(0)}s ago`;
    return `${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}s ago`;
}
function duration(v) {
    const sec = Math.max(0, Number(v ?? 0));
    if (!Number.isFinite(sec)) return "∞";
    if (sec < 60) return `${sec.toFixed(0)}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ${Math.floor(sec % 60)}s`;
    const hr = Math.floor(min / 60);
    return `${hr}h ${min % 60}m`;
}

const styles = {
    app: { fontFamily: "monospace", padding: "10px", minHeight: "700px", background: "#0d1117", color: "#d8dee9" },
    header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", padding: "10px 12px", border: "1px solid #30363d", borderRadius: "6px", background: "#111820" },
    headerRight: { display: "flex", gap: "8px" },
    title: { fontSize: "16px", fontWeight: 700, letterSpacing: "1px" },
    subtle: { opacity: 0.72, marginTop: "3px", lineHeight: 1.4 },
    tabs: { display: "flex", gap: "6px", marginBottom: "10px" },
    tab: { padding: "6px 12px", border: "1px solid #30363d", borderRadius: "5px", background: "#111820", color: "#aab4c0", cursor: "pointer", fontFamily: "monospace" },
    tabActive: { background: "#1d2733", color: "#ffffff", border: "1px solid #5a6b7d" },
    body: { minHeight: "600px" },
    grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" },
    panel: { border: "1px solid #30363d", borderRadius: "6px", padding: "10px 12px", background: "#111820", marginBottom: "10px", overflow: "hidden" },
    wide: { gridColumn: "1 / -1" },
    panelTitle: { fontWeight: 700, fontSize: "12px", letterSpacing: "0.8px", marginBottom: "8px", opacity: 0.9 },
    row: { display: "flex", justifyContent: "space-between", gap: "14px", borderTop: "1px solid #202a35", padding: "5px 0" },
    key: { opacity: 0.68, flexShrink: 0 },
    value: { textAlign: "right", overflowWrap: "anywhere" },
    badge: { padding: "4px 7px", borderRadius: "999px", fontSize: "10px", border: "1px solid #46515e", opacity: 0.8 },
    badgeOk: { border: "1px solid #3a7254", opacity: 1 },
    badgeWarn: { border: "1px solid #8b6a35", opacity: 1 },
    targetRow: { display: "grid", gridTemplateColumns: "45px 1fr 80px 110px 110px", gap: "8px", padding: "6px 0", borderTop: "1px solid #202a35", alignItems: "center" },
    rank: { opacity: 0.55 },
    host: { fontWeight: 700 },
    metric: { textAlign: "right" },
    metricWide: { textAlign: "right", opacity: 0.8 },
    button: { marginRight: "8px", marginBottom: "8px", padding: "6px 10px", border: "1px solid #4b5867", borderRadius: "5px", background: "#1b2430", color: "#e5e9f0", cursor: "pointer", fontFamily: "monospace" },
    status: { marginTop: "6px", opacity: 0.7 },
    command: { marginBottom: "9px" },
    commandLabel: { fontSize: "11px", opacity: 0.65, marginBottom: "2px" },
    code: { padding: "5px 7px", background: "#0b0f14", border: "1px solid #252d37", borderRadius: "4px", overflowWrap: "anywhere" },
};
