const PROCESSES = [
  "/systems/data-collection/resource-collector.js",
  "/systems/data-collection/server-collector.js",
  "/systems/data-collection/player-collector.js",
];

const ONE_SHOTS = [
  "/systems/ram-audit/audit.js",
  "/systems/data-collection/update/validate.js",
  "/systems/data-collection/update/watcher.js",
];

const DASHBOARD = "/ui/validation-dashboard.js";

export async function main(ns) {
  const flags = ns.flags([["no-dashboard", false]]);

  for (const script of PROCESSES) {
    if (!ns.fileExists(script, "home")) {
      ns.tprint(`Missing required validation process: ${script}`);
      continue;
    }
    if (!ns.isRunning(script, "home")) {
      const pid = ns.run(script, 1);
      if (pid === 0) ns.tprint(`Failed to start ${script}`);
    }
  }

  for (const script of ONE_SHOTS) {
    if (!ns.fileExists(script, "home")) {
      ns.tprint(`Missing validation helper: ${script}`);
      continue;
    }
    ns.run(script, 1);
  }

  if (!flags["no-dashboard"] && ns.fileExists(DASHBOARD, "home") && !ns.isRunning(DASHBOARD, "home")) {
    const pid = ns.run(DASHBOARD, 1);
    if (pid === 0) ns.tprint(`Failed to start ${DASHBOARD}`);
  }
}
