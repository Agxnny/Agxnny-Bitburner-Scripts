import { PATHS, REPOSITORY } from "/core/config.js";
import { HEALTH, SEVERITY } from "/core/contracts.js";
import { publishDomainState, readJson } from "/core/state.js";
import { buildChangePlan, compareRevisions, summarizeManifest, validateManifest } from "/systems/data-collection/update/manifest.js";
import { readInstalledRevision, summarizeInstalledRecord } from "/systems/data-collection/update/installed-state.js";

const DEFAULT_INTERVAL_MS = 60_000;

export async function main(ns) {
  const flags = ns.flags([["once", false], ["interval", DEFAULT_INTERVAL_MS]]);
  ns.disableLog("wget");
  ns.disableLog("sleep");

  do {
    const result = await checkForUpdates(ns);
    publishDomainState(ns, PATHS.updateState, {
      domain: "repository-update",
      source: "/systems/data-collection/update/watcher.js",
      valid: result.valid,
      data: result,
    });
    printSummary(ns, result);
    if (flags.once) break;
    await ns.sleep(Math.max(5_000, Number(flags.interval) || DEFAULT_INTERVAL_MS));
  } while (true);
}

export async function checkForUpdates(ns) {
  const checkedAt = Date.now();
  const installedRecord = readInstalledRevision(ns, PATHS.installedRevision);
  const localManifest = readJson(ns, PATHS.manifest, null);
  const localValidation = validateManifest(localManifest);

  if (!localValidation.valid) return failureResult({ checkedAt, status: "LOCAL_MANIFEST_INVALID", message: "Local stack manifest is missing or invalid.", errors: localValidation.errors, installedRecord, localManifest });

  const manifestUrl = `${REPOSITORY.manifestUrl}${REPOSITORY.manifestUrl.includes("?") ? "&" : "?"}bb=${checkedAt}`;
  const downloaded = await ns.wget(manifestUrl, PATHS.remoteManifestTemp, "home");
  if (!downloaded) return failureResult({ checkedAt, status: "CHECK_FAILED", message: "Failed to download remote stack manifest.", installedRecord, localManifest });

  const remoteManifest = readJson(ns, PATHS.remoteManifestTemp, null);
  const remoteValidation = validateManifest(remoteManifest);
  if (!remoteValidation.valid) return failureResult({ checkedAt, status: "REMOTE_MANIFEST_INVALID", message: "Remote stack manifest failed validation.", errors: remoteValidation.errors, installedRecord, localManifest, remoteManifest });

  const installedManifest = installedRecord?.manifest ?? null;
  const status = compareRevisions(installedRecord, remoteManifest);
  const changePlan = buildChangePlan(ns, installedManifest ?? localManifest, remoteManifest);
  const alarm = classifyAlarm(status);

  return {
    valid: !["REVISION_MISMATCH"].includes(status),
    checkedAt,
    health: healthForStatus(status),
    severity: alarm.severity,
    alarm: alarm.active,
    status,
    message: alarm.message,
    repository: { owner: REPOSITORY.owner, name: REPOSITORY.name, branch: REPOSITORY.branch },
    installed: summarizeInstalledRecord(installedRecord),
    localManifest: summarizeManifest(localManifest),
    remote: summarizeManifest(remoteManifest),
    changes: changePlan,
    errors: [],
  };
}

function failureResult({ checkedAt, status, message, errors = [], installedRecord = null, localManifest = null, remoteManifest = null }) {
  return {
    valid: false,
    checkedAt,
    health: HEALTH.FAIL,
    severity: SEVERITY.ERROR,
    alarm: true,
    status,
    message,
    repository: { owner: REPOSITORY.owner, name: REPOSITORY.name, branch: REPOSITORY.branch },
    installed: summarizeInstalledRecord(installedRecord),
    localManifest: summarizeManifest(localManifest),
    remote: summarizeManifest(remoteManifest),
    changes: null,
    errors,
  };
}

function classifyAlarm(status) {
  switch (status) {
    case "CURRENT": return { active: false, severity: SEVERITY.INFO, message: "Installed revision is current." };
    case "UPDATE_AVAILABLE": return { active: false, severity: SEVERITY.INFO, message: "A newer managed-stack revision is available." };
    case "SAME_REVISION": return { active: true, severity: SEVERITY.WARN, message: "Remote manifest matches the installed revision. Re-pulling it must not be reported as a new update." };
    case "REMOTE_OLDER": return { active: true, severity: SEVERITY.ERROR, message: "Remote manifest is older than the installed revision. Normal update flow must be blocked." };
    case "REVISION_MISMATCH": return { active: true, severity: SEVERITY.ERROR, message: "Remote revision uses the installed sequence with a different revision ID. Treat metadata as inconsistent." };
    case "LOCAL_REVISION_UNKNOWN": return { active: true, severity: SEVERITY.WARN, message: "No trustworthy installed-revision record exists. Treat this as fresh/recovery state until explicitly adopted or installed." };
    default: return { active: true, severity: SEVERITY.ERROR, message: `Unknown update status: ${status}` };
  }
}

function healthForStatus(status) {
  switch (status) {
    case "CURRENT":
    case "UPDATE_AVAILABLE": return HEALTH.PASS;
    case "SAME_REVISION":
    case "LOCAL_REVISION_UNKNOWN": return HEALTH.DEGRADED;
    case "REMOTE_OLDER":
    case "REVISION_MISMATCH": return HEALTH.FAIL;
    default: return HEALTH.DEGRADED;
  }
}

function printSummary(ns, result) {
  const prefix = result.alarm ? "[ALARM]" : "[UPDATE]";
  ns.print(`${prefix} ${result.status}: ${result.message}`);
}
