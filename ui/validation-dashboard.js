import { PATHS, FRESHNESS_MS } from "/core/config.js";
import { classifyFreshness, readJson } from "/core/state.js";
import { formatMoney, formatRam } from "/ui/format.js";

export async function main(ns) {
  const flags = ns.flags([["interval", 1000]]);
  ns.disableLog("ALL");
  ns.ui.openTail();
  try { ns.ui.resizeTail(1180, 760); } catch {}

  let activeTab = "active";
  const React = globalThis.React;
  if (!React) throw new Error("React is not available in this Bitburner runtime");
  const h = React.createElement;

  while (true) {
    const snapshots = readSnapshots(ns);
    ns.clearLog();
    ns.printRaw(renderDashboard(h, snapshots, activeTab, (tab) => { activeTab = tab; }));
    await ns.sleep(Math.max(250, Number(flags.interval) || 1000));
  }
}

function readSnapshots(ns) {
  const now = Date.now();
  return {
    resources: decorate(readJson(ns, PATHS.resourceState), FRESHNESS_MS.fast, now),
    servers: decorate(readJson(ns, PATHS.serverState), FRESHNESS_MS.medium, now),
    player: decorate(readJson(ns, PATHS.playerState), FRESHNESS_MS.medium, now),
    ramAudit: decorate(readJson(ns, PATHS.ramAudit), FRESHNESS_MS.slow, now),
    update: decorate(readJson(ns, PATHS.updateState), FRESHNESS_MS.slow, now),
    updateValidation: decorate(readJson(ns, PATHS.updateValidationState), FRESHNESS_MS.slow, now),
  };
}

function decorate(snapshot, maxAgeMs, now) {
  return {
    snapshot,
    freshness: classifyFreshness(snapshot, maxAgeMs, now),
    ageMs: snapshot?.generatedAt ? Math.max(0, now - snapshot.generatedAt) : Infinity,
  };
}

function renderDashboard(h, s, activeTab, setTab) {
  const tabs = [
    ["active", "Active / In Development"],
    ["completed", "Completed / Validated"],
    ["overall", "Overall Testing"],
  ];

  return h("div", { style: rootStyle },
    h("div", { style: headerStyle },
      h("div", null,
        h("div", { style: titleStyle }, "Agxnny Stack Validation"),
        h("div", { style: subStyle }, "Shared-state engineering dashboard"),
      ),
      h(StatusPill, { h, label: overallHealth(s) }),
    ),
    h("div", { style: tabRowStyle }, ...tabs.map(([id, label]) =>
      h("button", {
        key: id,
        onClick: () => setTab(id),
        style: { ...tabStyle, ...(activeTab === id ? activeTabStyle : {}) },
      }, label),
    )),
    activeTab === "active" ? h(ActiveView, { h, s }) :
      activeTab === "completed" ? h(CompletedView, { h, s }) :
      h(OverallView, { h, s }),
  );
}

function ActiveView({ h, s }) {
  const r = s.resources.snapshot?.data;
  const p = s.player.snapshot?.data;
  const a = s.ramAudit.snapshot?.data;
  const u = s.update.snapshot?.data;

  return h("div", null,
    h("div", { style: gridStyle },
      h(MetricCard, { h, title: "Home RAM", value: ramPair(r?.home), meta: freshnessMeta(s.resources) }),
      h(MetricCard, { h, title: "Remote RAM", value: ramPair(r?.remote), meta: `${r?.remote?.processCount ?? 0} processes` }),
      h(MetricCard, { h, title: "Total RAM Pool", value: ramPair(r?.total), meta: `${r?.usableRamHostCount ?? 0} RAM hosts` }),
      h(MetricCard, { h, title: "Player Money", value: formatMoney(p?.money), meta: `Hack ${p?.skills?.hacking ?? "—"}` }),
      h(MetricCard, { h, title: "RAM Audit", value: a?.status ?? "NO DATA", meta: `${a?.scriptCount ?? 0} entrypoints` }),
      h(MetricCard, { h, title: "Repository", value: u?.status ?? "NO DATA", meta: revisionMeta(u) }),
    ),
    h("div", { style: splitStyle },
      h(Panel, { h, title: "RAM by Host" }, h(HostTable, { h, hosts: r?.hosts ?? [] })),
      h(Panel, { h, title: "Update / Validation" }, h(UpdatePanel, { h, update: s.update, validation: s.updateValidation })),
    ),
    h(Panel, { h, title: "Running Processes" }, h(ProcessTable, { h, hosts: r?.hosts ?? [] })),
  );
}

function CompletedView({ h, s }) {
  return h("div", { style: gridStyle },
    h(StateCard, { h, name: "Resource Collector", state: s.resources }),
    h(StateCard, { h, name: "Server Collector", state: s.servers }),
    h(StateCard, { h, name: "Player Collector", state: s.player }),
    h(StateCard, { h, name: "RAM Audit", state: s.ramAudit }),
    h(StateCard, { h, name: "Update Watcher", state: s.update }),
    h(StateCard, { h, name: "Update Tests", state: s.updateValidation }),
  );
}

function OverallView({ h, s }) {
  const entries = Object.entries(s);
  return h(Panel, { h, title: "Whole-stack state inputs" },
    h("div", null, ...entries.map(([name, item]) =>
      h("div", { key: name, style: rowStyle },
        h("span", { style: { flex: 1 } }, name),
        h("span", null, item.freshness),
        h("span", { style: monoStyle }, age(item.ageMs)),
      ),
    )),
  );
}

