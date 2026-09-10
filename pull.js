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
  const runtimeState = snapshotManagedRuntime(ns, target);
  closeManagedTails(ns, runtimeState);
  stopForUpdate(ns, runtimeState, target, plan);

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
    restoreRuntime(ns, runtimeState);
    return;
  }

  const result = relation === "SAME_REVISION_REPULL" ? "REPAIR_COMPLETE" : installed ? "UPDATE_COMPLETE" : "FRESH_INSTALL_COMPLETE";
  const record = { installedAt: Date.now(), releaseVersion: target.releaseVersion, revisionSequence: target.revisionSequence, revisionId: target.revisionId, outcome: result, manifest: target };

  if (pullerStaged) {
    if (!ns.fileExists(HANDOFF_PATH, "home")) { restoreRuntime(ns, runtimeState); return fail(ns, `Self-update required but ${HANDOFF_PATH} is missing`); }
    const handoffPid = ns.exec(HANDOFF_PATH, "home", 1, "--old-pid", ns.pid, "--staged", STAGED_PULL, "--target", PULL_PATH, "--installed-state", INSTALLED_STATE, "--record", JSON.stringify(record), "--runtime", JSON.stringify(runtimeState));
    if (handoffPid === 0) { restoreRuntime(ns, runtimeState); return fail(ns, "Could not start pull self-update handoff helper"); }
    ns.tprint(`Handoff helper started as PID ${handoffPid}; pull.js will now exit.`);
    return;
  }

  ns.write(INSTALLED_STATE, JSON.stringify(record, null, 2), "w");
  restoreRuntime(ns, runtimeState);
  ns.tprint(`${result}: ${target.releaseVersion} / ${target.revisionId}`);
}

function snapshotManagedRuntime(ns, manifest) {
  const managed = new Set((manifest.runtimeEntries ?? []).map((e) => e.path));
  const processes = [];
  for (const p of ns.ps("home")) {
    if (!managed.has(p.filename) || p.pid === ns.pid) continue;
    const running = ns.getRunningScript(p.pid, "home");
    processes.push({ pid: p.pid, filename: p.filename, threads: p.threads, args: p.args, tail: running?.tailProperties ? { ...running.tailProperties } : null });
  }
  return processes;
}
function closeManagedTails(ns, runtime) { for (const p of runtime) if (p.tail) try { ns.ui.closeTail(p.pid); } catch {} }
function stopForUpdate(ns, runtime, manifest, plan) {
  const persistent = new Set(manifest.persistent ?? []);
  const changed = new Set(plan.fetch.map((f) => f.path));
  const removed = new Set(plan.remove);
  for (const p of runtime) {
    const mustRecycle = !persistent.has(p.filename) || changed.has(p.filename) || removed.has(p.filename);
    if (mustRecycle && ns.isRunning(p.pid, "home")) {
      ns.tprint(`  STOP ${persistent.has(p.filename) ? "CHANGED PERSISTENT" : "NON-PERSISTENT"} ${p.filename}`);
      ns.kill(p.pid);
    }
  }
}
function restoreRuntime(ns, runtime) {
  for (const p of runtime) {
    let pid = p.pid;
    if (!ns.isRunning(pid, "home")) {
      if (!ns.fileExists(p.filename, "home")) continue;
      pid = ns.exec(p.filename, "home", { threads: p.threads }, ...p.args);
      if (pid === 0) { ns.tprint(`WARNING RESTART_FAILED: ${p.filename}`); continue; }
      ns.tprint(`  RESTART ${p.filename} pid=${pid}`);
    }
    if (p.tail) restoreTail(ns, pid, p.tail);
  }
}
function restoreTail(ns, pid, tail) { try { ns.ui.openTail(pid); ns.ui.moveTail(tail.x, tail.y, pid); ns.ui.resizeTail(tail.width, tail.height, pid); } catch (error) { ns.tprint(`WARNING TAIL_RESTORE_FAILED pid=${pid}: ${String(error)}`); } }
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
function compareRevision(installed, target) { if (!installed || !Number.isInteger(installed.revisionSequence)) return "FRESH_INSTALL"; if (target.revisionSequence > installed.revisionSequence) return "FORWARD_UPDATE"; if (target.revisionSequence < installed.revisionSequence) return "OLDER_REVISION_DETECTED"; if (target.revisionId === installed.revisionId) return "SAME_REVISION_REPULL"; return "REVISION_MISMATCH"; }
function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== "object") return { valid: false, errors: ["manifest must be an object"] };
  if (!Number.isInteger(m.schemaVersion)) errors.push("schemaVersion missing/invalid");
  if (!Number.isInteger(m.revisionSequence)) errors.push("revisionSequence missing/invalid");
  if (typeof m.revisionId !== "string" || !m.revisionId) errors.push("revisionId missing/invalid");
  if (typeof m.releaseVersion !== "string" || !m.releaseVersion) errors.push("releaseVersion missing/invalid");
  if (!Array.isArray(m.files)) errors.push("files missing/invalid");
  else { const seen = new Set(); for (const file of m.files) { if (!file || typeof file.path !== "string" || !file.path.startsWith("/")) errors.push("invalid file path"); else if (seen.has(file.path)) errors.push(`duplicate file path ${file.path}`); else seen.add(file.path); if (!Number.isInteger(file.fileVersion) || file.fileVersion < 1) errors.push(`invalid fileVersion ${file.path ?? "?"}`); } }
  if (!Array.isArray(m.removedFiles)) errors.push("removedFiles missing/invalid");
  return { valid: errors.length === 0, errors };
}
function readJson(ns, path) { const raw = ns.read(path); if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } }
function cacheBust(url, token) { return `${url}${url.includes("?") ? "&" : "?"}bb=${encodeURIComponent(token)}`; }
function printPlan(ns, relation, target, plan) { ns.tprint(`${relation}: target ${target.releaseVersion} / ${target.revisionId}`); ns.tprint(`Plan: fetch=${plan.fetch.length}, unchanged=${plan.unchanged.length}, remove=${plan.remove.length}`); for (const f of plan.fetch) ns.tprint(`  FETCH ${f.change.toUpperCase().padEnd(9)} ${f.path}`); }
function fail(ns, message) { ns.tprint(`ALARM UPDATE_FAILED: ${message}`); }
