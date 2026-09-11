import { PATHS, FRESHNESS_MS } from "/core/config.js";
import { classifyFreshness, readJson } from "/core/state.js";
import { formatRam } from "/ui/format.js";
import { openRememberedTail, rememberTail } from "/ui/tail-state.js";

const ACTIVE_TEST_RUNNER = "/validation/active-tests.js";
const SCRIPT_HEALTH_RUNNER = "/validation/script-health.js";
const UPDATE_WATCHER = "/systems/data-collection/update/watcher.js";

export async function main(ns) {
  const flags = ns.flags([["ui-interval", 100], ["data-interval", 500]]);
  const uiInterval = Math.max(50, Number(flags["ui-interval"]) || 100);
  const dataInterval = Math.max(100, Number(flags["data-interval"]) || 500);
  ns.disableLog("ALL");
  await openRememberedTail(ns, { width: 1180, height: 760 });

  const React = globalThis.React;
  if (!React) throw new Error("React is not available in this Bitburner runtime");
  const h = React.createElement;

  let raw = readRaw(ns);
  let lastRead = 0;
  let lastTailSave = 0;
  let passedOpen = false;
  let queuedAction = null;

  while (true) {
    const now = Date.now();
    if (queuedAction) { runAction(ns, queuedAction); queuedAction = null; lastRead = 0; }
    if (now - lastRead >= dataInterval) { raw = readRaw(ns); lastRead = now; }
    if (now - lastTailSave >= 250) { rememberTail(ns); lastTailSave = now; }

    const s = decorateAll(raw, now);
    ns.clearLog();
    ns.printRaw(render(h, s, {
      queue: (action) => { queuedAction = action; },
      passedOpen,
      togglePassed: () => { passedOpen = !passedOpen; },
    }));
    await ns.sleep(uiInterval);
  }
}

function runAction(ns, action) {
  const launch = (script, label, args = []) => {
    if (!ns.fileExists(script, "home")) return ns.tprint(`${label}: missing ${script}`);
    if (ns.isRunning(script, "home", ...args)) return ns.tprint(`${label}: already running`);
    const pid = ns.exec(script, "home", 1, ...args);
    if (pid === 0) ns.tprint(`${label}: failed to start`);
  };
  if (action === "tests") launch(ACTIVE_TEST_RUNNER, "Active tests");
  else if (action === "health") launch(SCRIPT_HEALTH_RUNNER, "Script health check");
  else if (action === "update-check") launch(UPDATE_WATCHER, "Update check", ["--once"]);
}

function readRaw(ns) {
  return {
    resources: readJson(ns, PATHS.resourceState),
    servers: readJson(ns, PATHS.serverState),
    player: readJson(ns, PATHS.playerState),
    ramAudit: readJson(ns, PATHS.ramAudit),
    update: readJson(ns, PATHS.updateState),
    updateValidation: readJson(ns, PATHS.updateValidationState),
    activeValidation: readJson(ns, PATHS.activeValidationState),
    scriptHealth: readJson(ns, PATHS.scriptHealthState),
  };
}
function decorateAll(raw, now) {
  return {
    resources: decorate(raw.resources, FRESHNESS_MS.fast, now),
    servers: decorate(raw.servers, FRESHNESS_MS.medium, now),
    player: decorate(raw.player, FRESHNESS_MS.medium, now),
    ramAudit: decorate(raw.ramAudit, FRESHNESS_MS.slow, now),
    update: decorate(raw.update, FRESHNESS_MS.slow, now),
    updateValidation: decorate(raw.updateValidation, FRESHNESS_MS.slow, now),
    activeValidation: decorate(raw.activeValidation, FRESHNESS_MS.slow, now),
    scriptHealth: decorate(raw.scriptHealth, FRESHNESS_MS.slow, now),
  };
}
function decorate(snapshot, maxAgeMs, now) { return { snapshot, freshness: classifyFreshness(snapshot, maxAgeMs, now), ageMs: snapshot?.generatedAt ? Math.max(0, now - snapshot.generatedAt) : Infinity }; }

