import { PATHS } from "/core/config.js";
import { readJson } from "/core/state.js";
import { openRememberedTail, rememberTail } from "/ui/tail-state.js";

const PULL_SCRIPT = "/pull.js";

export async function main(ns) {
  ns.disableLog("ALL");
  await openRememberedTail(ns, { width: 470, height: 250 });

  const React = globalThis.React;
  if (!React) throw new Error("React is not available in this Bitburner runtime");
  const h = React.createElement;
  let lastSave = 0;

  while (true) {
    const update = readJson(ns, PATHS.updateState, null);
    if (!update?.data || update.data.status !== "UPDATE_AVAILABLE") return;

    const installed = update.data.installed ?? {};
    const remote = update.data.remote ?? {};
    const launchUpdate = () => {
      if (ns.scriptRunning(PULL_SCRIPT, "home")) return;
      const pid = ns.exec(PULL_SCRIPT, "home", 1);
      if (pid === 0) ns.tprint("ALARM UPDATE_LAUNCH_FAILED: Could not start /pull.js");
    };
    const dismiss = () => { try { ns.ui.closeTail(); } catch {} };

    const button = (label, onClick, primary = false) => h("button", {
      onClick,
      style: {
        minWidth: "110px", padding: "8px 14px", borderRadius: "5px",
        border: "1px solid #666", cursor: "pointer", fontWeight: 700,
        background: primary ? "#1f6f43" : "#292929", color: "#fff",
      },
    }, label);

    const row = (label, value) => h("div", { style: { display: "flex", justifyContent: "space-between", gap: "18px", padding: "6px 0" } },
      h("span", { style: { opacity: 0.7 } }, label),
      h("span", { style: { fontWeight: 700, textAlign: "right" } }, value ?? "unknown"),
    );

    const view = h("div", { style: { fontFamily: "sans-serif", padding: "12px", color: "#ddd" } },
      h("div", { style: { fontSize: "18px", fontWeight: 800, marginBottom: "10px" } }, "Stack Update Available"),
      row("Installed", `${installed.releaseVersion ?? "?"} · ${installed.revisionId ?? "unknown"}`),
      row("Available", `${remote.releaseVersion ?? "?"} · ${remote.revisionId ?? "unknown"}`),
      h("div", { style: { marginTop: "14px", marginBottom: "10px", fontWeight: 700 } }, "Update Now?"),
      h("div", { style: { display: "flex", gap: "10px" } },
        button("Yes", launchUpdate, true),
        button("No", dismiss, false),
      ),
    );

    ns.clearLog();
    ns.printRaw(view);
    const now = Date.now();
    if (now - lastSave >= 250) { rememberTail(ns); lastSave = now; }
    await ns.sleep(100);
  }
}
