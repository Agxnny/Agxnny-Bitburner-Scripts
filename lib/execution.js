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
export const WORKER_EXECUTION_POLICY = "REMOTE_ONLY_WITH_PREPPER_RESERVATION";

const PREPPER_STATE_PORT = 18;
const PREPPER_HEARTBEAT_STALE_MS = 5_000;
const EMPTY_PORT = "NULL PORT DATA";

/**
 * Build the live worker/remote-analysis execution pool from planner state.
 *
 * Home is deliberately excluded. If the dedicated prepper service is alive,
 * its reserved host is also excluded so production scheduling cannot steal the
 * machine that is preparing the wider target set.
 *
 * @param {NS} ns
 * @param {object|null} planner
 * @param {number} _homeReserveGb retained for API compatibility
 */
export function getExecutionPool(ns, planner, _homeReserveGb = DEFAULT_HOME_RESERVE_GB) {
    const plannedHosts = Array.isArray(planner?.executionHosts) ? planner.executionHosts : [];
    const prepperReservation = readPrepperReservation(ns);
    const reservedHost = prepperReservation.active ? prepperReservation.hostname : "";

    return plannedHosts
        .map((entry) => {
            const hostname = String(entry.hostname ?? "");
            if (!hostname || hostname === "home" || hostname === reservedHost) return null;

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

/** @param {NS} ns */
export function getPrepperReservation(ns) {
    return readPrepperReservation(ns);
}

/**
 * Return aggregate remote-worker RAM figures for diagnostics/controller state.
 * Home and an active prepper reservation are intentionally not included.
 *
 * @param {NS} ns
 * @param {object|null} planner
 * @param {number} homeReserveGb retained for state compatibility
 */
export function summarizeExecutionPool(ns, planner, homeReserveGb = DEFAULT_HOME_RESERVE_GB) {
    const hosts = getExecutionPool(ns, planner, homeReserveGb);
    const prepperReservation = readPrepperReservation(ns);

    return {
        hosts,
        hostCount: hosts.length,
        maxRam: sum(hosts, "maxRam"),
        usedRam: sum(hosts, "usedRam"),
        freeRam: sum(hosts, "freeRam"),
        usableRam: sum(hosts, "usableRam"),
        homeReserveGb,
        excludesHome: true,
        prepperReservation,
        policy: WORKER_EXECUTION_POLICY,
    };
}

/**
 * Split a requested worker thread count across remote production hosts only.
 * The active prepper host, if any, is automatically excluded.
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

/** @param {NS} ns */
function readPrepperReservation(ns) {
    const raw = ns.getPortHandle(PREPPER_STATE_PORT).peek();
    if (raw === EMPTY_PORT) return { active: false, hostname: "", updatedAt: 0 };

    try {
        const state = JSON.parse(String(raw));
        const hostname = String(state?.reservedHost ?? "");
        const updatedAt = Number(state?.updatedAt ?? 0);
        const active = Boolean(hostname)
            && updatedAt > 0
            && Date.now() - updatedAt <= PREPPER_HEARTBEAT_STALE_MS
            && state?.enabled !== false;
        return { active, hostname: active ? hostname : "", updatedAt };
    } catch {
        return { active: false, hostname: "", updatedAt: 0 };
    }
}

function sum(hosts, field) {
    return hosts.reduce((total, host) => total + Number(host[field] ?? 0), 0);
}
