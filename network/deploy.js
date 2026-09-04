import { readPlannerState } from "/lib/runtime-state.js";
import { WORKER_SCRIPTS } from "/lib/execution.js";

const TELEMETRY_SCRIPT = "/hacking/telemetry.js";
const TEST_LAUNCHER_SCRIPT = "/diagnostics/test-launcher.js";

const SUPPORT_FILES = Object.freeze([
    "/hacking/tactical-planner.js",
    TELEMETRY_SCRIPT,
    TEST_LAUNCHER_SCRIPT,
    "/diagnostics/test.js",
    "/lib/threads.js",
    "/lib/runtime-state.js",
    "/lib/telemetry.js",
    "/lib/progression.js",
    "/lib/state.js",
    "/lib/execution.js",
]);

/**
 * Copy execution/support files from home to every rooted RAM host in the latest
 * planner snapshot. Persistent support services are then placed off home.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    if (ns.getHostname() !== "home") {
        ns.tprint("ERROR: Run network/deploy.js from home.");
        return;
    }

    const planner = readPlannerState(ns);
    const hosts = Array.isArray(planner?.executionHosts) ? planner.executionHosts : [];
    const remoteHosts = hosts
        .map((entry) => String(entry.hostname ?? ""))
        .filter((hostname) => hostname && hostname !== "home");

    if (remoteHosts.length === 0) {
        ns.tprint("No remote rooted RAM hosts in the latest planner snapshot.");
        ns.tprint("Run hacking/planner.js after gaining root access to refresh the pool.");
        return;
    }

    const files = [...new Set([...Object.values(WORKER_SCRIPTS), ...SUPPORT_FILES])];
    let success = 0;

    ns.tprint("=== EXECUTION DEPLOYMENT ===");

    for (const hostname of remoteHosts) {
        const ok = await ns.scp(files, hostname, "home");
        if (ok) {
            success += 1;
            ns.tprint(`DEPLOYED  ${hostname}`);
        } else {
            ns.tprint(`FAILED    ${hostname}`);
        }
    }

    ns.tprint(`Deployment complete: ${success}/${remoteHosts.length} host(s).`);
    ns.tprint(`Files per host: ${files.length} (workers + tactical/telemetry/diagnostic support)`);

    startRemoteService(ns, remoteHosts, TELEMETRY_SCRIPT, "Telemetry collector");
    startRemoteService(ns, remoteHosts, TEST_LAUNCHER_SCRIPT, "Diagnostic test launcher");

    if (String(ns.args[0] ?? "") === "--kickstart") {
        const nextStage = Math.max(0, Math.floor(Number(ns.args[1] ?? 2)));
        ns.spawn("/kickstart.js", { threads: 1, spawnDelay: 0 }, nextStage);
    }
}

/**
 * Keep one instance of a persistent support service off home. Prefer the
 * smallest remote server with enough current free RAM.
 *
 * @param {NS} ns
 * @param {string[]} remoteHosts
 * @param {string} script
 * @param {string} label
 */
function startRemoteService(ns, remoteHosts, script, label) {
    for (const hostname of remoteHosts) {
        if (ns.isRunning(script, hostname)) {
            ns.tprint(`${label} already running on ${hostname}.`);
            return;
        }
    }

    const scriptRam = ns.getScriptRam(script, "home");
    if (scriptRam <= 0) {
        ns.tprint(`WARNING: ${label.toLowerCase()} script RAM could not be determined.`);
        return;
    }

    const candidates = remoteHosts
        .map((hostname) => ({
            hostname,
            freeRam: Math.max(0, ns.getServerMaxRam(hostname) - ns.getServerUsedRam(hostname)),
        }))
        .filter((host) => host.freeRam >= scriptRam)
        .sort((a, b) => a.freeRam - b.freeRam || a.hostname.localeCompare(b.hostname));

    for (const host of candidates) {
        const pid = ns.exec(script, host.hostname, 1);
        if (pid > 0) {
            ns.tprint(`${label} started on ${host.hostname} (${ns.format.ram(scriptRam)}).`);
            return;
        }
    }

    ns.tprint(`WARNING: no remote host had enough free RAM for the ${label.toLowerCase()}.`);
}
