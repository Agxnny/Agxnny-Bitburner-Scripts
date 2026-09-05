import { WORKER_SCRIPTS, getExecutionPool } from "/lib/execution.js";
import {
    publishMultiTargetSchedulerState,
    readEconomyTargetState,
    readPlannerState,
} from "/lib/runtime-state.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const DEFAULT_PROFILE = "money";
const DEFAULT_TARGET_COUNT = 4;
const DEFAULT_HACK_FRACTION = 0.10;
const DEFAULT_STAGE_GAP_MS = 200;
const GLOBAL_LANDING_GAP_MS = 100;
const START_LEAD_MS = 250;
const DISPATCH_LEAD_MS = 100;
const MAX_ADMISSIONS = 128;
const FAIRNESS_PENALTY = 0.30;
const PROFILE_WEIGHTS = Object.freeze({
    money: { money: 1.00, xp: 0.00 },
    balanced: { money: 0.70, xp: 0.30 },
    xp: { money: 0.00, xp: 1.00 },
});

/**
 * Planning-only global multi-target allocator.
 *
 * It builds ideal prepared HWGW candidates for several targets, scores them for
 * MONEY / BALANCED / XP, then repeatedly admits the highest-value feasible batch
 * into one shared host/time reservation calendar. There is no fixed depth per
 * target: depth emerges from value, RAM fragmentation, timing, and a diminishing
 * returns fairness penalty so secondary viable targets are not trivially starved.
 *
 * This script NEVER launches workers.
 *
 * Usage:
 *   run hacking/multi-target-scheduler.js [money|balanced|xp] [targetCount] [hackFraction] [stageGapMs] [admissions]
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    const args = positionalArgs(ns);
    const profile = normalizeProfile(args[0]);
    const targetCount = clampInt(Number(args[1] ?? DEFAULT_TARGET_COUNT), 2, 12);
    const hackFraction = clamp(Number(args[2] ?? DEFAULT_HACK_FRACTION), 0.001, 0.90);
    const stageGapMs = Math.max(75, Math.floor(Number(args[3] ?? DEFAULT_STAGE_GAP_MS)));
    const maxAdmissions = clampInt(Number(args[4] ?? 64), 2, MAX_ADMISSIONS);
    const quiet = isQuiet(ns);

    const planner = readPlannerState(ns);
    const economic = readEconomyTargetState(ns);
    const pool = getExecutionPool(ns, planner);
    const analysis = analyze(ns, planner, economic, pool, profile, targetCount, hackFraction, stageGapMs, maxAdmissions);
    publishMultiTargetSchedulerState(ns, analysis);
    if (!quiet) printAnalysis(ns, analysis);
}

function analyze(ns, planner, economic, pool, profile, targetCount, hackFraction, stageGapMs, maxAdmissions) {
    const now = Date.now();
    const rankings = sourceRankings(planner, economic).slice(0, targetCount);
    const base = {
        version: 1,
        model: "MULTI_TARGET_ALLOCATOR_DRY_RUN_V1",
        dryRun: true,
        launchesWorkers: false,
        profile,
        targetCount,
        requestedHackFraction: hackFraction,
        stageGapMs,
        globalLandingGapMs: GLOBAL_LANDING_GAP_MS,
        createdAt: now,
        updatedAt: now,
    };

    if (pool.length === 0) return { ...base, status: "BLOCKED", reason: "No remote execution RAM available", targets: [], allocations: [] };
    if (rankings.length < 2) return { ...base, status: "BLOCKED", reason: "Fewer than two eligible targets are available", targets: [], allocations: [] };

    const templates = rankings.map((entry) => buildTargetTemplate(ns, entry, hackFraction, stageGapMs)).filter((x) => x.ok);
    if (templates.length < 2) return { ...base, status: "BLOCKED", reason: "Fewer than two targets produced valid HWGW templates", targets: templates, allocations: [] };

    normalizeScores(templates);
    const weights = PROFILE_WEIGHTS[profile];
    for (const target of templates) {
        target.baseScore = target.moneyScoreNorm * weights.money + target.xpScoreNorm * weights.xp;
        target.admissions = 0;
        target.nextFirstLandingAt = now + target.firstLandingDelayMs;
        target.reservedRamTimeGbSec = 0;
        target.expectedCashAllocated = 0;
    }

    const hosts = pool.map((host) => ({ hostname: host.hostname, usableRam: Number(host.usableRam ?? 0), reservations: [] }));
    const landingTimes = [];
    const allocations = [];
    let blockedRounds = 0;

    for (let sequence = 1; sequence <= maxAdmissions; sequence += 1) {
        const candidates = [];
        for (const target of templates) {
            const firstLandingAt = findLandingStart(target, landingTimes, target.nextFirstLandingAt);
            const batch = makeBatch(target, firstLandingAt, sequence);
            const reservation = tryReserve(hosts, batch);
            if (!reservation.ok) continue;

            const adjustedScore = target.baseScore / (1 + FAIRNESS_PENALTY * target.admissions);
            candidates.push({ target, batch, reservation, adjustedScore });
        }

        if (candidates.length === 0) {
            blockedRounds += 1;
            break;
        }

        candidates.sort((a, b) => b.adjustedScore - a.adjustedScore
            || a.target.admissions - b.target.admissions
            || b.target.expectedCash - a.target.expectedCash
            || a.target.hostname.localeCompare(b.target.hostname));
        const chosen = candidates[0];
        commitReservation(hosts, chosen.reservation);
        for (const stage of chosen.batch.stages) landingTimes.push(stage.landingAt);
        landingTimes.sort((a, b) => a - b);

        chosen.target.admissions += 1;
        chosen.target.nextFirstLandingAt = chosen.batch.firstLandingAt + chosen.target.localBatchIntervalMs;
        chosen.target.reservedRamTimeGbSec += chosen.target.ramTimeGbSec;
        chosen.target.expectedCashAllocated += chosen.target.expectedCash;

        allocations.push({
            sequence,
            target: chosen.target.hostname,
            score: chosen.adjustedScore,
            firstLandingAt: chosen.batch.firstLandingAt,
            finalLandingAt: chosen.batch.finalLandingAt,
            expectedCash: chosen.target.expectedCash,
            ramTimeGbSec: chosen.target.ramTimeGbSec,
            allocations: chosen.reservation.allocations,
        });
    }

    const totalAdmissions = allocations.length;
    const totalRam = pool.reduce((sum, h) => sum + Number(h.usableRam ?? 0), 0);
    const hostPeak = hosts.map((host) => ({ hostname: host.hostname, peakReservedRam: peakRam(host.reservations), usableRam: host.usableRam }))
        .sort((a, b) => b.peakReservedRam - a.peakReservedRam);
    const targets = templates.map((target) => ({
        hostname: target.hostname,
        baselineRank: target.baselineRank,
        economicRank: target.economicRank,
        maxMoney: target.maxMoney,
        preparedNow: target.preparedNow,
        hackChance: target.hackChance,
        actualHackFraction: target.actualHackFraction,
        threads: target.threads,
        batchRam: target.batchRam,
        ramTimeGbSec: target.ramTimeGbSec,
        expectedCash: target.expectedCash,
        moneyEfficiency: target.moneyEfficiency,
        xpProxyEfficiency: target.xpProxyEfficiency,
        baseScore: target.baseScore,
        assignedBatches: target.admissions,
        allocationShare: totalAdmissions > 0 ? target.admissions / totalAdmissions : 0,
        expectedCashAllocated: target.expectedCashAllocated,
        reservedRamTimeGbSec: target.reservedRamTimeGbSec,
        localBatchIntervalMs: target.localBatchIntervalMs,
    })).sort((a, b) => b.assignedBatches - a.assignedBatches || b.baseScore - a.baseScore);

    return {
        ...base,
        status: totalAdmissions > 0 ? "READY" : "BLOCKED",
        reason: totalAdmissions > 0
            ? `Allocated ${totalAdmissions} virtual batches across ${targets.filter((x) => x.assignedBatches > 0).length} target(s) with dynamic depth`
            : "No globally feasible batch reservation found",
        capacity: {
            hostCount: pool.length,
            availableRam: totalRam,
            maxAdmissions,
            admitted: totalAdmissions,
            blockedRounds,
            fairnessPenalty: FAIRNESS_PENALTY,
        },
        objective: {
            profile,
            moneyWeight: weights.money,
            xpWeight: weights.xp,
            xpMetric: "ACTION_THREAD_DIFFICULTY_PROXY_PER_RAM_SECOND",
        },
        targets,
        allocations: allocations.slice(0, 64),
        hostPeak: hostPeak.slice(0, 16),
        notes: [
            "Planning only: no H/G/W workers are launched.",
            "Depth is not fixed per target; assignedBatches is the result of global value + reservation feasibility.",
            "XP mode currently uses an explicit proxy, not exact Bitburner hacking-exp formulas.",
            "PreparedNow is diagnostic only; templates assume production begins from a prepared baseline.",
            "This does not yet own Port 14 or replace the live single-target PIPELINE executor.",
        ],
    };
}

function sourceRankings(planner, economic) {
    const economicRows = Array.isArray(economic?.rankings) ? economic.rankings : [];
    if (economicRows.length >= 2) return economicRows;
    return Array.isArray(planner?.rankings) ? planner.rankings : [];
}

function buildTargetTemplate(ns, entry, requestedHackFraction, stageGapMs) {
    const hostname = String(entry?.hostname ?? "");
    if (!hostname) return { ok: false, reason: "missing hostname" };
    const maxMoney = Math.max(0, Number(ns.getServerMaxMoney(hostname)));
    const hackPerThread = Math.max(0, Number(ns.hackAnalyze(hostname)));
    const weakenPerThread = Math.max(0, Number(ns.weakenAnalyze(1, 1)));
    if (!(maxMoney > 0 && hackPerThread > 0 && weakenPerThread > 0)) return { ok: false, hostname, reason: "invalid analysis" };

    const hackChance = clamp(Number(ns.hackAnalyzeChance(hostname)), 0, 1);
    const hackThreads = Math.max(1, Math.floor(requestedHackFraction / hackPerThread));
    const actualHackFraction = Math.min(0.90, hackThreads * hackPerThread);
    const growThreads = finiteCeil(ns.growthAnalyze(hostname, 1 / Math.max(0.01, 1 - actualHackFraction), 1));
    const weakenHackThreads = Math.max(1, Math.ceil(ns.hackAnalyzeSecurity(hackThreads, hostname) / weakenPerThread));
    const weakenGrowThreads = Math.max(1, Math.ceil(ns.growthAnalyzeSecurity(growThreads) / weakenPerThread));
    const times = { hack: ns.getHackTime(hostname), grow: ns.getGrowTime(hostname), weaken: ns.getWeakenTime(hostname) };
    const scriptRam = {
        HACK: ns.getScriptRam(WORKER_SCRIPTS.HACK, "home"),
        GROW: ns.getScriptRam(WORKER_SCRIPTS.GROW, "home"),
        WEAKEN: ns.getScriptRam(WORKER_SCRIPTS.WEAKEN, "home"),
    };
    if (!(scriptRam.HACK > 0 && scriptRam.GROW > 0 && scriptRam.WEAKEN > 0)) return { ok: false, hostname, reason: "worker RAM unavailable" };

    const stages = [
        { name: "HACK", threads: hackThreads, durationMs: times.hack, scriptRam: scriptRam.HACK, ram: hackThreads * scriptRam.HACK, offsetMs: 0 },
        { name: "WEAKEN_HACK", threads: weakenHackThreads, durationMs: times.weaken, scriptRam: scriptRam.WEAKEN, ram: weakenHackThreads * scriptRam.WEAKEN, offsetMs: stageGapMs },
        { name: "GROW", threads: growThreads, durationMs: times.grow, scriptRam: scriptRam.GROW, ram: growThreads * scriptRam.GROW, offsetMs: 2 * stageGapMs },
        { name: "WEAKEN_GROW", threads: weakenGrowThreads, durationMs: times.weaken, scriptRam: scriptRam.WEAKEN, ram: weakenGrowThreads * scriptRam.WEAKEN, offsetMs: 3 * stageGapMs },
    ];
    const ramTimeGbSec = stages.reduce((sum, stage) => sum + stage.ram * ((stage.durationMs + DISPATCH_LEAD_MS) / 1000), 0);
    const batchRam = stages.reduce((sum, stage) => sum + stage.ram, 0);
    const expectedCash = maxMoney * actualHackFraction * hackChance;
    const difficulty = Math.max(1, Number(ns.getServerBaseSecurityLevel(hostname) ?? ns.getServerMinSecurityLevel(hostname) ?? 1));
    const actionThreadProxy = (hackThreads + growThreads + weakenHackThreads + weakenGrowThreads) * difficulty;
    const moneyEfficiency = ramTimeGbSec > 0 ? expectedCash / ramTimeGbSec : 0;
    const xpProxyEfficiency = ramTimeGbSec > 0 ? actionThreadProxy / ramTimeGbSec : 0;
    const firstLandingDelayMs = Math.max(times.hack, times.weaken - stageGapMs, times.grow - 2 * stageGapMs, times.weaken - 3 * stageGapMs) + START_LEAD_MS;
    const localBatchIntervalMs = stageGapMs * 4;
    const money = ns.getServerMoneyAvailable(hostname);
    const security = ns.getServerSecurityLevel(hostname);
    const minSecurity = ns.getServerMinSecurityLevel(hostname);

    return {
        ok: true,
        hostname,
        baselineRank: Number(entry?.baselineRank ?? entry?.rank ?? 0),
        economicRank: Number(entry?.economicRank ?? 0),
        maxMoney,
        hackChance,
        actualHackFraction,
        stages,
        threads: { hack: hackThreads, weakenHack: weakenHackThreads, grow: growThreads, weakenGrow: weakenGrowThreads },
        batchRam,
        ramTimeGbSec,
        expectedCash,
        moneyEfficiency,
        xpProxyEfficiency,
        firstLandingDelayMs,
        localBatchIntervalMs,
        preparedNow: maxMoney > 0 && money / maxMoney >= 0.995 && security - minSecurity <= 0.05,
    };
}

function normalizeScores(targets) {
    const maxMoney = Math.max(...targets.map((x) => x.moneyEfficiency), 1e-9);
    const maxXp = Math.max(...targets.map((x) => x.xpProxyEfficiency), 1e-9);
    for (const target of targets) {
        target.moneyScoreNorm = target.moneyEfficiency / maxMoney;
        target.xpScoreNorm = target.xpProxyEfficiency / maxXp;
    }
}

function findLandingStart(target, existingLandings, earliest) {
    let first = Math.max(earliest, Date.now() + target.firstLandingDelayMs);
    for (let guard = 0; guard < 2000; guard += 1) {
        const planned = target.stages.map((stage) => first + stage.offsetMs);
        const conflict = planned.some((time) => existingLandings.some((other) => Math.abs(time - other) < GLOBAL_LANDING_GAP_MS));
        if (!conflict) return first;
        first += GLOBAL_LANDING_GAP_MS;
    }
    return first;
}

function makeBatch(target, firstLandingAt, sequence) {
    const stages = target.stages.map((stage) => ({
        ...stage,
        startAt: firstLandingAt + stage.offsetMs - stage.durationMs,
        landingAt: firstLandingAt + stage.offsetMs,
    }));
    return {
        id: `multi-${target.hostname}-${sequence}`,
        target: target.hostname,
        firstLandingAt,
        finalLandingAt: firstLandingAt + 3 * (target.stages[1].offsetMs - target.stages[0].offsetMs),
        stages,
    };
}

function tryReserve(hosts, batch) {
    const tentative = hosts.map((host) => ({ ...host, reservations: [...host.reservations] }));
    const allocations = [];
    const stages = [...batch.stages].sort((a, b) => reservationStartAt(a) - reservationStartAt(b) || b.ram - a.ram);
    for (const stage of stages) {
        let remaining = stage.threads;
        const reserveStart = reservationStartAt(stage);
        const candidates = tentative.map((host) => {
            const occupied = maxReservedRam(host.reservations, reserveStart, stage.landingAt);
            const freeRam = Math.max(0, host.usableRam - occupied);
            return { host, capacity: Math.floor(freeRam / stage.scriptRam), freeRam };
        }).sort((a, b) => b.capacity - a.capacity || b.freeRam - a.freeRam || a.host.hostname.localeCompare(b.host.hostname));

        for (const candidate of candidates) {
            if (remaining <= 0) break;
            const threads = Math.min(remaining, candidate.capacity);
            if (threads < 1) continue;
            const ram = threads * stage.scriptRam;
            const reservation = { startAt: reserveStart, endAt: stage.landingAt, ram, target: batch.target, batchId: batch.id, stage: stage.name, threads };
            candidate.host.reservations.push(reservation);
            allocations.push({ hostname: candidate.host.hostname, stage: stage.name, threads, ram });
            remaining -= threads;
        }
        if (remaining > 0) return { ok: false, allocations: [], hosts: tentative };
    }
    return { ok: true, allocations, hosts: tentative };
}

function commitReservation(hosts, reservation) {
    for (let i = 0; i < hosts.length; i += 1) hosts[i].reservations = reservation.hosts[i].reservations;
}

function reservationStartAt(stage) { return Number(stage.startAt ?? 0) - DISPATCH_LEAD_MS; }

function maxReservedRam(reservations, startAt, endAt) {
    const events = [];
    for (const reservation of reservations) {
        if (reservation.endAt <= startAt || reservation.startAt >= endAt) continue;
        events.push({ at: Math.max(startAt, reservation.startAt), delta: reservation.ram });
        events.push({ at: Math.min(endAt, reservation.endAt), delta: -reservation.ram });
    }
    events.sort((a, b) => a.at - b.at || a.delta - b.delta);
    let current = 0;
    let peak = 0;
    for (const event of events) { current += event.delta; peak = Math.max(peak, current); }
    return peak;
}

function peakRam(reservations) {
    const events = [];
    for (const r of reservations) { events.push({ at: r.startAt, delta: r.ram }); events.push({ at: r.endAt, delta: -r.ram }); }
    events.sort((a, b) => a.at - b.at || a.delta - b.delta);
    let current = 0;
    let peak = 0;
    for (const event of events) { current += event.delta; peak = Math.max(peak, current); }
    return peak;
}

function printAnalysis(ns, state) {
    ns.tprint("=== MULTI-TARGET ALLOCATOR · DRY RUN ===");
    ns.tprint(`Profile ${state.profile?.toUpperCase?.() ?? state.profile} | status ${state.status} | workers launched: NO`);
    ns.tprint(state.reason);
    if (state.capacity) ns.tprint(`Remote RAM ${state.capacity.availableRam.toFixed(2)} GB / ${state.capacity.hostCount} hosts | admitted ${state.capacity.admitted}/${state.capacity.maxAdmissions} virtual batches`);
    for (const target of state.targets ?? []) {
        ns.tprint(`${target.hostname.padEnd(18)} depth ${String(target.assignedBatches).padStart(3)} | share ${(target.allocationShare * 100).toFixed(1).padStart(5)}% | score ${target.baseScore.toFixed(3)} | $/RAMs ${target.moneyEfficiency.toFixed(1)} | XPproxy/RAMs ${target.xpProxyEfficiency.toFixed(4)} | ${target.preparedNow ? "PREPARED" : "needs prep"}`);
    }
    ns.tprint("No workers were launched. Port 17 contains the full allocation snapshot.");
}

function normalizeProfile(value) {
    const profile = String(value ?? DEFAULT_PROFILE).trim().toLowerCase();
    return PROFILE_WEIGHTS[profile] ? profile : DEFAULT_PROFILE;
}
function finiteCeil(value) { return Number.isFinite(value) && value > 0 ? Math.max(1, Math.ceil(value)) : 1; }
function clamp(value, min, max) { return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min; }
function clampInt(value, min, max) { return Math.floor(clamp(value, min, max)); }
