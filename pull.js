const RAW_BASE = "https://raw.githubusercontent.com/Agxnny/Agxnny-Bitburner-Scripts/main";
const MANIFEST_URL = `${RAW_BASE}/stack-manifest.json`;
const REMOTE_MANIFEST = "/data/state/remote-stack-manifest.json";
const INSTALLED_STATE = "/data/state/installed-revision.json";
const PULL_PATH = "/pull.js";
const STAGED_PULL = "/data/state/pull.next.js";
const HANDOFF_PATH = "/pull-handoff.js";

const TERMINAL_ALIASES = [
  ["teststart", "run /validation/start.js"], ["tests", "run /validation/active-tests.js"],
  ["health", "run /validation/script-health.js"], ["ramaudit", "run /systems/ram-audit/audit.js"],
  ["update", "run /pull.js"], ["repair", "run /pull.js --repair"],
];

export async function main(ns) {
  const flags = ns.flags([["repair", false], ["force", false]]);
  ns.tprint("Fetching remote stack manifest...");
  if (!await ns.wget(cacheBust(MANIFEST_URL, `check-${Date.now()}`), REMOTE_MANIFEST, "home")) return fail(ns, "Could not download remote manifest");
  const target = readJson(ns, REMOTE_MANIFEST), validation = validateManifest(target);
  if (!validation.valid) return fail(ns, `Remote manifest invalid: ${validation.errors.join("; ")}`);
  const installedRecord = readJson(ns, INSTALLED_STATE), installed = installedRecord?.manifest ?? null;
  const relation = compareRevision(installed, target);
  if (relation === "SAME_REVISION_REPULL" && !flags.repair && !flags.force) { installAliases(ns, target); ns.tprint(`ALARM SAME_REVISION_REPULL: ${target.revisionId} is already installed.`); ns.tprint("Use --repair only to restore missing/corrupt managed files at the same revision."); return; }
  if (relation === "OLDER_REVISION_DETECTED" && !flags.force) return fail(ns, `OLDER_REVISION_DETECTED installed=${installed?.revisionId ?? "unknown"}, target=${target.revisionId}`);
  if (relation === "REVISION_MISMATCH" && !flags.force) return fail(ns, "REVISION_MISMATCH: equal revisionSequence but different revisionId");

  const plan = buildPlan(ns, installed, target, Boolean(flags.repair));
  const persistent = new Set((target.persistent ?? []).map(canonicalPath));
  const changedPersistent = new Set(plan.fetch.map((f) => canonicalPath(f.path)).filter((p) => persistent.has(p)));
  const persistentRuntime = snapshotPersistentRuntime(ns, changedPersistent);
  printPlan(ns, relation, target, plan, changedPersistent);
  closeAllHomeTails(ns);

  // Unchanged persistent services stay alive. Changed persistent services are deliberately
  // recycled so the newly downloaded code actually becomes the running service.
  const persistentRestart = await stopChangedPersistent(ns, changedPersistent);
  const workers = new Set((target.runtimeEntries ?? []).filter((e) => e.worker === true).map((e) => canonicalPath(e.path)));
  const homeShutdown = await stopHomeNonPersistent(ns, persistent), remoteShutdown = await stopRemoteWorkers(ns, workers);
  if (!persistentRestart.ok || !homeShutdown.ok || !remoteShutdown.ok) {
    ns.tprint("ALARM UPDATE_ABORTED: shutdown boundary did not complete.");
    for (const p of persistentRestart.survivors) ns.tprint(`  PERSISTENT SURVIVOR ${p.filename} pid=${p.pid}`);
    for (const p of homeShutdown.survivors) ns.tprint(`  HOME SURVIVOR ${p.filename} pid=${p.pid}`);
    for (const p of remoteShutdown.survivors) ns.tprint(`  REMOTE WORKER SURVIVOR ${p.host} ${p.filename} pid=${p.pid}`);
    return;
  }

  if (ns.fileExists(STAGED_PULL, "home")) ns.rm(STAGED_PULL, "home");
  const failures = []; let pullerStaged = false;
  for (const file of plan.fetch) { const destination = file.path === PULL_PATH ? STAGED_PULL : file.path; const downloaded = await ns.wget(cacheBust(`${RAW_BASE}${file.path}`, `${target.revisionId}-${file.fileVersion}`), destination, "home"); if (!downloaded) failures.push(file.path); if (downloaded && file.path === PULL_PATH) pullerStaged = true; }
  for (const path of plan.remove) { if (path === PULL_PATH || path === HANDOFF_PATH) { failures.push(path); continue; } if (ns.fileExists(path, "home") && !ns.rm(path, "home")) failures.push(path); }
  for (const file of target.files) if (file.required) { const present = file.path === PULL_PATH && pullerStaged ? ns.fileExists(STAGED_PULL, "home") : ns.fileExists(file.path, "home"); if (!present) failures.push(file.path); }
  const uniqueFailures = [...new Set(failures)];
  if (uniqueFailures.length) { ns.tprint("ALARM UPDATE_FAILED: required target revision was not installed completely."); for (const path of uniqueFailures) ns.tprint(`  FAILED ${path}`); ns.tprint("Changed persistent services remain stopped because the target revision did not validate."); return; }

  installAliases(ns, target);
  const result = relation === "SAME_REVISION_REPULL" ? "REPAIR_COMPLETE" : installed ? "UPDATE_COMPLETE" : "FRESH_INSTALL_COMPLETE";
  const record = { installedAt: Date.now(), releaseVersion: target.releaseVersion, revisionSequence: target.revisionSequence, revisionId: target.revisionId, outcome: result, manifest: target };
  if (pullerStaged) {
    if (!ns.fileExists(HANDOFF_PATH, "home")) return fail(ns, `Self-update required but ${HANDOFF_PATH} is missing`);
    const pid = ns.exec(HANDOFF_PATH, "home", 1, "--old-pid", ns.pid, "--staged", STAGED_PULL, "--target", PULL_PATH, "--installed-state", INSTALLED_STATE, "--record", JSON.stringify(record), "--runtime", JSON.stringify(persistentRuntime));
    if (pid === 0) return fail(ns, "Could not start pull self-update handoff helper");
    ns.tprint(`Handoff helper started as PID ${pid}; pull.js will now exit.`); return;
  }
  ns.write(INSTALLED_STATE, JSON.stringify(record, null, 2), "w");
  restartRuntime(ns, persistentRuntime);
  ns.tprint(`${result}: ${target.releaseVersion} / ${target.revisionId}`);
  ns.tprint(`Pull complete. Restarted ${persistentRuntime.length} changed persistent service(s); unchanged persistent services stayed running.`);
}

