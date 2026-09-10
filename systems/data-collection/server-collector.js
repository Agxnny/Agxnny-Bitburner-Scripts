import { PATHS } from "/core/config.js";
import { HEALTH } from "/core/contracts.js";
import { publishDomainState } from "/core/state.js";
import { discoverNetwork } from "/systems/data-collection/network.js";

const DEFAULT_INTERVAL_MS = 1000;

export async function main(ns) {
  const flags = ns.flags([["once", false], ["interval", DEFAULT_INTERVAL_MS]]);
  ns.disableLog("scan");
  ns.disableLog("sleep");

  do {
    const startedAt = Date.now();
    try {
      const hosts = discoverNetwork(ns).map((hostname) => collectServer(ns, hostname));
      const data = {
        health: HEALTH.UNTESTED,
        hostCount: hosts.length,
        rootedCount: hosts.filter((s) => s.hasAdminRights).length,
        ramHostCount: hosts.filter((s) => s.hasAdminRights && s.maxRam > 0).length,
        hosts,
        collectionDurationMs: Date.now() - startedAt,
      };

      publishDomainState(ns, PATHS.serverState, {
        domain: "servers",
        source: ns.getScriptName(),
        data,
      });
    } catch (error) {
      ns.print(`ERROR server collection failed: ${String(error)}`);
    }

    if (flags.once) break;
    await ns.sleep(Math.max(500, Number(flags.interval) || DEFAULT_INTERVAL_MS));
  } while (true);
}

function collectServer(ns, hostname) {
  const s = ns.getServer(hostname);
  return {
    hostname,
    purchasedByPlayer: Boolean(s.purchasedByPlayer),
    hasAdminRights: Boolean(s.hasAdminRights),
    backdoorInstalled: Boolean(s.backdoorInstalled),
    requiredHackingSkill: s.requiredHackingSkill ?? 0,
    numOpenPortsRequired: s.numOpenPortsRequired ?? 0,
    moneyAvailable: s.moneyAvailable ?? 0,
    moneyMax: s.moneyMax ?? 0,
    hackDifficulty: s.hackDifficulty ?? 0,
    minDifficulty: s.minDifficulty ?? 0,
    maxRam: s.maxRam ?? 0,
    ramUsed: s.ramUsed ?? 0,
    cpuCores: s.cpuCores ?? 1,
    organizationName: s.organizationName ?? "",
  };
}
