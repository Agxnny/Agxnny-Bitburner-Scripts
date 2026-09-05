import { getExecutionPool } from "/lib/execution.js";
import {
    buildPreparedBatchTemplate,
    commitReservation,
    createHostCalendar,
    findLandingStart,
    makeBatch,
    normalizeObjectiveScores,
    peakRam,
    tryReserve,
} from "/lib/batch-allocation.js";
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
const MAX_ADMISSIONS = 128;
const FAIRNESS_PENALTY = 0.30;
const PROFILE_WEIGHTS = Object.freeze({
    money: { money: 1.00, xp: 0.00 },
    balanced: { money: 0.70, xp: 0.30 },
    xp: { money: 0.00, xp: 1.00 },
});

/** Planning-only one-shot global multi-target allocator. Never launches workers. @param {NS} ns */
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
    const rankings = sourceRankings(planner, economic, profile).slice(0, targetCount);
    const base = {
        version: 2,
        model: "MULTI_TARGET_ALLOCATOR_DRY_RUN_V2_SHARED",
        dryRun: true,
        persistent: false,
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

    const templates = rankings.map((entry) => buildPreparedBatchTemplate(ns, entry, hackFraction, stageGapMs)).filter((x) => x.ok);
    if (templates.length < 2) return { ...base, status: "BLOCKED", reason: "Fewer than two targets produced valid HWGW templates", targets: templates, allocations: [] };

    const weights = PROFILE_WEIGHTS[profile];
    normalizeObjectiveScores(templates, weights);
    for (const target of templates) {
        target.admissions = 0;
        target.nextFirstLandingAt = now + target.firstLandingDelayMs;
        target.reservedRamTimeGbSec = 0;
        target.expectedCashAllocated = 0;
    }

    const hosts = createHostCalendar(pool, [], now);
    const landingTimes = [];
    const allocations = [];
    let blockedRounds = 0;

    for (let sequence = 1; sequence <= maxAdmissions; sequence += 1) {
        const candidates = [];
        for (const target of templates) {
            const firstLandingAt = findLandingStart(target, landingTimes, target.nextFirstLandingAt, GLOBAL_LANDING_GAP_MS, now);
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
        moneyRatio: target.moneyRatio,
        securityDelta: target.securityDelta,
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
        objective: { profile, moneyWeight: weights.money, xpWeight: weights.xp, xpMetric: "ACTION_THREAD_DIFFICULTY_PROXY_PER_RAM_SECOND" },
        targets,
        allocations: allocations.slice(0, 64),
        hostPeak: hostPeak.slice(0, 16),
        notes: [
            "Planning only: no H/G/W workers are launched.",
            "Shared batch-template and host-reservation helpers are also used by the persistent simulator.",
            "PreparedNow remains diagnostic in this one-shot dry run; the persistent simulator only admits prepared targets.",
            "XP mode currently uses an explicit proxy, not exact Bitburner hacking-exp formulas.",
            "This does not own Port 14 or replace the live single-target PIPELINE executor.",
        ],
    };
}

function sourceRankings(planner, economic, profile) {
    if (profile === "xp") return Array.isArray(planner?.rankings) ? planner.rankings : [];
    const economicRows = Array.isArray(economic?.rankings) ? economic.rankings : [];
    if (economicRows.length >= 2) return economicRows;
    return Array.isArray(planner?.rankings) ? planner.rankings : [];
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
function clamp(value, min, max) { return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min; }
function clampInt(value, min, max) { return Math.floor(clamp(value, min, max)); }
