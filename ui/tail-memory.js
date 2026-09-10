import { snapshotTail, tailKey } from "/ui/tail-state.js";

const MANIFEST_PATH = "/stack-manifest.json";
const STATE_PATH = "/data/state/ui-tail-layout.json";
const DEFAULT_INTERVAL_MS = 250;

export async function main(ns) {
  const flags = ns.flags([["interval", DEFAULT_INTERVAL_MS]]);
  ns.disableLog("ALL");
  let layout = readJson(ns, STATE_PATH, {});

  while (true) {
    const manifest = readJson(ns, MANIFEST_PATH, null);
    const managed = new Set((manifest?.runtimeEntries ?? []).map((entry) => entry.path));
    let changed = false;

    for (const process of ns.ps("home")) {
      if (!managed.has(process.filename) || process.pid === ns.pid) continue;
      const running = ns.getRunningScript(process.pid, "home");
      const tail = running?.tailProperties ?? null;
      if (!tail) continue;
      const key = tailKey("home", process.filename, process.args ?? []);
      const next = snapshotTail(tail);
      const previous = layout[key];
      if (!sameGeometry(previous, next)) {
        layout[key] = next;
        changed = true;
      }
    }

    if (changed) ns.write(STATE_PATH, JSON.stringify(layout, null, 2), "w");
    await ns.sleep(Math.max(100, Number(flags.interval) || DEFAULT_INTERVAL_MS));
  }
}

function sameGeometry(a, b) {
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.minimized === b.minimized;
}

function readJson(ns, path, fallback) {
  const raw = ns.read(path);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
