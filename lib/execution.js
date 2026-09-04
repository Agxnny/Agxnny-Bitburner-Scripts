// Distributed execution-pool helpers.
//
// The planner discovers candidate execution hosts. This module keeps the
// persistent controller/scheduler lightweight by consuming that cached host list
// and only checking live RAM when work is dispatched.

export const WORKER_SCRIPTS = Object.freeze({
    HACK: "/hacking/workers/hack.js",
    GROW: "/hacking/workers/grow.js",
    WEAKEN: "/hacking/workers/weaken.js",
});

// Home is now a control/UI node rather than worker capacity. Keep the legacy
// reserve export for callers/state compatibility, but the worker execution pool
// excludes home entirely.
export const DEFAULT_HOME_RESERVE_GB = 1;
export const WORKER_EXECUTION_POLICY = "REMOTE_ONLY";

/**
 * Build the live worker/remote-analysis execution pool from planner state.
 *
 * Home is deliberately excluded. The control node is reserved for the
 * controller, GUI/dashboard, updater, and other orchestration responsibilities.
 * If no remote execution hosts are currently available, this returns an empty
 * pool rather than silently falling back to home.
 *
 * @param {NS} ns
 * @param {object|null} planner
 * @param {number} _homeReserveGb retained for API compatibility
 */
export function getExecutionPool(ns, planner, _homeReserveGb = DEFAULT_HOME_RESERVE_GB) {
    const plannedHosts = Array.isArray(planner?.executionHosts) ? planner.executionHosts : [];

    return plannedHosts
        .map((entry) => {
            const hostname = String(entry.hostname ?? "");
            if (!hostname || hostname === "home") return null;

            const maxRam = ns.getServerMaxRam(hostname);
            const usedRam = ns.getServerUsedRam(hostname);
            const freeRam = Math.max(0, maxRam - usedRam);

            return {
                hostname,
                maxRam,
                usedRam,
                freeRam,
                reserveRam: 0,
                usableRam: freeRam,
            };
        })
        .filter(Boolean)
        .filter((host) => host.maxRam > 0)
        .sort((a, b) => b.usableRam - a.usableRam || a.hostname.localeCompare(b.hostname));
}

/**
 * Return aggregate remote-worker RAM figures for diagnostics/controller state.
 * Home RAM is intentionally not included in these totals.
 *
 * @param {NS} ns
 * @param {object|null} planner
 * @param {number} homeReserveGb retained for state compatibility
 */
export function summarizeExecutionPool(ns, planner, homeReserveGb = DEFAULT_HOME_RESERVE_GB) {
    const hosts = getExecutionPool(ns, planner, homeReserveGb);

    return {
        hosts,
        hostCount: hosts.length,
        maxRam: sum(hosts, "maxRam"),
        usedRam: sum(hosts, "usedRam"),
        freeRam: sum(hosts, "freeRam"),
        usableRam: sum(hosts, "usableRam"),
        homeReserveGb,
        excludesHome: true,
        policy: WORKER_EXECUTION_POLICY,
    };
}

/**
 * Split a requested worker thread count across remote execution hosts only.
 * Worker files must already be deployed to those hosts.
 *
 * Each worker receives its local allocation thread count as arg[2]. This keeps
 * workers independent while allowing hack workers to report exact telemetry for
 * their own distributed slice.
 *
 * @param {NS} ns
 * @param {object|null} planner
 * @param {string} script
 * @param {string} target
 * @param {number} requestedThreads
 * @param {string|number} jobId
 * @param {number} homeReserveGb retained for API compatibility
 */
export function distributeThreads(
    ns,
    planner,
    script,
    target,
    requestedThreads,
    jobId,
    homeReserveGb = DEFAULT_HOME_RESERVE_GB,
) {
    const requested = Math.max(0, Math.floor(Number(requestedThreads) || 0));
    const scriptRam = ns.getScriptRam(script, "home");

    if (requested < 1 || scriptRam <= 0) {
        return {
            requested,
            launched: 0,
            remaining: requested,
            script,
            scriptRam,
            target,
            policy: WORKER_EXECUTION_POLICY,
            allocations: [],
        };
    }

    let remaining = requested;
    const allocations = [];

    for (const host of getExecutionPool(ns, planner, homeReserveGb)) {
        if (remaining <= 0) break;

        const capacity = Math.floor(host.usableRam / scriptRam);
        const threads = Math.min(remaining, capacity);
        if (threads < 1) continue;

        const pid = ns.exec(script, host.hostname, threads, target, jobId, threads);
        if (pid === 0) continue;

        allocations.push({
            hostname: host.hostname,
            threads,
            pid,
            ram: threads * scriptRam,
        });
        remaining -= threads;
    }

    return {
        requested,
        launched: requested - remaining,
        remaining,
        script,
        scriptRam,
        target,
        policy: WORKER_EXECUTION_POLICY,
        allocations,
    };
}

function sum(hosts, field) {
    return hosts.reduce((total, host) => total + Number(host[field] ?? 0), 0);
}
