// Distributed execution-pool helpers.

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

/** Build the live remote production pool. Home and fresh prepper-reserved hosts are excluded. */
export function getExecutionPool(ns, planner, _homeReserveGb = DEFAULT_HOME_RESERVE_GB) {
    const plannedHosts = Array.isArray(planner?.executionHosts) ? planner.executionHosts : [];
    const prepperReservation = readPrepperReservation(ns);
    const reserved = new Set(prepperReservation.active ? prepperReservation.hostnames : []);

    return plannedHosts
        .map((entry) => {
            const hostname = String(entry.hostname ?? "");
            if (!hostname || hostname === "home" || reserved.has(hostname)) return null;
            const maxRam = ns.getServerMaxRam(hostname);
            const usedRam = ns.getServerUsedRam(hostname);
            const freeRam = Math.max(0, maxRam - usedRam);
            return { hostname, maxRam, usedRam, freeRam, reserveRam: 0, usableRam: freeRam };
        })
        .filter(Boolean)
        .filter((host) => host.maxRam > 0)
        .sort((a, b) => b.usableRam - a.usableRam || a.hostname.localeCompare(b.hostname));
}

export function getPrepperReservation(ns) { return readPrepperReservation(ns); }

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

export function distributeThreads(ns, planner, script, target, requestedThreads, jobId, homeReserveGb = DEFAULT_HOME_RESERVE_GB) {
    const requested = Math.max(0, Math.floor(Number(requestedThreads) || 0));
    const scriptRam = ns.getScriptRam(script, "home");
    if (requested < 1 || scriptRam <= 0) {
        return { requested, launched: 0, remaining: requested, script, scriptRam, target, policy: WORKER_EXECUTION_POLICY, allocations: [] };
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
        allocations.push({ hostname: host.hostname, threads, pid, ram: threads * scriptRam });
        remaining -= threads;
    }
    return { requested, launched: requested - remaining, remaining, script, scriptRam, target, policy: WORKER_EXECUTION_POLICY, allocations };
}

function readPrepperReservation(ns) {
    const raw = ns.getPortHandle(PREPPER_STATE_PORT).peek();
    if (raw === EMPTY_PORT) return emptyReservation();
    try {
        const state = JSON.parse(String(raw));
        const updatedAt = Number(state?.updatedAt ?? 0);
        const fresh = updatedAt > 0 && Date.now() - updatedAt <= PREPPER_HEARTBEAT_STALE_MS && state?.enabled !== false;
        if (!fresh) return emptyReservation(updatedAt);
        const listed = Array.isArray(state?.reservedHosts)
            ? state.reservedHosts.map((entry) => typeof entry === "string" ? entry : String(entry?.hostname ?? "")).filter(Boolean)
            : [];
        const legacy = String(state?.reservedHost ?? "");
        const hostnames = [...new Set(listed.length ? listed : (legacy ? [legacy] : []))];
        return {
            active: hostnames.length > 0,
            hostname: hostnames[0] ?? "",
            hostnames,
            hostCount: hostnames.length,
            reservedRamGb: Number(state?.reservedRamGb ?? 0),
            updatedAt,
        };
    } catch { return emptyReservation(); }
}

function emptyReservation(updatedAt = 0) {
    return { active: false, hostname: "", hostnames: [], hostCount: 0, reservedRamGb: 0, updatedAt };
}

function sum(hosts, field) { return hosts.reduce((total, host) => total + Number(host[field] ?? 0), 0); }
