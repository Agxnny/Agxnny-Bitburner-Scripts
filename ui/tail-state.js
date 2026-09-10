const DEFAULT_STATE_PATH = "/data/state/ui-tail-layout.json";

export function openRememberedTail(ns, { width = 1180, height = 760, statePath = DEFAULT_STATE_PATH } = {}) {
  ns.ui.openTail();
  const saved = readLayout(ns, statePath)[tailKey(ns)] ?? null;

  try {
    if (saved) {
      ns.ui.moveTail(saved.x, saved.y);
      ns.ui.resizeTail(saved.width, saved.height);
    } else {
      ns.ui.resizeTail(width, height);
    }
  } catch {}
}

export function rememberTail(ns, statePath = DEFAULT_STATE_PATH) {
  const running = ns.getRunningScript();
  const tail = running?.tailProperties ?? null;
  if (!tail) return false;

  const state = readLayout(ns, statePath);
  state[tailKey(ns)] = {
    x: tail.x,
    y: tail.y,
    width: tail.width,
    height: tail.height,
    fontSize: tail.fontSize,
    minimized: tail.minimized,
    savedAt: Date.now(),
  };
  ns.write(statePath, JSON.stringify(state, null, 2), "w");
  return true;
}

function tailKey(ns) {
  return `${ns.getHostname()}:${ns.getScriptName()}`;
}

function readLayout(ns, statePath) {
  const raw = ns.read(statePath);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