function snapshotPersistentRuntime(ns, changed) { const result=[]; for (const p of ns.ps("home")) if (changed.has(canonicalPath(p.filename))) result.push({ filename: canonicalPath(p.filename), threads:p.threads, args:p.args ?? [] }); return result; }
async function stopChangedPersistent(ns, changed) { if (!changed.size) return {ok:true,survivors:[]}; for(let attempt=1;attempt<=5;attempt++){const c=ns.ps("home").filter(p=>p.pid!==ns.pid&&changed.has(canonicalPath(p.filename))); if(!c.length)return {ok:true,survivors:[]}; for(const p of c){ns.tprint(`  RESTART PERSISTENT ${p.filename} pid=${p.pid}`);ns.kill(p.pid);} await ns.sleep(100);} const survivors=ns.ps("home").filter(p=>p.pid!==ns.pid&&changed.has(canonicalPath(p.filename))); return {ok:!survivors.length,survivors}; }
function restartRuntime(ns,runtime){for(const p of runtime){const pid=ns.exec(p.filename,"home",{threads:Number(p.threads)||1},...(p.args??[])); if(pid===0)ns.tprint(`WARNING PERSISTENT_RESTART_FAILED: ${p.filename}`); else ns.tprint(`  RESTARTED PERSISTENT ${p.filename} pid=${pid}`);}}
function installAliases(ns,target){const aliases=[...TERMINAL_ALIASES];if((target.files??[]).some(f=>canonicalPath(f.path)==="/start.js"))aliases.unshift(["start","run /start.js"]);for(const[name,sub]of aliases){try{ns.ui.alias(name,sub,true);}catch(e){ns.tprint(`WARNING ALIAS_FAILED ${name}: ${String(e)}`);}}ns.tprint(`Aliases ready: ${aliases.map(([n])=>n).join(", ")}`);}
async function stopHomeNonPersistent(ns,persistent){for(let a=1;a<=5;a++){const c=ns.ps("home").filter(p=>p.pid!==ns.pid&&!persistent.has(canonicalPath(p.filename)));if(!c.length)return{ok:true,survivors:[]};for(const p of c){ns.tprint(`  STOP HOME ${p.filename} pid=${p.pid}`);ns.kill(p.pid);}await ns.sleep(100);}const s=ns.ps("home").filter(p=>p.pid!==ns.pid&&!persistent.has(canonicalPath(p.filename)));return{ok:!s.length,survivors:s};}
async function stopRemoteWorkers(ns,workers){if(!workers.size)return{ok:true,survivors:[]};const hosts=discoverNetwork(ns).filter(h=>h!=="home");for(let a=1;a<=5;a++){const c=collectRemoteWorkers(ns,hosts,workers);if(!c.length)return{ok:true,survivors:[]};for(const p of c){ns.tprint(`  STOP WORKER ${p.host} ${p.filename} pid=${p.pid}`);ns.kill(p.pid,p.host);}await ns.sleep(100);}const s=collectRemoteWorkers(ns,hosts,workers);return{ok:!s.length,survivors:s};}
function collectRemoteWorkers(ns,hosts,workers){const r=[];for(const h of hosts)for(const p of ns.ps(h))if(workers.has(canonicalPath(p.filename)))r.push({host:h,...p});return r;}
function discoverNetwork(ns){const seen=new Set(["home"]),q=["home"];for(let i=0;i<q.length;i++)for(const n of ns.scan(q[i]))if(!seen.has(n)){seen.add(n);q.push(n);}return q;}
function closeAllHomeTails(ns){for(const p of ns.ps("home")){if(p.pid===ns.pid)continue;const r=ns.getRunningScript(p.pid,"home");if(!r?.tailProperties)continue;try{ns.ui.closeTail(p.pid);}catch{}}}
function canonicalPath(path){const v=String(path??"").trim();return v.startsWith("/")?v:`/${v}`;}
function buildPlan(ns,installed,target,repair){const by=new Map((installed?.files??[]).map(f=>[f.path,f])),fetch=[],unchanged=[];for(const f of target.files){const c=by.get(f.path),missing=!ns.fileExists(f.path,"home"),changed=!c||c.fileVersion!==f.fileVersion;if(!installed||missing||changed||repair)fetch.push(f);else unchanged.push(f.path);}return{fetch,unchanged,remove:[...(target.removedFiles??[])]};}
function compareRevision(i,t){if(!i||!Number.isInteger(i.revisionSequence))return"FRESH_INSTALL";if(t.revisionSequence>i.revisionSequence)return"FORWARD_UPDATE";if(t.revisionSequence<i.revisionSequence)return"OLDER_REVISION_DETECTED";if(t.revisionId===i.revisionId)return"SAME_REVISION_REPULL";return"REVISION_MISMATCH";}
function validateManifest(m){const e=[];if(!m||typeof m!=="object")return{valid:false,errors:["manifest must be an object"]};if(!Number.isInteger(m.schemaVersion))e.push("schemaVersion missing/invalid");if(!Number.isInteger(m.revisionSequence))e.push("revisionSequence missing/invalid");if(typeof m.revisionId!=="string"||!m.revisionId)e.push("revisionId missing/invalid");if(typeof m.releaseVersion!=="string"||!m.releaseVersion)e.push("releaseVersion missing/invalid");if(!Array.isArray(m.files))e.push("files missing/invalid");if(!Array.isArray(m.runtimeEntries))e.push("runtimeEntries missing/invalid");if(!Array.isArray(m.removedFiles))e.push("removedFiles missing/invalid");if(!Array.isArray(m.persistent))e.push("persistent missing/invalid");return{valid:!e.length,errors:e};}
function readJson(ns,p){const r=ns.read(p);if(!r)return null;try{return JSON.parse(r);}catch{return null;}}
function cacheBust(url,t){return`${url}${url.includes("?")?"&":"?"}bb=${encodeURIComponent(t)}`;}
function printPlan(ns,relation,target,plan,changedPersistent){ns.tprint(`${relation}: target ${target.releaseVersion} / ${target.revisionId}`);ns.tprint(`Plan: fetch=${plan.fetch.length}, unchanged=${plan.unchanged.length}, remove=${plan.remove.length}, restartPersistent=${changedPersistent.size}`);for(const f of plan.fetch)ns.tprint(`  FETCH ${String(f.change).toUpperCase().padEnd(9)} ${f.path}${changedPersistent.has(canonicalPath(f.path))?" [RESTART]":""}`);}
function fail(ns,m){ns.tprint(`ALARM UPDATE_FAILED: ${m}`);}