function render(h, s, ui) {
  const res = s.resources.snapshot?.data ?? {};
  const srv = s.servers.snapshot?.data ?? {};
  const sh = s.scriptHealth.snapshot?.data ?? {};
  const upd = s.update.snapshot?.data ?? {};
  const av = s.activeValidation.snapshot?.data ?? {};
  const health = overallHealth(s);
  const rooted = (srv.hosts ?? []).filter(x => x.hasAdminRights);
  const jobs = (res.hosts ?? []).flatMap(host => (host.processes ?? []).map(p => ({ ...p, host: host.hostname }))).sort((a,b) => (b.ramUsed ?? 0) - (a.ramUsed ?? 0)).slice(0,5);
  const installed = upd.installed ?? {};
  const testResults = av.results ?? [];
  const passed = testResults.filter(r => r.health === "PASS");
  const outstanding = testResults.filter(r => r.health !== "PASS");

  return h("div", { style: S.root },
    h("div", { style: S.header },
      h("div", { style: S.brand }, h("span", { style: S.pulse }, "⌁"), h("div", null, h("div", { style: S.title }, "Bitburner Stack Diagnostics"), h("div", { style: S.subtitle }, "Validate · Monitor · Maintain"))),
      h("div", { style: S.actions },
        button(h, "▶  Run Active Tests", () => ui.queue("tests"), true),
        button(h, "⌁  Script Health Check", () => ui.queue("health")),
        button(h, "↻  Refresh", () => ui.queue("update-check"))),
      h("div", { style: { ...S.health, ...healthStyle(health) } }, h("span", { style: S.dot }, "●"), h("div", null, h("b", null, health), h("div", { style: S.small }, health === "HEALTHY" ? "All systems nominal" : "Attention required")))),

    h("div", { style: S.metrics },
      metric(h, "RAM Pool", formatRam(res.total?.maxRam ?? 0), [`Used: ${formatRam(res.total?.usedRam ?? 0)} (${pct(res.total?.usedRam, res.total?.maxRam)})`, `Free: ${formatRam(res.total?.freeRam ?? 0)} (${pct(res.total?.freeRam, res.total?.maxRam)})`], progress(res.total?.usedRam, res.total?.maxRam)),
      metric(h, "Rooted Servers", `${srv.rootedCount ?? rooted.length} / ${srv.hostCount ?? 0}`, [`Rooted (${pct(srv.rootedCount ?? rooted.length, srv.hostCount ?? 0)})`], progress(srv.rootedCount ?? rooted.length, srv.hostCount ?? 0)),
      metric(h, "Scripts", `${sh.total ?? 0}`, [`Healthy: ${sh.passed ?? 0}`, `Failed: ${sh.failed ?? 0}${(sh.degraded ?? 0) ? ` · Degraded: ${sh.degraded}` : ""}`]),
      h("div", { style: { ...S.card, gridColumn: "span 2" } }, h("div", { style: S.label }, "Stack Version"), h("div", { style: S.metric }, installed.releaseVersion ?? "unknown"), h("div", { style: S.mono }, installed.revisionId ?? "revision unknown"), h("div", { style: S.small }, `Repository: ${upd.status ?? "NO DATA"}`))),

    h("div", { style: S.mainGrid },
      panel(h, "Current Jobs (Top 5 by RAM)", jobs.length ? table(h, ["PID","SCRIPT","HOST","THREADS","RAM"], jobs.map(j => [j.pid, j.filename, j.host, j.threads, formatRam(j.ramUsed)]), [0.7,3,1.5,1,1]) : empty(h, "No running jobs")),
      panel(h, "Test Results", h("div", null,
        h("div", { style: resultBannerStyle(av.status) }, h("b", null, testSummary(av)), h("span", { style: S.small }, av.completedAt ? ` · ${timeAgo(Date.now() - av.completedAt)} ago` : "")),
        h("button", { onClick: ui.togglePassed, style: S.collapse }, `${ui.passedOpen ? "▾" : "▸"} Passed tests (${passed.length})`),
        ui.passedOpen ? h("div", null, ...passed.map(r => testRow(h, r))) : null,
        outstanding.length ? h("div", { style: { marginTop: "8px" } }, ...outstanding.map(r => testRow(h, r))) : h("div", { style: S.emptySmall }, "No failed or pending active tests"),
        h("div", { style: S.panelActions }, button(h, "▶  Run Active Tests", () => ui.queue("tests"), true), button(h, "Script Health Check", () => ui.queue("health"))))),
      panel(h, "Available Servers (Rooted)", rootedServers(h, rooted, res.hosts ?? [])),
      panel(h, `Failed / Collapsed Tests`, outstanding.length ? h("div", null, ...outstanding.map(r => testRow(h, r))) : empty(h, "No failed tests", "Failed, blocked, or degraded tests will appear here"))),

    h("div", { style: S.footer }, h("span", null, "Bitburner Stack Diagnostics"), h("span", { style: S.mono }, `${installed.releaseVersion ?? "?"} · ${installed.revisionId ?? "unknown"}`)));
}

