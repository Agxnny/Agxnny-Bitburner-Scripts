import { PATHS } from "/core/config.js";
import { HEALTH } from "/core/contracts.js";
import { publishDomainState, readJson } from "/core/state.js";
import { ACTIVE_TESTS } from "/validation/registry.js";

export async function main(ns) {
  ns.disableLog("ALL");
  const startedAt = Date.now();
  const results = [];

  for (const test of ACTIVE_TESTS) {
    results.push(await runTest(ns, test));
  }

  const failed = results.filter((r) => r.health === HEALTH.FAIL || r.health === HEALTH.BLOCKED);
  const degraded = results.filter((r) => r.health === HEALTH.DEGRADED);
  const status = failed.length > 0 ? HEALTH.FAIL : degraded.length > 0 ? HEALTH.DEGRADED : HEALTH.PASS;

  publishDomainState(ns, PATHS.activeValidationState, {
    domain: "active-validation",
    source: ns.getScriptName(),
    valid: failed.length === 0,
    data: {
      status,
      startedAt,
      completedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      total: results.length,
      passed: results.filter((r) => r.health === HEALTH.PASS).length,
      failed: failed.length,
      degraded: degraded.length,
      results,
    },
  });

  ns.tprint(`Active validation: ${status} (${results.filter((r) => r.health === HEALTH.PASS).length}/${results.length} PASS)`);
  for (const result of results) ns.tprint(`  ${result.health.padEnd(8)} ${result.label}${result.message ? ` — ${result.message}` : ""}`);
}

async function runTest(ns, test) {
  if (!ns.fileExists(test.script, "home")) {
    return result(test, HEALTH.FAIL, "test script missing");
  }

  const launchedAt = Date.now();
  const pid = ns.exec(test.script, "home", 1, ...(test.args ?? []));
  if (pid === 0) return result(test, HEALTH.BLOCKED, "could not start test script");

  const timeoutMs = Math.max(1_000, Number(test.timeoutMs) || 15_000);
  while (ns.isRunning(pid, "home") && Date.now() - launchedAt < timeoutMs) await ns.sleep(50);

  if (ns.isRunning(pid, "home")) {
    ns.kill(pid);
    return result(test, HEALTH.FAIL, `timed out after ${timeoutMs}ms`);
  }

  const snapshot = readJson(ns, test.resultPath, null);
  if (!snapshot) return result(test, HEALTH.FAIL, `no result state at ${test.resultPath}`);
  if ((snapshot.generatedAt ?? 0) < launchedAt) return result(test, HEALTH.FAIL, "result state was not refreshed by this run");

  return result(test, deriveHealth(snapshot), null, snapshot.generatedAt ?? null);
}

function deriveHealth(snapshot) {
  if (snapshot.valid === false) return HEALTH.FAIL;
  const data = snapshot.data ?? {};
  if (data.status === HEALTH.FAIL || data.health === HEALTH.FAIL) return HEALTH.FAIL;
  if (data.status === HEALTH.BLOCKED || data.health === HEALTH.BLOCKED) return HEALTH.BLOCKED;
  if (data.status === HEALTH.DEGRADED || data.health === HEALTH.DEGRADED) return HEALTH.DEGRADED;
  if (data.status === HEALTH.PASS || data.health === HEALTH.PASS) return HEALTH.PASS;
  if (data.status === "CURRENT") return HEALTH.PASS;
  if (Number.isFinite(data.total) && Number.isFinite(data.passed)) return data.total > 0 && data.total === data.passed ? HEALTH.PASS : HEALTH.FAIL;
  return snapshot.valid ? HEALTH.PASS : HEALTH.UNTESTED;
}

function result(test, health, message = null, generatedAt = null) {
  return { id: test.id, label: test.label, script: test.script, health, message, generatedAt };
}
