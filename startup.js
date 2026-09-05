const DASHBOARD_LAUNCHER = "/ui/dashboard-launcher.js";
const KICKSTART_SCRIPT = "/kickstart.js";

/**
 * One-command startup entrypoint.
 *
 * Delegates GUI admission to a low-RAM deferred launcher so this script can
 * release its own RAM before the main dashboard is retried. Then hands off to
 * the normal quiet kickstart chain. Controller startup remains STANDBY-safe.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    if (ns.getHostname() !== "home") {
        ns.tprint("ERROR: Run startup.js from home.");
        return;
    }

    ns.disableLog("ALL");

    if (!ns.isRunning(DASHBOARD_LAUNCHER, "home")) {
        const pid = ns.run(DASHBOARD_LAUNCHER, 1);
        if (pid <= 0) {
            ns.tprint("WARNING: Could not start deferred dashboard launcher. Continuing startup.");
        }
    }

    ns.spawn(KICKSTART_SCRIPT, { threads: 1, spawnDelay: 0 }, "--quiet");
}