function MetricCard({ h, title, value, meta }) {
  return h("div", { style: cardStyle },
    h("div", { style: labelStyle }, title),
    h("div", { style: metricStyle }, value),
    h("div", { style: subStyle }, meta),
  );
}

function StateCard({ h, name, state }) {
  const health = state.snapshot?.data?.health ?? state.snapshot?.data?.status ?? (state.snapshot?.valid ? "UNTESTED" : "NO DATA");
  return h("div", { style: cardStyle },
    h("div", { style: labelStyle }, name),
    h("div", { style: metricStyle }, health),
    h("div", { style: subStyle }, `${state.freshness} · ${age(state.ageMs)}`),
  );
}

function Panel({ h, title, children }) {
  return h("div", { style: panelStyle }, h("div", { style: panelTitleStyle }, title), children);
}

function HostTable({ h, hosts }) {
  const rows = [...hosts].sort((a, b) => b.maxRam - a.maxRam).slice(0, 30);
  return h("div", null,
    h(TableHeader, { h, cols: ["Host", "Used", "Free", "Total", "Procs"] }),
    ...rows.map((x) => h("div", { key: x.hostname, style: tableRowStyle },
      cell(h, x.hostname, 2), cell(h, formatRam(x.usedRam)), cell(h, formatRam(x.freeRam)), cell(h, formatRam(x.maxRam)), cell(h, x.processCount),
    )),
  );
}

function ProcessTable({ h, hosts }) {
  const rows = hosts.flatMap((host) => host.processes.map((p) => ({ ...p, host: host.hostname })))
    .sort((a, b) => b.ramUsed - a.ramUsed).slice(0, 40);
  return h("div", null,
    h(TableHeader, { h, cols: ["Host", "Script", "Threads", "RAM"] }),
    ...rows.map((x) => h("div", { key: `${x.host}-${x.pid}`, style: tableRowStyle },
      cell(h, x.host), cell(h, x.filename, 3), cell(h, x.threads), cell(h, formatRam(x.ramUsed)),
    )),
  );
}

function UpdatePanel({ h, update, validation }) {
  const u = update.snapshot?.data;
  const v = validation.snapshot?.data;
  return h("div", null,
    h("div", { style: rowStyle }, h("span", null, "Status"), h("b", null, u?.status ?? "NO DATA")),
    h("div", { style: rowStyle }, h("span", null, "Alarm"), h("span", null, u?.alarm ?? "—")),
    h("div", { style: rowStyle }, h("span", null, "Target"), h("span", { style: monoStyle }, revisionMeta(u))),
    h("div", { style: rowStyle }, h("span", null, "Tests"), h("span", null, v ? `${v.passed ?? 0}/${v.total ?? 0}` : "NO DATA")),
  );
}

function StatusPill({ h, label }) { return h("span", { style: pillStyle }, label); }
function TableHeader({ h, cols }) { return h("div", { style: tableHeaderStyle }, ...cols.map((c) => cell(h, c))); }
function cell(h, value, flex = 1) { return h("span", { style: { flex, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, String(value ?? "—")); }

function overallHealth(s) {
  const states = Object.values(s);
  if (states.some((x) => x.snapshot?.valid === false || x.freshness === "INVALID")) return "DEGRADED";
  if (states.some((x) => !x.snapshot)) return "IN DEVELOPMENT";
  if (states.some((x) => x.freshness === "STALE")) return "DEGRADED";
  return "UNTESTED";
}
function ramPair(x) { return x ? `${formatRam(x.usedRam)} / ${formatRam(x.maxRam)}` : "NO DATA"; }
function age(ms) { return Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : "—"; }
function freshnessMeta(x) { return `${x.freshness} · ${age(x.ageMs)}`; }
function revisionMeta(u) { return u?.remote?.revisionId ?? u?.target?.revisionId ?? u?.revisionId ?? "—"; }

const rootStyle = { fontFamily: "sans-serif", padding: "12px", background: "#101114", minHeight: "100%", color: "#e6e6e6" };
const headerStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" };
const titleStyle = { fontSize: "22px", fontWeight: 700 };
const subStyle = { opacity: 0.68, fontSize: "12px", marginTop: "4px" };
const tabRowStyle = { display: "flex", gap: "8px", marginBottom: "12px" };
const tabStyle = { padding: "7px 10px", border: "1px solid #555", borderRadius: "6px", background: "#191b20", color: "inherit", cursor: "pointer" };
const activeTabStyle = { borderColor: "#ddd", background: "#292d35" };
const gridStyle = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px", marginBottom: "8px" };
const splitStyle = { display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px", marginBottom: "8px" };
const cardStyle = { background: "#191b20", border: "1px solid #30333a", borderRadius: "7px", padding: "10px" };
const panelStyle = { ...cardStyle, marginBottom: "8px" };
const labelStyle = { opacity: 0.72, fontSize: "12px" };
const metricStyle = { fontSize: "18px", fontWeight: 700, marginTop: "3px" };
const panelTitleStyle = { fontWeight: 700, marginBottom: "7px" };
const rowStyle = { display: "flex", justifyContent: "space-between", gap: "12px", padding: "3px 0", borderBottom: "1px solid #25282e" };
const tableHeaderStyle = { display: "flex", gap: "8px", padding: "4px 0", fontWeight: 700, opacity: 0.72 };
const tableRowStyle = { display: "flex", gap: "8px", padding: "3px 0", borderTop: "1px solid #25282e", fontSize: "12px" };
const monoStyle = { fontFamily: "monospace" };
const pillStyle = { ...cardStyle, padding: "5px 9px", fontWeight: 700 };
