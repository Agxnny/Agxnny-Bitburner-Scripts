import { getExecutionPool } from "/lib/execution.js";
import { readOverlapEvidence } from "/lib/multi-overlap-evidence.js";
import { targetOverlapPolicy } from "/lib/multi-overlap-policy.js";
import { multiTargetRankings } from "/lib/multi-target-ranking.js";
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
    readBatchHistoryState,
    readEconomyTargetState,
    readPlannerState,
    readPrepperState,
} from "/lib/runtime-state.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const DEFAULT_PROFILE = "money";
const DEFAULT_TARGET_COUNT = 4;
const DEFAULT_HACK_FRACTION = 0.10;
const DEFAULT_STAGE_GAP_MS = 200;
const DEFAULT_MAX_IN_FLIGHT = 64;
const GLOBAL_LANDING_GAP_MS = 100;
const FAIRNESS_PENALTY = 0.30;
const LOOP_MS = 250;
const TARGET_REFRESH_MS = 2_000;
const TERMINAL_SUMMARY_MS = 10_000;
const RECENT_COMPLETION_WINDOW_MS = 60_000;
const PROFILE_WEIGHTS = Object.freeze({
    money: { money: 1.00, xp: 0.00 },
    balanced: { money: 0.70, xp: 0.30 },
    xp: { money: 0.00, xp: 1.00 },
});

