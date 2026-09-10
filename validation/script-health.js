import { PATHS } from "/core/config.js";
import { HEALTH } from "/core/contracts.js";
import { publishDomainState, readJson } from "/core/state.js";

export async function main(ns) {
  ns.disableLog("ALL");
  const startedAt = Date.now();
  const manifest = readJson(ns, PATHS.manifest, null);

  if (!manifest || !Array.isArray(manifest.runtimeEntries)) {
    publish(ns, HEALTH.FAIL, startedAt, [], ["Manifest/runtimeEntries unavailable"]);
    ns.tprint("Script health: FAIL — manifest/runtimeEntries unavailable");
    return;
  }

  const persistent = new Set(manifest.persistent ?? []);
  const rows = [];
  const problems = [];

  for (const entry of manifest.runtimeEntries) {
    const path = entry.path;
    const exists = ns.fileExists(path, "home");
    let ram = 0;
    try { ram = exists ? ns.getScriptRam(path, "home") : 0; } catch {}

    const running = ns.ps("home").filter((p) => p.filename === path);
    const shouldRun = persistent.has(path);
    let health = HEALTH.PASS;
    const notes = [];

    if (!exists) { health = entry.required === false ? HEALTH.DEGRADED : HEALTH.FAIL; notes.push("file missing"); }
    else if (!(ram > 0)) { health = HEALTH.FAIL; notes.push("invalid script RAM"); }

    if (shouldRun && running.length === 0) { health = HEALTH.FAIL; notes.push("persistent process not running"); }
    if (shouldRun && running.length > 1) { health = HEALTH.DEGRADED; notes.push(`${running.length} duplicate persistent processes`); }

    rows.push({ path, role: entry.role ?? "unknown", lifecycle: entry.lifecycle ?? "transient", required: entry.required !== false, exists, ram, runningCount: running.length, health, notes });
    if (health === HEALTH.FAIL || health === HEALTH.DEGRADED) problems.push(`${path}: ${notes.join(", ")}`);
  }

  const status = rows.some((r) => r.health === HEALTH.FAIL) ? HEALTH.FAIL : rows.some((r) => r.health === HEALTH.DEGRADED) ? HEALTH.DEGRADED : HEALTH.PASS;
  publish(ns, status, startedAt, rows, problems);

  ns.tprint(`Script health: ${status} (${rows.filter((r) => r.health === HEALTH.PASS).length}/${rows.length} PASS)`);
  for (const problem of problems) ns.tprint(`  ${problem}`);
}

function publish(ns, status, startedAt, rows, problems) {
  publishDomainState(ns, PATHS.scriptHealthState, {
    domain: "script-health",
    source: ns.getScriptName(),
    valid: status !== HEALTH.FAIL,
    data: {
      status,
      startedAt,
      completedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      total: rows.length,
      passed: rows.filter((r) => r.health === HEALTH.PASS).length,
      degraded: rows.filter((r) => r.health === HEALTH.DEGRADED).length,
      failed: rows.filter((r) => r.health === HEALTH.FAIL).length,
      problems,
      scripts: rows,
    },
  });
}
