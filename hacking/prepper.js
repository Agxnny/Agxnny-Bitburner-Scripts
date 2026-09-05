import { publishPrepperState, readPlannerState, readMultiTargetSchedulerState } from "/lib/runtime-state.js";
import { rankEligibleTargets } from "/lib/targets.js";
import { isQuiet, positionalArgs } from "/lib/output.js";
import { choosePrepFocus, prepDemand } from "/hacking/prepper-allocation.js";

const MONEY_READY_RATIO = 0.995;
const SECURITY_READY_DELTA = 0.05;
const DEFAULT_RESERVE_RATIO = 0.125;
const DEFAULT_MIN_RESERVE_GB = 64;
const DEFAULT_MAX_RESERVE_GB = 1024;
const TARGET_REFRESH_MS = 15_000;
const LOOP_MS = 500;
const HEARTBEAT_MS = 1_000;

/**
 * Distributed adaptive target prepper.
 *
 * The allocator compares concentration widths and may assign several reserved
 * hosts to the same target when that improves projected prep throughput.
 * A target is never replanned until every job in its current wave finishes.
 * Money restoration is intentionally prioritized before security cleanup.
 *
 * Usage: run hacking/prepper.js [reserveRatio] [minReserveGb] [maxReserveGb]
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
    const active = new Map();
    let completedWaves = 0;
    let sequence = 0;
    let waveSequence = 0;
    let lastHeartbeat = 0;
    let lastPlan = emptyFocusPlan();

    while (true) {
        const now = Date.now();
        const planner = readPlannerState(ns);
        const nextReservations = chooseReservations(ns, planner, reserveRatio, minReserveGb, maxReserveGb);
        const nextSignature = nextReservations.map((x) => x.hostname).join("|");
        if (nextSignature !== reservationSignature && active.size === 0) {
            reservations = nextReservations;
            reservationSignature = nextSignature;
            if (!quiet) ns.tprint(`[PREPPER] Reserved ${formatRam(sumRam(reservations))} across ${reservations.length} host(s).`);
        }

        if (now >= targetRefreshAt || targets.length === 0) {
            targets = rankEligibleTargets(ns);
            targetRefreshAt = now + TARGET_REFRESH_MS;
        }

        reapFinishedJobs(ns, active, () => { completedWaves += 1; });

        const demand = currentDemand(ns);
        const prepared = targets.filter((target) => targetPrepared(ns, target.hostname));
        const busyTargets = new Set([...active.values()].map((job) => job.target));
        const ordered = targets
            .filter((target) => !targetPrepared(ns, target.hostname) && !busyTargets.has(target.hostname))
            .sort((a, b) => priority(b, demand) - priority(a, demand) || a.rank - b.rank);
        const freeHosts = reservations.filter((host) => !active.has(host.hostname) && !foreignProcessesOnHost(ns, host.hostname));

        if (ordered.length && freeHosts.length) {
            const plan = choosePrepFocus(ns, ordered, freeHosts, MONEY_READY_RATIO, SECURITY_READY_DELTA);
            if (plan.hostPlan.length) {
                const waveId = `focus-${++waveSequence}`;
                const launched = launchPlan(ns, plan, active, waveId, now, () => ++sequence);
                if (launched > 0) lastPlan = { ...plan, waveId, launchedAt: now, launchedJobs: launched };
            }
        }

        if (now - lastHeartbeat >= HEARTBEAT_MS) {
            lastHeartbeat = now;
            const activeJobs = [...active.entries()].map(([hostname, job]) => ({ hostname, ...job }));
            const activeByTarget = groupActiveByTarget(activeJobs);
            const remaining = targets
                .filter((target) => !targetPrepared(ns, target.hostname))
                .sort((a, b) => priority(b, demand) - priority(a, demand) || a.rank - b.rank);
            const prepTargets = remaining.map((target, index) => targetProgress(ns, target, activeByTarget.get(target.hostname) ?? [], index, reservations));
            const status = reservations.length === 0 ? "BLOCKED"
                : prepared.length === targets.length ? "IDLE_PREPARED"
                : activeJobs.length > 0 ? "RUNNING"
                : "WAITING_HOST";

            publishPrepperState(ns, {
                version: 3,
                model: "DISTRIBUTED_TARGET_PREPPER_V3_ADAPTIVE_FOCUS",
                enabled: true,
                policy: "ADAPTIVE_FOCUS_GROW_THEN_WEAKEN",
                status,
                reason: statusReason(status, targets.length, activeJobs.length),
                reserveRatio, minReserveGb, maxReserveGb,
                reservedRamGb: sumRam(reservations),
                reservedHost: reservations[0]?.hostname ?? "",
                reservedHosts: reservations,
                targetCount: targets.length,
                preparedCount: prepared.length,
                needsPrepCount: remaining.length,
                activeCount: activeJobs.length,
                activeTargetCount: activeByTarget.size,
                activeJobs,
                prepTargets,
                demandTargets: [...demand],
                nextTargets: remaining.slice(0, 8).map((target) => target.hostname),
                focus: {
                    mode: lastPlan.mode,
                    width: lastPlan.focusWidth,
                    targets: lastPlan.focusTargets,
                    estimatedMakespanMs: lastPlan.estimatedMakespanMs,
                    estimatedTargetsPerHour: lastPlan.estimatedTargetsPerHour,
                    waveId: lastPlan.waveId ?? "",
                    launchedJobs: lastPlan.launchedJobs ?? 0,
                },
                completedWaves,
                targetRefreshAt,
                updatedAt: now,
            });
        }
        await ns.sleep(LOOP_MS);
    }
}

function launchPlan(ns, plan, active, waveId, now, nextSequence) {
    let launched = 0;
    for (const job of plan.hostPlan) {
        if (active.has(job.hostname) || foreignProcessesOnHost(ns, job.hostname)) continue;
        const jobId = `prepper-v3-${nextSequence()}-${job.target}`;
        const pid = ns.exec(job.script, job.hostname, job.threads, job.target, jobId, job.threads);
        if (pid <= 0) continue;
        active.set(job.hostname, {
            pid,
            waveId,
            target: job.target,
            action: job.action,
            threads: job.threads,
            startedAt: now,
        });
        launched += 1;
    }
    return launched;
}

function reapFinishedJobs(ns, active, onWaveFinished) {
    const beforeWaves = new Set([...active.values()].map((job) => job.waveId));
    for (const [host, job] of [...active.entries()]) {
        if (!ns.isRunning(job.pid, host)) active.delete(host);
    }
    const afterWaves = new Set([...active.values()].map((job) => job.waveId));
    for (const waveId of beforeWaves) if (waveId && !afterWaves.has(waveId)) onWaveFinished();
}

function groupActiveByTarget(activeJobs) {
    const grouped = new Map();
    for (const job of activeJobs) {
        if (!grouped.has(job.target)) grouped.set(job.target, []);
        grouped.get(job.target).push(job);
    }
    return grouped;
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
    return new Set([
        ...(Array.isArray(state?.admittedTargets) ? state.admittedTargets : []),
        ...(Array.isArray(state?.inFlight) ? state.inFlight.map((entry) => entry?.target) : []),
    ].map(String).filter(Boolean));
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

function targetProgress(ns, target, activeJobs, queueIndex, reservations) {
    const hostname = target.hostname;
    const maxMoney = Math.max(0, ns.getServerMaxMoney(hostname));
    const money = Math.max(0, ns.getServerMoneyAvailable(hostname));
    const moneyRatio = maxMoney > 0 ? money / maxMoney : 1;
    const securityDelta = Math.max(0, ns.getServerSecurityLevel(hostname) - ns.getServerMinSecurityLevel(hostname));
    const demand = prepDemand(ns, hostname, MONEY_READY_RATIO, SECURITY_READY_DELTA);
    const activeThreads = activeJobs.reduce((sum, job) => sum + Number(job.threads ?? 0), 0);
    return {
        hostname,
        rank: Number(target.rank ?? 0),
        money,
        maxMoney,
        moneyRatio,
        securityDelta,
        action: activeJobs[0]?.action ?? demand.action,
        active: activeJobs.length > 0,
        activeJobs: activeJobs.length,
        activeThreads,
        hosts: activeJobs.map((job) => job.hostname),
        host: activeJobs[0]?.hostname ?? "",
        etaMs: estimateTargetEta(ns, hostname, demand, activeJobs, queueIndex, reservations),
    };
}

function estimateTargetEta(ns, hostname, demand, activeJobs, queueIndex, reservations) {
    const durationMs = Math.max(1, Number(demand.durationMs ?? 0));
    if (activeJobs.length) {
        const oldest = Math.min(...activeJobs.map((job) => Number(job.startedAt ?? Date.now())));
        return Math.max(0, oldest + durationMs - Date.now());
    }
    const capacities = reservations.map((host) => threadCapacity(ns, host, demand.script)).filter((x) => x > 0);
    const totalCapacity = capacities.reduce((sum, x) => sum + x, 0);
    const rounds = totalCapacity > 0 ? Math.max(1, Math.ceil(Number(demand.requestedThreads ?? 0) / totalCapacity)) : 1;
    return (Math.floor(Math.max(0, queueIndex) / Math.max(1, reservations.length)) + rounds) * durationMs;
}

function threadCapacity(ns, host, script) {
    if (!script) return 0;
    const ram = Math.max(0.001, ns.getScriptRam(script, "home"));
    return Math.max(0, Math.floor(Number(host.maxRam ?? 0) / ram));
}

function foreignProcessesOnHost(ns, hostname) { return ns.ps(hostname).length > 0; }
function sumRam(hosts) { return hosts.reduce((sum, host) => sum + Number(host.maxRam ?? 0), 0); }
function clamp(value, min, max) { return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min; }
function formatRam(value) { return `${Number(value).toFixed(value >= 100 ? 0 : 1)} GB`; }
function emptyFocusPlan() { return { mode: "IDLE", focusWidth: 0, focusTargets: [], estimatedMakespanMs: 0, estimatedTargetsPerHour: 0, hostPlan: [] }; }
function statusReason(status, targetCount, activeCount) {
    if (status === "BLOCKED") return "No remote RAM hosts available for prep reserve";
    if (status === "IDLE_PREPARED") return `All ${targetCount} eligible target(s) prepared`;
    if (status === "RUNNING") return `Adaptive prep running ${activeCount} job(s); multiple hosts may focus one target`;
    return "Reserved prep hosts are draining or waiting for work";
}