/**
 * Persistent planning-only multi-target admission simulation.
 *
 * Candidate overlap depth comes from the same policy used by diagnostics and
 * future real MULTI. Pipeline history can simulate a depth-2 validation
 * candidate, while dedicated evidence is published separately as production
 * proof. This script launches no workers and never consumes Port 14.
 *
 * Usage:
 *   run hacking/multi-target-sim.js [money|balanced|xp] [targetCount] [hackFraction] [stageGapMs] [maxInFlight]
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    const args = positionalArgs(ns);
    const profile = normalizeProfile(args[0]);
    const targetCount = clampInt(Number(args[1] ?? DEFAULT_TARGET_COUNT), 2, 12);
    const hackFraction = clamp(Number(args[2] ?? DEFAULT_HACK_FRACTION), 0.001, 0.90);
    const stageGapMs = Math.max(75, Math.floor(Number(args[3] ?? DEFAULT_STAGE_GAP_MS)));
    const maxInFlight = clampInt(Number(args[4] ?? DEFAULT_MAX_IN_FLIGHT), 2, 256);
    const quiet = isQuiet(ns);
    const weights = PROFILE_WEIGHTS[profile];

    if (ns.getHostname() !== "home") {
        if (!quiet) ns.tprint("ERROR: Run hacking/multi-target-sim.js from home.");
        return;
    }

    const startedAt = Date.now();
    let hosts = [];
    let hostSetKey = "";
    let templates = [];
    let targetRefreshAt = 0;
    let sequence = 0;
    let inFlight = [];
    let completions = [];
    let totalAdmitted = 0;
    let totalCompleted = 0;
    let blockedTicks = 0;
    let poolResets = 0;
    let lastTerminalSummaryAt = 0;
    const nextLandingByTarget = new Map();
    const lifetimeByTarget = new Map();

    if (!quiet) {
        ns.tprint("=== MULTI-TARGET ADMISSION SIM · SHARED OVERLAP POLICY ===");
        ns.tprint(`Profile ${profile.toUpperCase()} | workers launched: NO | Port 17 live state`);
        ns.tprint("Candidate depth and dedicated production proof are shown separately.");
    }

    while (true) {
        const now = Date.now();
        const planner = readPlannerState(ns);
        const economic = readEconomyTargetState(ns);
        const batchHistory = readBatchHistoryState(ns);
        const overlapEvidence = readOverlapEvidence(ns);
        const pool = getExecutionPool(ns, planner);
        const newHostSetKey = pool.map((host) => host.hostname).sort().join("|");

        if (hostSetKey && newHostSetKey !== hostSetKey) {
            hosts = [];
            inFlight = [];
            nextLandingByTarget.clear();
            poolResets += 1;
        }
        hostSetKey = newHostSetKey;
        hosts = createHostCalendar(pool, hosts, now);

        const justCompleted = inFlight.filter((batch) => batch.finalLandingAt <= now);
        for (const batch of justCompleted) {
            totalCompleted += 1;
            completions.push({ target: batch.target, completedAt: now, expectedCash: batch.expectedCash });
            const life = getLife(lifetimeByTarget, batch.target);
            life.completed += 1;
            life.expectedCashCompleted += batch.expectedCash;
        }
        if (justCompleted.length) inFlight = inFlight.filter((batch) => batch.finalLandingAt > now);
        completions = completions.filter((entry) => entry.completedAt >= now - RECENT_COMPLETION_WINDOW_MS);

        if (now >= targetRefreshAt) {
            templates = multiTargetRankings(planner, economic, profile)
                .slice(0, targetCount)
                .map((entry) => buildPreparedBatchTemplate(ns, entry, hackFraction, stageGapMs))
                .filter((entry) => entry.ok);
            normalizeObjectiveScores(templates, weights);
            for (const target of templates) {
                if (!nextLandingByTarget.has(target.hostname)) nextLandingByTarget.set(target.hostname, now + target.firstLandingDelayMs);
            }
            targetRefreshAt = now + TARGET_REFRESH_MS;
        }

        const landingTimes = inFlight.flatMap((batch) => batch.stageLandings).filter((time) => time > now).sort((a, b) => a - b);
        let admittedThisTick = 0;

        while (pool.length > 0 && inFlight.length < maxInFlight) {
            const candidates = [];
            for (const target of templates) {
                if (!target.preparedNow) continue;
                const targetDepth = inFlight.filter((batch) => batch.target === target.hostname).length;
                const policy = targetOverlapPolicy(batchHistory, target.hostname, overlapEvidence);
                const depthCap = clampInt(Number(policy.candidateDepth ?? 1), 1, 2);
                if (targetDepth >= depthCap) continue;

                const earliest = Number(nextLandingByTarget.get(target.hostname) ?? now + target.firstLandingDelayMs);
                const firstLandingAt = findLandingStart(target, landingTimes, earliest, GLOBAL_LANDING_GAP_MS, now);
                const batch = makeBatch(target, firstLandingAt, ++sequence);
                const reservation = tryReserve(hosts, batch);
                if (!reservation.ok) continue;

                const adjustedScore = target.baseScore / (1 + FAIRNESS_PENALTY * targetDepth);
                candidates.push({ target, batch, reservation, adjustedScore, targetDepth, depthCap, policy });
            }

            if (!candidates.length) {
                blockedTicks += 1;
                break;
            }

            candidates.sort((a, b) => b.adjustedScore - a.adjustedScore
                || a.targetDepth - b.targetDepth
                || b.target.expectedCash - a.target.expectedCash
                || a.target.hostname.localeCompare(b.target.hostname));
            const chosen = candidates[0];
            commitReservation(hosts, chosen.reservation);
            for (const stage of chosen.batch.stages) landingTimes.push(stage.landingAt);
            landingTimes.sort((a, b) => a - b);
            nextLandingByTarget.set(chosen.target.hostname, chosen.batch.firstLandingAt + chosen.target.localBatchIntervalMs);

            inFlight.push({
                id: chosen.batch.id,
                target: chosen.target.hostname,
                admittedAt: now,
                firstLandingAt: chosen.batch.firstLandingAt,
                finalLandingAt: chosen.batch.finalLandingAt,
                stageLandings: chosen.batch.stages.map((stage) => stage.landingAt),
                score: chosen.adjustedScore,
                expectedCash: chosen.target.expectedCash,
                ramTimeGbSec: chosen.target.ramTimeGbSec,
                candidateDepthCap: chosen.depthCap,
                productionProvenDepth: Number(chosen.policy.provenDepth ?? 1),
                overlapSource: String(chosen.policy.source ?? "UNPROVEN"),
                allocations: chosen.reservation.allocations,
            });
            admittedThisTick += 1;
            totalAdmitted += 1;
            const life = getLife(lifetimeByTarget, chosen.target.hostname);
            life.admitted += 1;
            life.expectedCashAdmitted += chosen.target.expectedCash;
        }

        const prepper = readPrepperState(ns);
        const totalRam = pool.reduce((sum, host) => sum + Number(host.usableRam ?? 0), 0);
        const targetStates = templates.map((target) => {
            const active = inFlight.filter((batch) => batch.target === target.hostname);
            const recentCompleted = completions.filter((entry) => entry.target === target.hostname).length;
            const life = getLife(lifetimeByTarget, target.hostname);
            const policy = targetOverlapPolicy(batchHistory, target.hostname, overlapEvidence);
            const candidateDepthCap = clampInt(Number(policy.candidateDepth ?? 1), 1, 2);
            const capReached = target.preparedNow && active.length >= candidateDepthCap;
            return {
                hostname: target.hostname,
                preparedNow: target.preparedNow,
                schedulerState: target.preparedNow
                    ? (active.length > 0 ? (capReached ? "AT_CANDIDATE_CAP" : "RUNNING") : "READY")
                    : "WAITING_PREP",
                moneyRatio: target.moneyRatio,
                securityDelta: target.securityDelta,
                baseScore: target.baseScore,
                moneyEfficiency: target.moneyEfficiency,
                xpProxyEfficiency: target.xpProxyEfficiency,
                activeDepth: active.length,
                candidateDepthCap,
                productionProvenDepth: Number(policy.provenDepth ?? 1),
                eligibleForValidation: Boolean(policy.eligibleForValidation),
                eligibleForOverlap: Boolean(policy.eligibleForOverlap),
                overlapSource: String(policy.source ?? "UNPROVEN"),
                overlapReason: String(policy.reason ?? ""),
                recentCompleted,
                lifetimeAdmitted: life.admitted,
                lifetimeCompleted: life.completed,
                expectedCashAdmitted: life.expectedCashAdmitted,
                expectedCashCompleted: life.expectedCashCompleted,
                nextFirstLandingAt: Number(nextLandingByTarget.get(target.hostname) ?? 0),
                threads: target.threads,
                batchRam: target.batchRam,
                ramTimeGbSec: target.ramTimeGbSec,
            };
        }).sort((a, b) => b.activeDepth - a.activeDepth || b.baseScore - a.baseScore);

        const state = {
            version: 4,
            model: "MULTI_TARGET_ADMISSION_SIM_V4_SHARED_OVERLAP_POLICY",
            dryRun: true,
            persistent: true,
            launchesWorkers: false,
            consumesBatchTimingPort: false,
            profile,
            targetCount,
            requestedHackFraction: hackFraction,
            stageGapMs,
            globalLandingGapMs: GLOBAL_LANDING_GAP_MS,
            status: pool.length === 0 ? "BLOCKED" : "RUNNING",
            reason: pool.length === 0
                ? "No remote production RAM available"
                : `${inFlight.length} virtual batch(es) in flight; shared overlap policy caps candidate depth at 1/2`,
            startedAt,
            updatedAt: now,
            runtimeMs: now - startedAt,
            capacity: {
                hostCount: pool.length,
                availableRam: totalRam,
                maxInFlight,
                inFlight: inFlight.length,
                admittedThisTick,
                totalAdmitted,
                totalCompleted,
                blockedTicks,
                fairnessPenalty: FAIRNESS_PENALTY,
                poolResets,
            },
            objective: {
                profile,
                moneyWeight: weights.money,
                xpWeight: weights.xp,
                xpMetric: "ACTION_THREAD_DIFFICULTY_PROXY_PER_RAM_SECOND",
            },
            prepper: {
                online: Boolean(prepper && Date.now() - Number(prepper.updatedAt ?? 0) <= 5_000),
                status: String(prepper?.status ?? "UNKNOWN"),
                preparedCount: Number(prepper?.preparedCount ?? 0),
                targetCount: Number(prepper?.targetCount ?? 0),
            },
            overlapEvidence: {
                model: String(overlapEvidence?.model ?? ""),
                updatedAt: Number(overlapEvidence?.updatedAt ?? 0),
                targetCount: Object.keys(overlapEvidence?.targets ?? {}).length,
            },
            targets: targetStates,
            inFlight: inFlight.slice(0, 64),
            recentCompletions: completions.slice(-32),
            hostPeak: hosts.map((host) => ({
                hostname: host.hostname,
                usableRam: host.usableRam,
                peakReservedRam: peakRam(host.reservations),
                reservationCount: host.reservations.length,
            })).sort((a, b) => b.peakReservedRam - a.peakReservedRam).slice(0, 16),
            notes: [
                "Planning only: no H/G/W workers are launched and Port 14 is untouched.",
                "Shared overlap policy distinguishes depth-2 validation candidates from dedicated production proof.",
                "Simulation may model candidate depth 2 before production proof so capacity can be evaluated safely.",
                "Future real MULTI must use productionProvenDepth, not candidateDepthCap, for admissions.",
                "Only prepared targets at >=99.5% money and <=+0.05 security receive virtual admissions.",
            ],
        };
        publishMultiTargetSchedulerState(ns, state);

        if (!quiet && now - lastTerminalSummaryAt >= TERMINAL_SUMMARY_MS) {
            lastTerminalSummaryAt = now;
            printSummary(ns, state);
        }
        await ns.sleep(LOOP_MS);
    }
}

function getLife(map, hostname) {
    if (!map.has(hostname)) map.set(hostname, { admitted: 0, completed: 0, expectedCashAdmitted: 0, expectedCashCompleted: 0 });
    return map.get(hostname);
}
function printSummary(ns, state) {
    ns.tprint(`[MULTI-SIM] ${state.profile.toUpperCase()} | ${state.capacity.inFlight}/${state.capacity.maxInFlight} in flight | ${state.capacity.totalAdmitted} admitted | ${state.capacity.totalCompleted} completed | ${state.capacity.availableRam.toFixed(1)} GB / ${state.capacity.hostCount} hosts`);
    for (const target of state.targets ?? []) {
        ns.tprint(`  ${target.hostname.padEnd(18)} depth ${String(target.activeDepth).padStart(2)}/${target.candidateDepthCap} candidate · proven ${target.productionProvenDepth} | ${target.schedulerState.padEnd(16)} | ${target.overlapSource}`);
    }
}
function normalizeProfile(value) {
    const profile = String(value ?? DEFAULT_PROFILE).trim().toLowerCase();
    return PROFILE_WEIGHTS[profile] ? profile : DEFAULT_PROFILE;
}
function clamp(value, min, max) { return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min; }
function clampInt(value, min, max) { return Math.floor(clamp(value, min, max)); }
