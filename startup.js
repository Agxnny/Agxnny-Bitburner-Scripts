const GUI_SCRIPT = "/ui/dashboard.js";
const KICKSTART_SCRIPT = "/kickstart.js";

/**
 * One-command startup entrypoint.
 *
 * Starts the main GUI on home, then launches the automation stack in quiet mode.
 * Background services continue publishing state, while the GUI becomes the main
 * presentation surface instead of terminal output.
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
            ns.tprint("WARNING: Could not start the main GUI. Continuing with quiet automation startup.");
        }
    }

    ns.spawn(KICKSTART_SCRIPT, { threads: 1, spawnDelay: 0 }, "--quiet");
}
