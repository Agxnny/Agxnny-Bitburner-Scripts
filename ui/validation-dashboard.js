import { PATHS, FRESHNESS_MS } from "/core/config.js";
import { classifyFreshness, readJson } from "/core/state.js";
import { formatMoney, formatRam } from "/ui/format.js";

export async function main(ns) {
  const flags = ns.flags([["ui-interval", 100], ["data-interval", 500]]);
  const uiInterval = Math.max(50, Number(flags["ui-interval"]) || 100);
  const dataInterval = Math.max(100, Number(flags["data-interval"]) || 500);
  ns.disableLog("ALL"); ns.ui.openTail();
  let activeTab = "active", lastDataRead = 0, rawSnapshots = readRawSnapshots(ns);
  const React = globalThis.React; if (!React) throw new Error("React is not available in this Bitburner runtime");
  const h = React.createElement;
  while (true) {
    const now = Date.now();
    if (now - lastDataRead >= dataInterval) { rawSnapshots = readRawSnapshots(ns); lastDataRead = now; }
    const snapshots = decorateSnapshots(rawSnapshots, now);
    ns.clearLog(); ns.printRaw(renderDashboard(h, snapshots, activeTab, (tab) => { activeTab = tab; }));
    await ns.sleep(uiInterval);
  }
}
function readRawSnapshots(ns) { return { resources: readJson(ns, PATHS.resourceState), servers: readJson(ns, PATHS.serverState), player: readJson(ns, PATHS.playerState), ramAudit: readJson(ns, PATHS.ramAudit), update: readJson(ns, PATHS.updateState), updateValidation: readJson(ns, PATHS.updateValidationState) }; }
function decorateSnapshots(raw, now) { return { resources: decorate(raw.resources, FRESHNESS_MS.fast, now), servers: decorate(raw.servers, FRESHNESS_MS.medium, now), player: decorate(raw.player, FRESHNESS_MS.medium, now), ramAudit: decorate(raw.ramAudit, FRESHNESS_MS.slow, now), update: decorate(raw.update, FRESHNESS_MS.slow, now), updateValidation: decorate(raw.updateValidation, FRESHNESS_MS.slow, now) }; }
function decorate(snapshot, maxAgeMs, now) { return { snapshot, freshness: classifyFreshness(snapshot, maxAgeMs, now), ageMs: snapshot?.generatedAt ? Math.max(0, now - snapshot.generatedAt) : Infinity }; }
function renderDashboard(h, s, activeTab, setTab) {
  const tabs = [["active", "Active / In Development"], ["completed", "Completed / Validated"], ["overall", "Overall Testing"]];
  return h("div", { style: rootStyle },
    h("div", { style: headerStyle }, h("div", null, h("div", { style: titleStyle }, "Agxnny Stack Validation"), h("div", { style: subStyle }, "Shared-state engineering dashboard")), h(StatusPill, { h, label: overallHealth(s) })),
    h("div", { style: tabRowStyle }, ...tabs.map(([id, label]) => h("button", { key: id, onClick: () => setTab(id), style: { ...tabStyle, ...(activeTab === id ? activeTabStyle : {}) } }, label))),
    activeTab === "active" ? h(ActiveView, { h, s }) : activeTab === "completed" ? h(CompletedView, { h, s }) : h(OverallView, { h, s }));
}
function ActiveView({ h, s }) {
  const r = s.resources.snapshot?.data, p = s.player.snapshot?.data, a = s.ramAudit.snapshot?.data, u = s.update.snapshot?.data;
  return h("div", null,
    h("div", { style: gridStyle },
      h(MetricCard, { h, title: "Home RAM", value: ramPair(r?.home), meta: freshnessMeta(s.resources) }),
      h(MetricCard, { h, title: "Remote RAM", value: ramPair(r?.remote), meta: `${r?.remote?.processCount ?? 0} processes` }),
      h(MetricCard, { h, title: "Total RAM Pool", value: ramPair(r?.total), meta: `${r?.usableRamHostCount ?? 0} RAM hosts` }),
      h(MetricCard, { h, title: "Player Money", value: formatMoney(p?.money), meta: `Hack ${p?.skills?.hacking ?? "—"} · ${freshnessMeta(s.player)}` }),
      h(MetricCard, { h, title: "RAM Audit", value: validationHealth(s.ramAudit), meta: `${a?.scriptCount ?? 0} entrypoints · ${a?.durationMs ?? "—"}ms` }),
      h(MetricCard, { h, title: "Repository", value: u?.status ?? "NO DATA", meta: revisionMeta(u) })),
    h("div", { style: splitStyle }, h(Panel, { h, title: "RAM by Host" }, h(HostTable, { h, hosts: r?.hosts ?? [] })), h(Panel, { h, title: "Update / Validation" }, h(UpdatePanel, { h, update: s.update, validation: s.updateValidation }))),
    h(Panel, { h, title: "Running Processes" }, h(ProcessTable, { h, hosts: r?.hosts ?? [] })));
}
function CompletedView({ h, s }) { return h("div", { style: gridStyle }, h(StateCard, { h, name: "Resource Collector", state: s.resources }), h(StateCard, { h, name: "Server Collector", state: s.servers }), h(StateCard, { h, name: "Player Collector", state: s.player }), h(StateCard, { h, name: "RAM Audit", state: s.ramAudit }), h(StateCard, { h, name: "Update Watcher", state: s.update }), h(StateCard, { h, name: "Update Tests", state: s.updateValidation })); }
function OverallView({ h, s }) { return h(Panel, { h, title: "Whole-stack validation" }, h("div", null, ...Object.entries(s).map(([name, item]) => h("div", { key: name, style: rowStyle }, h("span", { style: { flex: 1 } }, name), h("b", null, validationHealth(item)), h("span", { style: monoStyle }, age(item.ageMs)))))); }
function MetricCard({ h, title, value, meta }) { return h("div", { style: cardStyle }, h("div", { style: labelStyle }, title), h("div", { style: metricStyle }, value), h("div", { style: subStyle }, meta)); }
function StateCard({ h, name, state }) { return h("div", { style: cardStyle }, h("div", { style: labelStyle }, name), h("div", { style: metricStyle }, validationHealth(state)), h("div", { style: subStyle }, `${state.freshness} · ${age(state.ageMs)}`)); }
function Panel({ h, title, children }) { return h("div", { style: panelStyle }, h("div", { style: panelTitleStyle }, title), children); }
function HostTable({ h, hosts }) {
  const rows = [...hosts].sort((a, b) => b.maxRam - a.maxRam);
  return h("div", { style: tableViewportStyle }, h(TableHeader, { h, cols: ["Host", "Used", "Free", "Total", "Procs"] }), ...rows.map((x) => h("div", { key: x.hostname, style: tableRowStyle }, cell(h, x.hostname, 2), cell(h, formatRam(x.usedRam)), cell(h, formatRam(x.freeRam)), cell(h, formatRam(x.maxRam)), cell(h, x.processCount))));
}
function ProcessTable({ h, hosts }) {
  const rows = hosts.flatMap((host) => host.processes.map((p) => ({ ...p, host: host.hostname }))).sort((a, b) => b.ramUsed - a.ramUsed);
  return h("div", { style: processViewportStyle }, h(TableHeader, { h, cols: ["Host", "Script", "Threads", "RAM"] }), ...rows.map((x) => h("div", { key: `${x.host}-${x.pid}`, style: tableRowStyle }, cell(h, x.host), cell(h, x.filename, 3), cell(h, x.threads), cell(h, formatRam(x.ramUsed)))));
}
function UpdatePanel({ h, update, validation }) {
  const u = update.snapshot?.data, v = validation.snapshot?.data;
  return h("div", null,
    h("div", { style: rowStyle }, h("span", null, "Status"), h("b", null, u?.status ?? "NO DATA")),
    h("div", { style: rowStyle }, h("span", null, "Alarm"), h("span", null, u?.alarm ?? "—")),
    h("div", { style: rowStyle }, h("span", null, "Target"), h("span", { style: revisionStyle, title: revisionMeta(u) }, revisionMeta(u))),
    h("div", { style: rowStyle }, h("span", null, "Tests"), h("b", null, v ? `${v.passed ?? 0}/${v.total ?? 0} · ${validationHealth(validation)}` : "NO DATA")));
}
function StatusPill({ h, label }) { return h("span", { style: pillStyle }, label); }
function TableHeader({ h, cols }) { return h("div", { style: tableHeaderStyle }, ...cols.map((c) => cell(h, c))); }
function cell(h, value, flex = 1) { return h("span", { style: { flex, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, String(value ?? "—")); }
function validationHealth(x) {
  if (!x?.snapshot) return "NO DATA";
  if (x.snapshot.valid === false || x.freshness === "INVALID") return "FAIL";
  if (x.freshness === "STALE" || x.freshness === "UNAVAILABLE") return "DEGRADED";
  const d = x.snapshot.data ?? {};
  if (d.status === "FAIL" || d.health === "FAIL") return "FAIL";
  if (d.status === "DEGRADED" || d.health === "DEGRADED") return "DEGRADED";
  if (d.status === "CURRENT") return "PASS";
  if (d.status === "PASS" || d.health === "PASS") return "PASS";
  if (Number.isFinite(d.total) && Number.isFinite(d.passed)) return d.total > 0 && d.passed === d.total ? "PASS" : "FAIL";
  return x.snapshot.valid ? "PASS" : "UNTESTED";
}
function overallHealth(s) {
  const required = [s.resources, s.servers, s.player, s.ramAudit, s.update, s.updateValidation];
  const health = required.map(validationHealth);
  if (health.includes("FAIL")) return "FAIL";
  if (health.includes("DEGRADED")) return "DEGRADED";
  if (health.includes("NO DATA") || health.includes("UNTESTED")) return "IN DEVELOPMENT";
  return "PASS";
}
function ramPair(x) { return x ? `${formatRam(x.usedRam)} / ${formatRam(x.maxRam)}` : "NO DATA"; }
function age(ms) { return Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : "—"; }
function freshnessMeta(x) { return `${x.freshness} · ${age(x.ageMs)}`; }
function revisionMeta(u) { return u?.remote?.revisionId ?? u?.target?.revisionId ?? u?.revisionId ?? "—"; }
const rootStyle = { fontFamily: "sans-serif", padding: "12px", background: "#101114", minHeight: "100%", color: "#e6e6e6" };
const headerStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }, titleStyle = { fontSize: "22px", fontWeight: 700 }, subStyle = { opacity: 0.68, fontSize: "12px", marginTop: "4px" };
const tabRowStyle = { display: "flex", gap: "8px", marginBottom: "12px" }, tabStyle = { padding: "7px 10px", border: "1px solid #555", borderRadius: "6px", background: "#191b20", color: "inherit", cursor: "pointer" }, activeTabStyle = { borderColor: "#ddd", background: "#292d35" };
const gridStyle = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px", marginBottom: "8px" }, splitStyle = { display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px", marginBottom: "8px" };
const cardStyle = { background: "#191b20", border: "1px solid #30333a", borderRadius: "7px", padding: "10px" }, panelStyle = { ...cardStyle, marginBottom: "8px" }, labelStyle = { opacity: 0.72, fontSize: "12px" }, metricStyle = { fontSize: "18px", fontWeight: 700, marginTop: "3px" }, panelTitleStyle = { fontWeight: 700, marginBottom: "7px" };
const rowStyle = { display: "flex", justifyContent: "space-between", gap: "12px", padding: "3px 0", borderBottom: "1px solid #25282e" };
const tableViewportStyle = { maxHeight: "330px", overflowY: "auto", paddingRight: "4px" }, processViewportStyle = { maxHeight: "220px", overflowY: "auto", paddingRight: "4px" };
const tableHeaderStyle = { display: "flex", gap: "8px", padding: "5px 0", fontWeight: 700, opacity: 0.9, position: "sticky", top: 0, zIndex: 1, background: "#191b20", borderBottom: "1px solid #454950" }, tableRowStyle = { display: "flex", gap: "8px", padding: "3px 0", borderTop: "1px solid #25282e", fontSize: "12px" };
const monoStyle = { fontFamily: "monospace" }, revisionStyle = { ...monoStyle, maxWidth: "68%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }, pillStyle = { ...cardStyle, padding: "5px 9px", fontWeight: 700 };
