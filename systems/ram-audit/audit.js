import { PATHS } from "/core/config.js";
import { HEALTH } from "/core/contracts.js";
import { publishDomainState, readJson } from "/core/state.js";

export async function main(ns) {
  const startedAt = Date.now();
  const manifest = readJson(ns, PATHS.manifest, null);
  const stackVersion = ns.read(PATHS.version).trim() || "UNKNOWN";

  if (!manifest || !Array.isArray(manifest.runtimeEntries)) {
    ns.tprint("RAM Audit: invalid or missing stack manifest/runtimeEntries.");
    publishFailure(ns, stackVersion, startedAt, "INVALID_MANIFEST");
    return;
  }

  const measurements = [];
  const failures = [];

  for (const entry of manifest.runtimeEntries) {
    const result = measureEntry(ns, entry);
    measurements.push(result);
    if (!result.valid && entry.required !== false) failures.push(result.path);
  }

  const status = failures.length === 0 ? HEALTH.UNTESTED : HEALTH.FAIL;
  const summary = summarize(measurements);

  const data = {
    status,
    stackVersion,
    manifestSchemaVersion: manifest.schemaVersion ?? null,
    generatedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    scriptCount: measurements.length,
    requiredFailureCount: failures.length,
    requiredFailures: failures,
    summary,
    measurements,
  };

  publishDomainState(ns, PATHS.ramAudit, {
    domain: "ram-audit",
    source: ns.getScriptName(),
    valid: failures.length === 0,
    data,
  });

  printReport(ns, data);
}

function measureEntry(ns, entry) {
  const path = entry.path;
  let ram = 0;
  let valid = false;
  let error = null;

  try {
    ram = ns.getScriptRam(path, "home");
    valid = Number.isFinite(ram) && ram > 0;
    if (!valid) error = "NO_MEASURABLE_RAM";
  } catch (caught) {
    error = String(caught);
  }

  return {
    path,
    role: entry.role ?? "unknown",
    mode: entry.mode ?? "shared",
    lifecycle: entry.lifecycle ?? "transient",
    required: entry.required !== false,
    worker: entry.worker === true,
    ramPerThread: ram,
    valid,
    error,
  };
}

function summarize(measurements) {
  const valid = measurements.filter((item) => item.valid);
  return {
    measuredRamTotal: valid.reduce((sum, item) => sum + item.ramPerThread, 0),
    persistentRam: valid
      .filter((item) => item.lifecycle === "persistent")
      .reduce((sum, item) => sum + item.ramPerThread, 0),
    transientRam: valid
      .filter((item) => item.lifecycle !== "persistent")
      .reduce((sum, item) => sum + item.ramPerThread, 0),
    workerCosts: Object.fromEntries(
      valid.filter((item) => item.worker).map((item) => [item.path, item.ramPerThread]),
    ),
  };
}

function publishFailure(ns, stackVersion, startedAt, reason) {
  publishDomainState(ns, PATHS.ramAudit, {
    domain: "ram-audit",
    source: ns.getScriptName(),
    valid: false,
    data: {
      status: HEALTH.FAIL,
      stackVersion,
      generatedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      reason,
    },
  });
}

function printReport(ns, data) {
  ns.tprint(`RAM Audit ${data.stackVersion}: ${data.status}`);
  ns.tprint(`Measured entrypoints: ${data.scriptCount}`);
  ns.tprint(`Persistent entry RAM: ${formatRam(data.summary.persistentRam)}`);
  ns.tprint(`Transient entry RAM: ${formatRam(data.summary.transientRam)}`);

  if (data.requiredFailures.length > 0) {
    ns.tprint(`Required measurement failures: ${data.requiredFailures.join(", ")}`);
  }

  const largest = [...data.measurements]
    .filter((item) => item.valid)
    .sort((a, b) => b.ramPerThread - a.ramPerThread)
    .slice(0, 10);

  for (const item of largest) {
    ns.tprint(`${formatRam(item.ramPerThread).padStart(10)}  ${item.path}`);
  }
}

function formatRam(value) {
  return `${Number(value || 0).toFixed(2)} GB`;
}
