export function discoverNetwork(ns, start = "home") {
  const visited = new Set([start]);
  const queue = [start];
  const hosts = [];

  while (queue.length > 0) {
    const host = queue.shift();
    hosts.push(host);

    for (const neighbor of ns.scan(host)) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  return hosts;
}

export function rootedRamHosts(ns, hosts) {
  return hosts.filter(
    (host) => ns.hasRootAccess(host) && ns.getServerMaxRam(host) > 0,
  );
}
