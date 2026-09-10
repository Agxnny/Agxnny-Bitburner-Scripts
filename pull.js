const RAW_BASE = "https://raw.githubusercontent.com/Agxnny/Agxnny-Bitburner-Scripts/main";
const MANIFEST_URL = `${RAW_BASE}/stack-manifest.json`;
const REMOTE_MANIFEST = "/data/state/remote-stack-manifest.json";
const INSTALLED_STATE = "/data/state/installed-revision.json";

export async function main(ns) {
  const flags = ns.flags([
    ["repair", false],
    ["force", false],
  ]);

  ns.tprint("Fetching remote stack manifest...");
  const ok = await ns.wget(MANIFEST_URL, REMOTE_MANIFEST, "home");
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

  if (relation === "OLDER_REVISION_DETECTED" && !flags.force) {
    ns.tprint(`ALARM OLDER_REVISION_DETECTED: installed=${installed?.revisionId ?? "unknown"}, target=${target.revisionId}`);
    ns.tprint("Normal update blocked. Use --force only if you deliberately intend to bypass this protection.");
    return;
  }

  if (relation === "REVISION_MISMATCH" && !flags.force) {
    ns.tprint("ALARM REVISION_MISMATCH: equal revisionSequence but different revisionId. Update blocked.");
    return;
  }

  const plan = buildPlan(ns, installed, target, Boolean(flags.repair));
  printPlan(ns, relation, target, plan);

  const failures = [];
  for (const file of plan.fetch) {
    const url = `${RAW_BASE}${file.path}`;
    const downloaded = await ns.wget(url, file.path, "home");
    if (!downloaded) failures.push(file.path);
  }

  for (const path of plan.remove) {
    if (ns.fileExists(path, "home") && !ns.rm(path, "home")) failures.push(path);
  }

  for (const file of target.files) {
    if (file.required && !ns.fileExists(file.path, "home")) failures.push(file.path);
  }

  const uniqueFailures = [...new Set(failures)];
  if (uniqueFailures.length > 0) {
    ns.tprint("ALARM UPDATE_FAILED: required target revision was not installed completely.");
    for (const path of uniqueFailures) ns.tprint(`  FAILED ${path}`);
    ns.tprint("Installed revision metadata was NOT advanced.");
    return;
  }

  const record = {
    installedAt: Date.now(),
    releaseVersion: target.releaseVersion,
    revisionSequence: target.revisionSequence,
    revisionId: target.revisionId,
    manifest: target,
  };
  ns.write(INSTALLED_STATE, JSON.stringify(record, null, 2), "w");

  const result = relation === "SAME_REVISION_REPULL" ? "REPAIR_COMPLETE" :
    installed ? "UPDATE_COMPLETE" : "FRESH_INSTALL_COMPLETE";
  ns.tprint(`${result}: ${target.releaseVersion} / ${target.revisionId}`);
  ns.tprint(`Fetched ${plan.fetch.length}, unchanged ${plan.unchanged.length}, removed ${plan.remove.length}.`);
}

function buildPlan(ns, installed, target, repair) {
  const installedByPath = new Map((installed?.files ?? []).map((f) => [f.path, f]));
  const fetch = [];
  const unchanged = [];

  for (const targetFile of target.files) {
    const current = installedByPath.get(targetFile.path);
    const missing = !ns.fileExists(targetFile.path, "home");
    const changed = !current || current.fileVersion !== targetFile.fileVersion;

    if (!installed || missing || changed || repair) fetch.push(targetFile);
    else unchanged.push(targetFile.path);
  }

  return {
    fetch,
    unchanged,
    remove: [...(target.removedFiles ?? [])],
  };
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
  else {
    const seen = new Set();
    for (const file of m.files) {
      if (!file || typeof file.path !== "string" || !file.path.startsWith("/")) errors.push("invalid file path");
      else if (seen.has(file.path)) errors.push(`duplicate file path ${file.path}`);
      else seen.add(file.path);
      if (!Number.isInteger(file.fileVersion) || file.fileVersion < 1) errors.push(`invalid fileVersion ${file.path ?? "?"}`);
    }
  }
  if (!Array.isArray(m.removedFiles)) errors.push("removedFiles missing/invalid");
  return { valid: errors.length === 0, errors };
}

function readJson(ns, path) {
  const raw = ns.read(path);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function printPlan(ns, relation, target, plan) {
  ns.tprint(`${relation}: target ${target.releaseVersion} / ${target.revisionId}`);
  ns.tprint(`Plan: fetch=${plan.fetch.length}, unchanged=${plan.unchanged.length}, remove=${plan.remove.length}`);
  for (const f of plan.fetch) ns.tprint(`  FETCH ${f.change.toUpperCase().padEnd(9)} ${f.path}`);
  for (const path of plan.remove) ns.tprint(`  REMOVE ${path}`);
}

function fail(ns, message) {
  ns.tprint(`ALARM UPDATE_FAILED: ${message}`);
}
