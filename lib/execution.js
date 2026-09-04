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

export const DEFAULT_HOME_RESERVE_GB = 1;

/**
 * Build the current execution pool from the latest planner snapshot.
 * Home gets a configurable reserve; ordinary rooted worker hosts use all free RAM.
 *
 * @param {NS} ns
 * @param {object|null} planner
 * @param {number} homeReserveGb
 */
export function getExecutionPool(ns, planner, homeReserveGb = DEFAULT_HOME_RESERVE_GB) {
    const hosts = Array.isArray(planner?.executionHosts) ? planner.executionHosts : [];

    return hosts
        .map((entry) => {
            const hostname = String(entry.hostname ?? "");
            if (!hostname) return null;

            const maxRam = ns.getServerMaxRam(hostname);
            const usedRam = ns.getServerUsedRam(hostname);
            const reserveRam = hostname === "home" ? Math.max(0, homeReserveGb) : 0;
            const freeRam = Math.max(0, maxRam - usedRam);
            const usableRam = Math.max(0, freeRam - reserveRam);

            return {
                hostname,
                maxRam,
                usedRam,
                freeRam,
                reserveRam,
                usableRam,
            };
        })
        .filter(Boolean)
        .filter((host) => host.maxRam > 0)
        .sort((a, b) => b.usableRam - a.usableRam || a.hostname.localeCompare(b.hostname));
}

/**
 * Return aggregate RAM figures for diagnostics/controller state.
 *
 * @param {NS} ns
 * @param {object|null} planner
 * @param {number} homeReserveGb
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
    };
}

/**
 * Split a requested worker thread count across the current execution pool.
 * Worker files must already be deployed to remote hosts.
 *
 * @param {NS} ns
 * @param {object|null} planner
 * @param {string} script
 * @param {string} target
 * @param {number} requestedThreads
 * @param {string|number} jobId
 * @param {number} homeReserveGb
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

        const pid = ns.exec(script, host.hostname, threads, target, jobId);
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
        allocations,
    };
}

function sum(hosts, field) {
    return hosts.reduce((total, host) => total + Number(host[field] ?? 0), 0);
}
