const RAW_BASE = "https://raw.githubusercontent.com/Agxnny/Agxnny-Bitburner-Scripts/main";
const MANIFEST_URL = `${RAW_BASE}/stack-manifest.json`;
const REMOTE_MANIFEST = "/data/state/remote-stack-manifest.json";
const INSTALLED_STATE = "/data/state/installed-revision.json";
const PULL_PATH = "/pull.js";
const STAGED_PULL = "/data/state/pull.next.js";
const HANDOFF_PATH = "/pull-handoff.js";

export async function main(ns) {
  const flags = ns.flags([["repair", false], ["force", false]]);
  ns.tprint("Fetching remote stack manifest...");
  const ok = await ns.wget(cacheBust(MANIFEST_URL, `check-${Date.now()}`), REMOTE_MANIFEST, "home");
  if (!ok) return fail(ns, "Could not download remote manifest");

  const target = readJson(ns, REMOTE_MANIFEST);
  const validation = validateManifest(target);
  if (!validation.valid) return fail(ns, `Remote manifest invalid: ${validation.errors.join("; ")}`);

  const installedRecord = readJson(ns, INSTALLED_STATE);
  const installed = installedRecord?.manifest ?? null;
  const relation = compareRevision(installed, target);

  if (relation === "SAME_REVISION_REPULL" && !flags.repair && !flags.force) {
    ns.tprint(`ALARM SAME_REVISION_REPULL: ${target.revisionId} is already installed.`);
    ns.tprint("Use --repair only to restore missing/corrupt managed files at the same revision.");
    return;
  }
  if (relation === "OLDER_REVISION_DETECTED" && !flags.force) return fail(ns, `OLDER_REVISION_DETECTED installed=${installed?.revisionId ?? "unknown"}, target=${target.revisionId}`);
  if (relation === "REVISION_MISMATCH" && !flags.force) return fail(ns, "REVISION_MISMATCH: equal revisionSequence but different revisionId");

  const plan = buildPlan(ns, installed, target, Boolean(flags.repair));
  printPlan(ns, relation, target, plan);

  closeAllHomeTails(ns);

  const persistent = new Set((target.persistent ?? []).map(canonicalPath));
  const workers = new Set((target.runtimeEntries ?? []).filter((entry) => entry.worker === true).map((entry) => canonicalPath(entry.path)));

  const homeShutdown = await stopHomeNonPersistent(ns, persistent);
  const remoteShutdown = await stopRemoteWorkers(ns, workers);

  if (!homeShutdown.ok || !remoteShutdown.ok) {
    ns.tprint("ALARM UPDATE_ABORTED: shutdown boundary did not complete.");
    for (const p of homeShutdown.survivors) ns.tprint(`  HOME SURVIVOR ${p.filename} pid=${p.pid}`);
    for (const p of remoteShutdown.survivors) ns.tprint(`  REMOTE WORKER SURVIVOR ${p.host} ${p.filename} pid=${p.pid}`);
    return;
  }

  if (ns.fileExists(STAGED_PULL, "home")) ns.rm(STAGED_PULL, "home");
  const failures = [];
  let pullerStaged = false;

  for (const file of plan.fetch) {
    const destination = file.path === PULL_PATH ? STAGED_PULL : file.path;
    const downloaded = await ns.wget(cacheBust(`${RAW_BASE}${file.path}`, `${target.revisionId}-${file.fileVersion}`), destination, "home");
    if (!downloaded) failures.push(file.path);
    if (downloaded && file.path === PULL_PATH) pullerStaged = true;
  }

  for (const path of plan.remove) {
    if (path === PULL_PATH || path === HANDOFF_PATH) { failures.push(path); continue; }
    if (ns.fileExists(path, "home") && !ns.rm(path, "home")) failures.push(path);
  }

  for (const file of target.files) {
    if (!file.required) continue;
    const present = file.path === PULL_PATH && pullerStaged ? ns.fileExists(STAGED_PULL, "home") : ns.fileExists(file.path, "home");
    if (!present) failures.push(file.path);
  }

  const uniqueFailures = [...new Set(failures)];
  if (uniqueFailures.length) {
    ns.tprint("ALARM UPDATE_FAILED: required target revision was not installed completely.");
    for (const path of uniqueFailures) ns.tprint(`  FAILED ${path}`);
    ns.tprint("Persistent scripts were left alone; stopped non-persistent and worker scripts remain stopped.");
    return;
  }

  const result = relation === "SAME_REVISION_REPULL" ? "REPAIR_COMPLETE" : installed ? "UPDATE_COMPLETE" : "FRESH_INSTALL_COMPLETE";
  const record = { installedAt: Date.now(), releaseVersion: target.releaseVersion, revisionSequence: target.revisionSequence, revisionId: target.revisionId, outcome: result, manifest: target };

  if (pullerStaged) {
    if (!ns.fileExists(HANDOFF_PATH, "home")) return fail(ns, `Self-update required but ${HANDOFF_PATH} is missing`);
    const handoffPid = ns.exec(HANDOFF_PATH, "home", 1,
      "--old-pid", ns.pid,
      "--staged", STAGED_PULL,
      "--target", PULL_PATH,
      "--installed-state", INSTALLED_STATE,
      "--record", JSON.stringify(record),
      "--runtime", "[]",
    );
    if (handoffPid === 0) return fail(ns, "Could not start pull self-update handoff helper");
    ns.tprint(`Handoff helper started as PID ${handoffPid}; pull.js will now exit.`);
    return;
  }

  ns.write(INSTALLED_STATE, JSON.stringify(record, null, 2), "w");
  ns.tprint(`${result}: ${target.releaseVersion} / ${target.revisionId}`);
  ns.tprint("Pull complete. Manifest-persistent home scripts were left running; all other home scripts and all manifest worker scripts on remote hosts remain stopped.");
}

