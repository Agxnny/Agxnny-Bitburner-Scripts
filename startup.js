const GUI_SCRIPT = "/ui/dashboard.js";
const STOCK_GUI_SCRIPT = "/stocks/dashboard.js";
const KICKSTART_SCRIPT = "/kickstart.js";

/**
 * One-command startup entrypoint.
 *
 * Starts the main control-plane GUI and the separate stock Market Lab dashboard
 * on home, then launches the control-plane stack in quiet mode. The controller
 * initializes in STANDBY, so startup brings planner/economy/controller/UI state
 * online without starting production H/G/W work until the user selects a mode.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    if (ns.getHostname() !== "home") {
        ns.tprint("ERROR: Run startup.js from home.");
        return;
    }

    ns.disableLog("ALL");

    launchDashboard(ns, GUI_SCRIPT, "main GUI");
    launchDashboard(ns, STOCK_GUI_SCRIPT, "stock Market Lab");

    ns.spawn(KICKSTART_SCRIPT, { threads: 1, spawnDelay: 0 }, "--quiet");
}

function launchDashboard(ns, script, label) {
    if (ns.isRunning(script, "home")) return;
    const pid = ns.run(script, 1);
    if (pid <= 0) ns.tprint(`WARNING: Could not start the ${label}. Continuing startup.`);
}
