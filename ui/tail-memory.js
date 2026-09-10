const MANIFEST_PATH = "/stack-manifest.json";
const STATE_PATH = "/data/state/ui-tail-layout.json";
const DEFAULT_INTERVAL_MS = 250;

export async function main(ns) {
  const flags = ns.flags([["interval", DEFAULT_INTERVAL_MS]]);
  ns.disableLog("ALL");

  const openState = new Map();
  let layout = readJson(ns, STATE_PATH, {});

  while (true) {
    const manifest = readJson(ns, MANIFEST_PATH, null);
    const managed = new Set((manifest?.runtimeEntries ?? []).map((entry) => entry.path));

    for (const process of ns.ps("home")) {
      if (!managed.has(process.filename) || process.pid === ns.pid) continue;

      const running = ns.getRunningScript(process.pid, "home");
      const tail = running?.tailProperties ?? null;
      const key = tailKey(process);
      const wasOpen = openState.get(key) === true;

      if (!tail) {
        openState.set(key, false);
        continue;
      }

      if (!wasOpen && layout[key]) {
        restoreTail(ns, process.pid, layout[key]);
      }

      const current = ns.getRunningScript(process.pid, "home")?.tailProperties ?? tail;
      layout[key] = snapshotTail(current);
      openState.set(key, true);
    }

    ns.write(STATE_PATH, JSON.stringify(layout, null, 2), "w");
    await ns.sleep(Math.max(100, Number(flags.interval) || DEFAULT_INTERVAL_MS));
  }
}

function tailKey(process) {
  return `${process.filename}:${JSON.stringify(process.args ?? [])}`;
}

function snapshotTail(tail) {
  return {
    x: tail.x,
    y: tail.y,
    width: tail.width,
    height: tail.height,
    fontSize: tail.fontSize,
    minimized: tail.minimized,
    savedAt: Date.now(),
  };
}

function restoreTail(ns, pid, tail) {
  try {
    ns.ui.moveTail(tail.x, tail.y, pid);
    ns.ui.resizeTail(tail.width, tail.height, pid);
  } catch {}
}

function readJson(ns, path, fallback) {
  const raw = ns.read(path);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
