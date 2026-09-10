import { PATHS, FRESHNESS_MS } from "/core/config.js";
import { HEALTH } from "/core/contracts.js";
import { publishDomainState } from "/core/state.js";
import { discoverNetwork, rootedRamHosts } from "/systems/data-collection/network.js";

export async function main(ns) {
  const flags = ns.flags([
    ["once", false],
    ["interval", FRESHNESS_MS.fast],
  ]);

  ns.disableLog("scan");
  ns.disableLog("getServerMaxRam");
  ns.disableLog("getServerUsedRam");
  ns.disableLog("sleep");

  do {
    const startedAt = Date.now();

    try {
      const data = collectResourceState(ns);
      data.health = HEALTH.UNTESTED;
      data.collectionDurationMs = Date.now() - startedAt;

      publishDomainState(ns, PATHS.resourceState, {
        domain: "resources",
        source: ns.getScriptName(),
        data,
      });
    } catch (error) {
      ns.print(`ERROR resource collection failed: ${String(error)}`);
    }

    if (flags.once) break;
    await ns.sleep(Math.max(250, Number(flags.interval) || FRESHNESS_MS.fast));
  } while (true);
}

export function collectResourceState(ns) {
  const discoveredHosts = discoverNetwork(ns);
  const ramHosts = rootedRamHosts(ns, discoveredHosts);
  const hosts = ramHosts.map((host) => collectHost(ns, host));

  const home = hosts.find((host) => host.hostname === "home") ?? emptySummary();
  const remoteHosts = hosts.filter((host) => host.hostname !== "home");
  const remote = summarizeHosts(remoteHosts);
  const total = summarizeHosts(hosts);

  return {
    discoveredHostCount: discoveredHosts.length,
    usableRamHostCount: hosts.length,
    home,
    remote,
    total,
    hosts,
  };
}

function collectHost(ns, hostname) {
  const maxRam = ns.getServerMaxRam(hostname);
  const usedRam = ns.getServerUsedRam(hostname);
  const processes = ns.ps(hostname).map((process) => {
    const ramPerThread = safeScriptRam(ns, process.filename, hostname);
    return {
      pid: process.pid,
      filename: process.filename,
      threads: process.threads,
      args: process.args,
      ramPerThread,
      ramUsed: ramPerThread * process.threads,
    };
  });

  return {
    hostname,
    maxRam,
    usedRam,
    freeRam: Math.max(0, maxRam - usedRam),
    processCount: processes.length,
    processes,
  };
}

function summarizeHosts(hosts) {
  return hosts.reduce(
    (summary, host) => {
      summary.maxRam += host.maxRam;
      summary.usedRam += host.usedRam;
      summary.freeRam += host.freeRam;
      summary.processCount += host.processCount;
      return summary;
    },
    emptySummary(),
  );
}

function emptySummary() {
  return {
    maxRam: 0,
    usedRam: 0,
    freeRam: 0,
    processCount: 0,
  };
}

function safeScriptRam(ns, filename, hostname) {
  try {
    const value = ns.getScriptRam(filename, hostname);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}