function metric(h, title, value, lines = [], bar = null) { return h("div", { style: S.card }, h("div", { style: S.label }, title), h("div", { style: S.metric }, value), ...lines.map((x,i) => h("div", { key:i, style:S.small }, x)), bar); }
function panel(h, title, body) { return h("div", { style:S.panel }, h("div", { style:S.panelTitle }, title), body); }
function button(h, label, onClick, primary=false) { return h("button", { onClick, style:{ ...S.button, ...(primary ? S.primaryButton : {}) } }, label); }
function table(h, headers, rows, flexes) { return h("div", { style:S.table }, row(h, headers, flexes, true), ...rows.map((r,i) => row(h,r,flexes,false,i))); }
function row(h, cells, flexes, header=false, key=null) { return h("div", { key, style: header ? S.tableHead : S.tableRow }, ...cells.map((c,i) => h("span", { key:i, style:{ flex:flexes[i] ?? 1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" } }, String(c ?? "—")))); }
function testRow(h, r) { return h("div", { key:r.id ?? r.label, style:S.testRow }, h("span", { style:{ ...S.statusMark, color:statusColor(r.health) } }, r.health === "PASS" ? "●" : "▲"), h("span", { style:{ flex:1 } }, r.label ?? r.id ?? "Test"), h("b", { style:{ color:statusColor(r.health) } }, r.health ?? "UNTESTED"), r.message ? h("span", { style:{ ...S.small, marginLeft:"10px", maxWidth:"42%" } }, r.message) : null); }
function rootedServers(h, rooted, resourceHosts) {
  const usage = new Map(resourceHosts.map(x => [x.hostname, x]));
  const rows = [...rooted].map(x => { const r=usage.get(x.hostname) ?? x; return { host:x.hostname, max:r.maxRam ?? 0, used:r.usedRam ?? r.ramUsed ?? 0 }; }).sort((a,b) => b.used-a.used).slice(0,5);
  if (!rows.length) return empty(h, "No rooted servers");
  return h("div", null, table(h,["SERVER","RAM","USED","FREE","USAGE"],rows.map(x=>[x.host,formatRam(x.max),formatRam(x.used),formatRam(Math.max(0,x.max-x.used)),pct(x.used,x.max)]),[2,1,1,1,1]), h("div", { style:{...S.small,marginTop:"8px"} }, `Showing ${rows.length}/${rooted.length} rooted servers`));
}
function empty(h, title, subtitle="") { return h("div", { style:S.empty }, h("div", { style:{fontSize:"24px",opacity:.55} }, "▱"), h("b", null, title), subtitle ? h("div", { style:S.small }, subtitle) : null); }
function progress(value,total) { const p = total > 0 ? Math.max(0,Math.min(100,value/total*100)) : 0; return { type:"bar", p }; }
function pct(value,total) { return total > 0 ? `${(value/total*100).toFixed(1)}%` : "0.0%"; }
function testSummary(d) { if (!d || !Number.isFinite(d.total)) return "Active tests have not been run yet"; return `${d.passed ?? 0}/${d.total} tests passed · ${d.status ?? "UNTESTED"}`; }
function timeAgo(ms) { if (!Number.isFinite(ms)) return "—"; if (ms < 60_000) return `${(ms/1000).toFixed(0)}s`; return `${(ms/60_000).toFixed(1)}m`; }
function validationHealth(x) { if (!x?.snapshot) return "NO DATA"; if (x.snapshot.valid === false || x.freshness === "INVALID") return "FAIL"; if (x.freshness === "STALE" || x.freshness === "UNAVAILABLE") return "DEGRADED"; const d=x.snapshot.data ?? {}; if (d.status === "FAIL" || d.health === "FAIL") return "FAIL"; if (d.status === "BLOCKED" || d.health === "BLOCKED") return "BLOCKED"; if (d.status === "DEGRADED" || d.health === "DEGRADED") return "DEGRADED"; if (d.status === "PASS" || d.health === "PASS" || d.status === "CURRENT" || d.status === "UPDATE_AVAILABLE") return "PASS"; if (Number.isFinite(d.total)&&Number.isFinite(d.passed)) return d.total>0&&d.total===d.passed?"PASS":"FAIL"; return x.snapshot.valid ? "PASS" : "UNTESTED"; }
function overallHealth(s) { const required=[s.resources,s.servers,s.player,s.ramAudit,s.update,s.updateValidation]; const hs=required.map(validationHealth); if(hs.includes("FAIL"))return"FAIL"; if(hs.includes("DEGRADED")||hs.includes("BLOCKED"))return"DEGRADED"; if(hs.includes("NO DATA")||hs.includes("UNTESTED"))return"IN DEVELOPMENT"; return"HEALTHY"; }
function statusColor(x) { return x === "PASS" ? "#41e477" : x === "DEGRADED" ? "#ffcc4d" : x === "BLOCKED" ? "#ff9f43" : "#ff5656"; }
function healthStyle(x) { const c=x==="HEALTHY"?"#3ddd73":x==="IN DEVELOPMENT"?"#5bbcff":x==="DEGRADED"?"#ffcc4d":"#ff5656"; return { borderColor:c, color:c, boxShadow:`0 0 16px ${c}22` }; }
function resultBannerStyle(status) { const c=statusColor(status); return { display:"flex",justifyContent:"space-between",alignItems:"center",gap:"10px",padding:"10px 12px",border:`1px solid ${c}`,borderRadius:"6px",background:`${c}12`,color:c,marginBottom:"8px" }; }

const S = {
  root:{fontFamily:"Inter,Segoe UI,sans-serif",padding:"14px",background:"linear-gradient(180deg,#07111b,#071722)",minHeight:"100%",color:"#dcecff",boxSizing:"border-box"},
  header:{display:"grid",gridTemplateColumns:"minmax(300px,1fr) auto 220px",gap:"14px",alignItems:"center",marginBottom:"14px"},
  brand:{display:"flex",gap:"12px",alignItems:"center"},pulse:{fontSize:"34px",color:"#42e47a"},title:{fontSize:"23px",fontWeight:800,letterSpacing:".2px"},subtitle:{fontSize:"12px",opacity:.7,marginTop:"3px"},
  actions:{display:"flex",gap:"8px",flexWrap:"wrap",justifyContent:"center"},health:{border:"1px solid",borderRadius:"7px",padding:"10px 14px",display:"flex",gap:"10px",alignItems:"center",justifyContent:"center"},dot:{fontSize:"19px"},
  metrics:{display:"grid",gridTemplateColumns:"repeat(5,minmax(0,1fr))",gap:"10px",marginBottom:"10px"},card:{background:"#081b28",border:"1px solid #174561",borderRadius:"7px",padding:"12px",boxShadow:"inset 0 0 22px #0005"},label:{fontSize:"13px",fontWeight:700,color:"#8fdcff"},metric:{fontSize:"22px",fontWeight:800,margin:"4px 0"},small:{fontSize:"11px",opacity:.72,lineHeight:1.5},mono:{fontFamily:"monospace",fontSize:"11px",opacity:.8,marginTop:"5px"},
  button:{padding:"8px 12px",border:"1px solid #187fc1",borderRadius:"5px",background:"#0a2940",color:"#dcecff",cursor:"pointer",fontWeight:700},primaryButton:{background:"#0c82d9",borderColor:"#29a6ff"},
  mainGrid:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"},panel:{background:"#081b28",border:"1px solid #174561",borderRadius:"7px",padding:"12px",minHeight:"250px",boxShadow:"inset 0 0 22px #0005"},panelTitle:{fontSize:"15px",fontWeight:800,paddingBottom:"9px",marginBottom:"8px",borderBottom:"1px solid #174561"},
  table:{fontFamily:"monospace",fontSize:"11px"},tableHead:{display:"flex",gap:"10px",padding:"7px 6px",color:"#8fdcff",fontWeight:800,borderBottom:"1px solid #174561"},tableRow:{display:"flex",gap:"10px",padding:"8px 6px",borderBottom:"1px solid #12364b"},
  testRow:{display:"flex",alignItems:"center",gap:"8px",padding:"8px 7px",borderBottom:"1px solid #12364b",fontSize:"12px"},statusMark:{width:"14px"},collapse:{width:"100%",textAlign:"left",padding:"8px",marginTop:"6px",background:"#0b2536",color:"#dcecff",border:"1px solid #174561",borderRadius:"5px",cursor:"pointer",fontWeight:700},emptySmall:{padding:"14px",textAlign:"center",opacity:.6,fontSize:"11px"},panelActions:{display:"flex",gap:"8px",marginTop:"10px"},empty:{minHeight:"170px",display:"flex",flexDirection:"column",gap:"7px",alignItems:"center",justifyContent:"center",opacity:.72},
  footer:{display:"flex",justifyContent:"space-between",gap:"12px",marginTop:"10px",padding:"7px 2px",fontSize:"10px",opacity:.65}
};
