import { WORKER_SCRIPTS } from "/lib/execution.js";
import { publishPrepperState, readPlannerState, readMultiTargetSchedulerState } from "/lib/runtime-state.js";
import { rankEligibleTargets } from "/lib/targets.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const MONEY_READY_RATIO = 0.995;
const SECURITY_READY_DELTA = 0.05;
const DEFAULT_RESERVE_RATIO = 0.125;
const DEFAULT_MIN_RESERVE_GB = 64;
const DEFAULT_MAX_RESERVE_GB = 1024;
const TARGET_REFRESH_MS = 15_000;
const LOOP_MS = 500;
const HEARTBEAT_MS = 1_000;

/**
 * Distributed background target prepper.
 *
 * Periodically re-discovers/ranks every rooted, currently hackable money target
 * through the shared target layer. A bounded slice of remote RAM is reserved by
 * selecting small execution hosts until the requested reserve is met. Those
 * hosts are excluded from production by lib/execution.js and may prep different
 * targets concurrently. Active MULTI targets are prioritized, then normal rank.
 *
 * Usage:
 *   run hacking/prepper.js
 *   run hacking/prepper.js 0.125 64 1024
 *
 * args: reserveRatio minReserveGb maxReserveGb
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    const quiet = isQuiet(ns);
    const args = positionalArgs(ns);
    const reserveRatio = clamp(Number(args[0] ?? DEFAULT_RESERVE_RATIO), 0.02, 0.50);
    const minReserveGb = Math.max(2, Number(args[1] ?? DEFAULT_MIN_RESERVE_GB));
    const maxReserveGb = Math.max(minReserveGb, Number(args[2] ?? DEFAULT_MAX_RESERVE_GB));

    if (ns.getHostname() !== "home") {
        if (!quiet) ns.tprint("ERROR: Run hacking/prepper.js from home.");
        return;
    }

    let targets = [];
    let targetRefreshAt = 0;
    let reservations = [];
    let reservationSignature = "";
    let active = new Map();
    let completedWaves = 0;
    let sequence = 0;
    let lastHeartbeat = 0;

    while (true) {
        const now = Date.now();
        const planner = readPlannerState(ns);
        const nextReservations = chooseReservations(ns, planner, reserveRatio, minReserveGb, maxReserveGb);
        const nextSignature = nextReservations.map((x) => x.hostname).join("|");
        if (nextSignature !== reservationSignature) {
            // Never move the reservation out from underneath prep work already running.
            if (active.size === 0) {
                reservations = nextReservations;
                reservationSignature = nextSignature;
                if (!quiet) ns.tprint(`[PREPPER] Reserved ${formatRam(sumRam(reservations))} across ${reservations.length} host(s) for distributed prep.`);
            }
        }

        if (now >= targetRefreshAt || targets.length === 0) {
            targets = rankEligibleTargets(ns);
            targetRefreshAt = now + TARGET_REFRESH_MS;
        }

        // Reap finished prep jobs.
        for (const [host, job] of [...active.entries()]) {
            if (!ns.isRunning(job.pid, host)) {
                active.delete(host);
                completedWaves += 1;
            }
        }

        const prepared = targets.filter((target) => targetPrepared(ns, target.hostname));
        const demand = currentDemand(ns);
        const busyTargets = new Set([...active.values()].map((job) => job.target));
        const needsPrep = targets
            .filter((target) => !targetPrepared(ns, target.hostname) && !busyTargets.has(target.hostname))
            .sort((a, b) => priority(b, demand) - priority(a, demand) || a.rank - b.rank);

        // One prep job per reserved host; different targets can progress concurrently.
        for (const reservation of reservations) {
            if (active.has(reservation.hostname) || needsPrep.length === 0) continue;
            if (foreignProcessesOnHost(ns, reservation.hostname)) continue;
            const target = needsPrep.shift();
            const wave = choosePrepWave(ns, reservation.hostname, target.hostname);
            if (!wave.ok) continue;
            const scriptRam = Math.max(0.001, ns.getScriptRam(wave.script, "home"));
            const freeRam = Math.max(0, ns.getServerMaxRam(reservation.hostname) - ns.getServerUsedRam(reservation.hostname));
            const threads = Math.min(wave.requestedThreads, Math.floor(freeRam / scriptRam));
            if (threads < 1) continue;
            const jobId = `prepper-v2-${++sequence}-${target.hostname}`;
            const pid = ns.exec(wave.script, reservation.hostname, threads, target.hostname, jobId, threads);
            if (pid > 0) active.set(reservation.hostname, { pid, target: target.hostname, action: wave.action, threads, startedAt: now });
        }

        if (now - lastHeartbeat >= HEARTBEAT_MS) {
            lastHeartbeat = now;
            const reservedRamGb = sumRam(reservations);
            const activeJobs = [...active.entries()].map(([hostname, job]) => ({ hostname, ...job }));
            const status = reservations.length === 0 ? "BLOCKED"
                : prepared.length === targets.length ? "IDLE_PREPARED"
                : activeJobs.length > 0 ? "RUNNING"
                : "WAITING_HOST";
            publishPrepperState(ns, {
                version: 2,
                model: "DISTRIBUTED_TARGET_PREPPER_V2",
                enabled: true,
                status,
                reason: status === "BLOCKED" ? "No remote RAM hosts available for prep reserve"
                    : status === "IDLE_PREPARED" ? `All ${targets.length} eligible target(s) prepared`
                    : status === "RUNNING" ? `Preparing ${activeJobs.length} target(s) across reserved RAM pool`
                    : "Reserved prep hosts are draining or waiting for work",
                reserveRatio,
                minReserveGb,
                maxReserveGb,
                reservedRamGb,
                reservedHost: reservations[0]?.hostname ?? "",
                reservedHosts: reservations,
                targetCount: targets.length,
                preparedCount: prepared.length,
                needsPrepCount: Math.max(0, targets.length - prepared.length),
                activeCount: activeJobs.length,
                activeJobs,
                demandTargets: [...demand],
                nextTargets: needsPrep.slice(0, 8).map((target) => target.hostname),
                completedWaves,
                targetRefreshAt,
                updatedAt: now,
            });
        }
        await ns.sleep(LOOP_MS);
    }
}

function chooseReservations(ns, planner, ratio, minGb, maxGb) {
    const hosts = (Array.isArray(planner?.executionHosts) ? planner.executionHosts : [])
        .map((entry) => String(entry?.hostname ?? ""))
        .filter((host) => host && host !== "home" && ns.hasRootAccess(host) && ns.getServerMaxRam(host) > 0)
        .map((hostname) => ({ hostname, maxRam: ns.getServerMaxRam(hostname) }))
        .sort((a, b) => a.maxRam - b.maxRam || a.hostname.localeCompare(b.hostname));
    const totalRam = hosts.reduce((sum, host) => sum + host.maxRam, 0);
    if (totalRam <= 0) return [];
    const budget = Math.min(maxGb, Math.max(minGb, totalRam * ratio));
    const chosen = [];
    let reserved = 0;
    for (const host of hosts) {
        if (reserved >= budget && chosen.length > 0) break;
        chosen.push(host);
        reserved += host.maxRam;
    }
    return chosen;
}

function currentDemand(ns) {
    const state = readMultiTargetSchedulerState(ns);
    const fresh = Number(state?.updatedAt ?? 0) > Date.now() - 10_000;
    if (!fresh) return new Set();
    const names = [
        ...(Array.isArray(state?.admittedTargets) ? state.admittedTargets : []),
        ...(Array.isArray(state?.inFlight) ? state.inFlight.map((entry) => entry?.target) : []),
    ].map(String).filter(Boolean);
    return new Set(names);
}

function priority(target, demand) {
    return (demand.has(target.hostname) ? 1_000_000 : 0) + Math.max(0, 10_000 - Number(target.rank ?? 10_000));
}

function targetPrepared(ns, hostname) {
    const maxMoney = Math.max(0, ns.getServerMaxMoney(hostname));
    if (!(maxMoney > 0)) return true;
    return ns.getServerMoneyAvailable(hostname) / maxMoney >= MONEY_READY_RATIO
        && ns.getServerSecurityLevel(hostname) - ns.getServerMinSecurityLevel(hostname) <= SECURITY_READY_DELTA;
}

function choosePrepWave(ns, host, target) {
    const weakenPerThread = Math.max(0.000001, ns.weakenAnalyze(1, 1));
    const securityDelta = Math.max(0, ns.getServerSecurityLevel(target) - ns.getServerMinSecurityLevel(target));
    if (securityDelta > SECURITY_READY_DELTA) {
        return { ok: true, action: "WEAKEN", script: WORKER_SCRIPTS.WEAKEN, requestedThreads: Math.max(1, Math.ceil((securityDelta - SECURITY_READY_DELTA) / weakenPerThread)) };
    }
    const maxMoney = Math.max(0, ns.getServerMaxMoney(target));
    const money = Math.max(0, ns.getServerMoneyAvailable(target));
    if (!(maxMoney > 0) || money / maxMoney >= MONEY_READY_RATIO) return { ok: false };
    let growThreads = 1;
    try { growThreads = Math.max(1, Math.ceil(ns.growthAnalyze(target, maxMoney / Math.max(1, money), 1))); } catch { growThreads = 1; }
    const ram = Math.max(0.001, ns.getScriptRam(WORKER_SCRIPTS.GROW, "home"));
    return { ok: true, action: "GROW", script: WORKER_SCRIPTS.GROW, requestedThreads: Math.min(growThreads, Math.max(1, Math.floor(ns.getServerMaxRam(host) / ram))) };
}

function foreignProcessesOnHost(ns, hostname) { return ns.ps(hostname).length > 0; }
function sumRam(hosts) { return hosts.reduce((sum, host) => sum + Number(host.maxRam ?? 0), 0); }
function clamp(value, min, max) { return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min; }
function formatRam(value) { return `${Number(value).toFixed(value >= 100 ? 0 : 1)} GB`; }
