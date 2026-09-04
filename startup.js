import { isQuiet } from "/lib/output.js";

const GUI_SCRIPT = "/ui/dashboard.js";
const KICKSTART_SCRIPT = "/kickstart.js";

/**
 * One-command startup entrypoint.
 *
 * Starts the main GUI on home, then hands automation startup to kickstart in
 * quiet mode so background services do not flood the terminal while the GUI is
 * the primary control surface.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    if (ns.getHostname() !== "home") {
        ns.tprint("ERROR: Run startup.js from home.");
        return;
    }

    ns.disableLog("ALL");

    if (!ns.isRunning(GUI_SCRIPT, "home")) {
        const guiPid = ns.run(GUI_SCRIPT, 1);
        if (guiPid <= 0) {
            ns.tprint("WARNING: Could not start the main GUI. Continuing with automation startup.");
        }
    }

    const args = ["--quiet"];
    if (isQuiet(ns)) args.push("--silent");
    ns.spawn(KICKSTART_SCRIPT, { threads: 1, spawnDelay: 0 }, ...args);
}