async function stopHomeNonPersistent(ns, persistent) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const candidates = ns.ps("home").filter((p) => p.pid !== ns.pid && !persistent.has(canonicalPath(p.filename)));
    if (candidates.length === 0) return { ok: true, survivors: [] };
    for (const p of candidates) {
      ns.tprint(`  STOP HOME ${p.filename} pid=${p.pid}`);
      ns.kill(p.pid);
    }
    await ns.sleep(100);
  }
  const survivors = ns.ps("home").filter((p) => p.pid !== ns.pid && !persistent.has(canonicalPath(p.filename)));
  return { ok: survivors.length === 0, survivors };
}

async function stopRemoteWorkers(ns, workers) {
  if (workers.size === 0) return { ok: true, survivors: [] };
  const hosts = discoverNetwork(ns).filter((host) => host !== "home");

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const candidates = collectRemoteWorkers(ns, hosts, workers);
    if (candidates.length === 0) return { ok: true, survivors: [] };
    for (const p of candidates) {
      ns.tprint(`  STOP WORKER ${p.host} ${p.filename} pid=${p.pid}`);
      ns.kill(p.pid, p.host);
    }
    await ns.sleep(100);
  }

  const survivors = collectRemoteWorkers(ns, hosts, workers);
  return { ok: survivors.length === 0, survivors };
}

function collectRemoteWorkers(ns, hosts, workers) {
  const result = [];
  for (const host of hosts) {
    for (const p of ns.ps(host)) {
      if (workers.has(canonicalPath(p.filename))) result.push({ host, ...p });
    }
  }
  return result;
}

function discoverNetwork(ns) {
  const seen = new Set(["home"]);
  const queue = ["home"];
  for (let i = 0; i < queue.length; i += 1) {
    for (const next of ns.scan(queue[i])) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return queue;
}

function closeAllHomeTails(ns) {
  for (const p of ns.ps("home")) {
    if (p.pid === ns.pid) continue;
    const running = ns.getRunningScript(p.pid, "home");
    if (!running?.tailProperties) continue;
    try { ns.ui.closeTail(p.pid); } catch {}
  }
}

function canonicalPath(path) {
  const value = String(path ?? "").trim();
  return value.startsWith("/") ? value : `/${value}`;
}

function buildPlan(ns, installed, target, repair) {
  const installedByPath = new Map((installed?.files ?? []).map((f) => [f.path, f]));
  const fetch = [], unchanged = [];
  for (const targetFile of target.files) {
    const current = installedByPath.get(targetFile.path);
    const missing = !ns.fileExists(targetFile.path, "home");
    const changed = !current || current.fileVersion !== targetFile.fileVersion;
    if (!installed || missing || changed || repair) fetch.push(targetFile); else unchanged.push(targetFile.path);
  }
  return { fetch, unchanged, remove: [...(target.removedFiles ?? [])] };
}

function compareRevision(installed, target) {
  if (!installed || !Number.isInteger(installed.revisionSequence)) return "FRESH_INSTALL";
  if (target.revisionSequence > installed.revisionSequence) return "FORWARD_UPDATE";
  if (target.revisionSequence < installed.revisionSequence) return "OLDER_REVISION_DETECTED";
  if (target.revisionId === installed.revisionId) return "SAME_REVISION_REPULL";
  return "REVISION_MISMATCH";
}

function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== "object") return { valid: false, errors: ["manifest must be an object"] };
  if (!Number.isInteger(m.schemaVersion)) errors.push("schemaVersion missing/invalid");
  if (!Number.isInteger(m.revisionSequence)) errors.push("revisionSequence missing/invalid");
  if (typeof m.revisionId !== "string" || !m.revisionId) errors.push("revisionId missing/invalid");
  if (typeof m.releaseVersion !== "string" || !m.releaseVersion) errors.push("releaseVersion missing/invalid");
  if (!Array.isArray(m.files)) errors.push("files missing/invalid");
  if (!Array.isArray(m.runtimeEntries)) errors.push("runtimeEntries missing/invalid");
  if (!Array.isArray(m.removedFiles)) errors.push("removedFiles missing/invalid");
  if (!Array.isArray(m.persistent)) errors.push("persistent missing/invalid");
  if (Array.isArray(m.files)) {
    const seen = new Set();
    for (const file of m.files) {
      if (!file || typeof file.path !== "string" || !file.path.startsWith("/")) errors.push("invalid file path");
      else if (seen.has(file.path)) errors.push(`duplicate file path ${file.path}`);
      else seen.add(file.path);
      if (!Number.isInteger(file.fileVersion) || file.fileVersion < 1) errors.push(`invalid fileVersion ${file.path ?? "?"}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function readJson(ns, path) { const raw = ns.read(path); if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } }
function cacheBust(url, token) { return `${url}${url.includes("?") ? "&" : "?"}bb=${encodeURIComponent(token)}`; }
function printPlan(ns, relation, target, plan) {
  ns.tprint(`${relation}: target ${target.releaseVersion} / ${target.revisionId}`);
  ns.tprint(`Plan: fetch=${plan.fetch.length}, unchanged=${plan.unchanged.length}, remove=${plan.remove.length}`);
  for (const f of plan.fetch) ns.tprint(`  FETCH ${f.change.toUpperCase().padEnd(9)} ${f.path}`);
}
function fail(ns, message) { ns.tprint(`ALARM UPDATE_FAILED: ${message}`); }
