import { WORKER_SCRIPTS, getExecutionPool } from "/lib/execution.js";
import { publishBatchSchedulerState, readLastCompletedBatchState, readPlannerState } from "/lib/runtime-state.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const DEFAULT_HACK_FRACTION = 0.10;
const DEFAULT_STAGE_GAP_MS = 200;
const MIN_STAGE_GAP_MS = 75;
const DEFAULT_BATCH_INTERVAL_MULTIPLIER = 4;
const MIN_TIMING_MARGIN_MS = 25;
const START_LEAD_MS = 150;
const MAX_DEPTH_SEARCH = 64;
const MAX_STEADY_BATCHES = 512;

/**
 * Dry-run planner for future pipelined HWGW scheduling.
 *
 * This script does NOT launch workers. It models a global landing calendar,
 * estimates safe intra-batch stage spacing and inter-batch admission spacing,
 * and simulates host-by-host RAM occupancy over time using the current remote
 * execution pool.
 *
 * Usage:
 *   run hacking/batch-scheduler.js <target> [hackFraction] [stageGapMs]
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    const args = positionalArgs(ns);
    const target = String(args[0] ?? "");
    const requestedHackFraction = clamp(Number(args[1] ?? DEFAULT_HACK_FRACTION), 0.001, 0.90);
    const requestedStageGapMs = Math.max(MIN_STAGE_GAP_MS, Math.floor(Number(args[2] ?? DEFAULT_STAGE_GAP_MS)));
    const quiet = isQuiet(ns);

    if (!target) {
        if (!quiet) ns.tprint("Usage: run hacking/batch-scheduler.js <target> [hackFraction] [stageGapMs]");
        return;
    }

    const planner = readPlannerState(ns);
    const last = readLastCompletedBatchState(ns);
    const analysis = analyzeScheduler(ns, planner, last, target, requestedHackFraction, requestedStageGapMs);
    publishBatchSchedulerState(ns, analysis);

    if (!quiet) printAnalysis(ns, analysis);
}

function analyzeScheduler(ns, planner, last, target, requestedHackFraction, requestedStageGapMs) {
    const now = Date.now();
    const maxMoney = ns.getServerMaxMoney(target);
    const money = ns.getServerMoneyAvailable(target);
    const minSecurity = ns.getServerMinSecurityLevel(target);
    const security = ns.getServerSecurityLevel(target);
    const hackPerThread = Math.max(0, ns.hackAnalyze(target));
    const weakenPerThread = Math.max(0, ns.weakenAnalyze(1, 1));

    const base = {
        version: 2,
        model: "PIPELINE_DRY_RUN_V2_HOST_WINDOWS",
        dryRun: true,
        target,
        createdAt: now,
        updatedAt: now,
        requestedHackFraction,
        requestedStageGapMs,
        status: "PLANNING",
        reason: "",
    };

    if (!(maxMoney > 0)) return { ...base, status: "BLOCKED", reason: "Target has no money" };
    if (!(hackPerThread > 0)) return { ...base, status: "BLOCKED", reason: "hackAnalyze returned zero" };
    if (!(weakenPerThread > 0)) return { ...base, status: "BLOCKED", reason: "weakenAnalyze returned zero" };

    const hackThreads = Math.max(1, Math.floor(requestedHackFraction / hackPerThread));
    const actualHackFraction = Math.min(0.90, hackThreads * hackPerThread);
    const recoveryMultiplier = 1 / Math.max(0.01, 1 - actualHackFraction);
    const growThreads = finiteCeil(ns.growthAnalyze(target, recoveryMultiplier, 1));
    const hackSecurity = Math.max(0, ns.hackAnalyzeSecurity(hackThreads, target));
    const growSecurity = Math.max(0, ns.growthAnalyzeSecurity(growThreads));
    const weakenHackThreads = Math.max(1, Math.ceil(hackSecurity / weakenPerThread));
    const weakenGrowThreads = Math.max(1, Math.ceil(growSecurity / weakenPerThread));

    const times = {
        hack: ns.getHackTime(target),
        grow: ns.getGrowTime(target),
        weaken: ns.getWeakenTime(target),
    };

    const telemetry = timingTelemetry(last, target);
    const tunedStageGapMs = recommendStageGap(requestedStageGapMs, telemetry);
    const requestedBatchIntervalMs = recommendBatchInterval(tunedStageGapMs, telemetry);
    const firstLandingDelayMs = Math.max(
        times.hack,
        times.weaken - tunedStageGapMs,
        times.grow - 2 * tunedStageGapMs,
        times.weaken - 3 * tunedStageGapMs,
    ) + START_LEAD_MS;

    const scriptRam = {
        HACK: ns.getScriptRam(WORKER_SCRIPTS.HACK, "home"),
        GROW: ns.getScriptRam(WORKER_SCRIPTS.GROW, "home"),
        WEAKEN: ns.getScriptRam(WORKER_SCRIPTS.WEAKEN, "home"),
    };
    if (!(scriptRam.HACK > 0 && scriptRam.GROW > 0 && scriptRam.WEAKEN > 0)) {
        return { ...base, status: "BLOCKED", reason: "Could not determine worker RAM" };
    }

    const stageTemplate = [
        { name: "HACK", threads: hackThreads, durationMs: times.hack, scriptRam: scriptRam.HACK, ram: hackThreads * scriptRam.HACK, offsetMs: 0 },
        { name: "WEAKEN_HACK", threads: weakenHackThreads, durationMs: times.weaken, scriptRam: scriptRam.WEAKEN, ram: weakenHackThreads * scriptRam.WEAKEN, offsetMs: tunedStageGapMs },
        { name: "GROW", threads: growThreads, durationMs: times.grow, scriptRam: scriptRam.GROW, ram: growThreads * scriptRam.GROW, offsetMs: 2 * tunedStageGapMs },
        { name: "WEAKEN_GROW", threads: weakenGrowThreads, durationMs: times.weaken, scriptRam: scriptRam.WEAKEN, ram: weakenGrowThreads * scriptRam.WEAKEN, offsetMs: 3 * tunedStageGapMs },
    ];

    const pool = getExecutionPool(ns, planner);
    const availableRam = pool.reduce((sum, host) => sum + Math.max(0, Number(host.usableRam ?? 0)), 0);
    if (!(availableRam > 0) || pool.length === 0) {
        return { ...base, status: "BLOCKED", reason: "No remote execution RAM is currently available" };
    }

    const firstLandingAt = now + firstLandingDelayMs;
    const simulations = [];
    let burstDepth = 0;
    let depthSearchLimited = false;

    for (let depth = 1; depth <= MAX_DEPTH_SEARCH; depth += 1) {
        const batches = makeBatches(stageTemplate, depth, firstLandingAt, requestedBatchIntervalMs);
        const aggregatePeak = peakRamUsage(batches);
        const hostReservation = reserveHostWindows(pool, batches);
        const fits = aggregatePeak.peakRam <= availableRam + 1e-9 && hostReservation.ok;
        simulations.push({
            depth,
            peakRam: aggregatePeak.peakRam,
            peakAt: aggregatePeak.peakAt,
            fits,
            hostFit: hostReservation.ok,
            blockedStage: hostReservation.blockedStage ?? "",
            blockedBatch: hostReservation.blockedBatch ?? 0,
        });
        if (!fits) break;
        burstDepth = depth;
        if (depth === MAX_DEPTH_SEARCH) depthSearchLimited = true;
    }

    const steady = findSteadyInterval(pool, stageTemplate, firstLandingAt, requestedBatchIntervalMs, tunedStageGapMs);
    const effectiveBatchIntervalMs = steady.ok ? steady.intervalMs : requestedBatchIntervalMs;
    const calendarDepth = Math.min(Math.max(2, Math.min(burstDepth || 1, 4)), 4);
    const calendarPreview = makeBatches(stageTemplate, calendarDepth, firstLandingAt, effectiveBatchIntervalMs)
        .flatMap((batch) => batch.stages.map((stage) => ({
            batch: batch.index,
            stage: stage.name,
            landingAt: stage.landingAt,
            startAt: stage.startAt,
            finishAt: stage.landingAt,
            ram: stage.ram,
        })))
        .sort((a, b) => a.landingAt - b.landingAt);

    return {
        ...base,
        status: burstDepth > 0 && steady.ok ? "READY" : "BLOCKED",
        reason: burstDepth > 0 && steady.ok
            ? "Dry-run host-window planner found a feasible burst depth and sustainable batch interval"
            : burstDepth < 1
                ? "Even one modeled batch cannot be reserved across current remote hosts"
                : "Burst batching fits, but no sustainable interval was found in the current search range",
        currentTarget: {
            money,
            maxMoney,
            moneyPercent: maxMoney > 0 ? money / maxMoney : 0,
            security,
            minSecurity,
            securityDelta: Math.max(0, security - minSecurity),
        },
        actualHackFraction,
        threads: {
            hack: hackThreads,
            weakenHack: weakenHackThreads,
            grow: growThreads,
            weakenGrow: weakenGrowThreads,
        },
        timing: {
            actionTimesMs: times,
            telemetry,
            requestedStageGapMs,
            tunedStageGapMs,
            requestedBatchIntervalMs,
            tunedBatchIntervalMs: effectiveBatchIntervalMs,
            firstLandingDelayMs,
            batchLandingWindowMs: 3 * tunedStageGapMs,
            tuningMode: telemetry.samples > 0 ? "TELEMETRY_ASSISTED" : "CONSERVATIVE_DEFAULT",
            steadyState: steady,
        },
        ram: {
            availableRam,
            hostCount: pool.length,
            singleBatchRam: stageTemplate.reduce((sum, stage) => sum + stage.ram, 0),
            burstDepth,
            safeDepth: burstDepth,
            depthSearchLimited,
            maxDepthSearch: MAX_DEPTH_SEARCH,
            simulations,
        },
        stageTemplate,
        calendarPreview,
        notes: [
            "Dry-run only: no workers are launched.",
            "Stage gap controls H→W1→G→W2 spacing inside each batch.",
            "Batch interval controls H(N)→H(N+1) spacing across the landing stream.",
            "Burst depth and sustainable interval are different: a short burst can fit even when that cadence cannot be maintained indefinitely.",
            "RAM is reserved host-by-host over each stage's planned execution window; one stage may be split across several hosts.",
            "Current free RAM is treated conservatively as the scheduling capacity for the whole simulation; RAM already occupied by unrelated/current work is not assumed to become available later.",
            "One retained completed batch is not enough for aggressive timing reduction; recommendations remain conservative until history exists.",
        ],
    };
}

function timingTelemetry(last, target) {
    if (!last) {
        return { samples: 0, source: "NONE", reason: "No retained completed batch", orderCorrect: null, minimumSpacingMs: null, maxAbsLandingErrorMs: null, maxAllocationSpreadMs: null };
    }
    if (String(last.target ?? "") !== target) {
        return { samples: 0, source: "PORT15", reason: `Retained batch target ${String(last.target ?? "?")} does not match ${target}`, orderCorrect: null, minimumSpacingMs: null, maxAbsLandingErrorMs: null, maxAllocationSpreadMs: null };
    }
    if (last.status !== "COMPLETE") {
        return { samples: 0, source: "PORT15", reason: `Retained batch status is ${String(last.status ?? "UNKNOWN")}`, orderCorrect: null, minimumSpacingMs: null, maxAbsLandingErrorMs: null, maxAllocationSpreadMs: null };
    }
    const stages = Array.isArray(last.landing?.stages) ? last.landing.stages : [];
    const spreads = stages.map((stage) => Number(stage.allocationSpreadMs ?? 0)).filter(Number.isFinite);
    return {
        samples: 1,
        source: "PORT15",
        reason: "Matching retained completed batch",
        batchId: String(last.batchId ?? ""),
        orderCorrect: Boolean(last.landing?.orderCorrect),
        minimumSpacingMs: finiteOrNull(last.landing?.minimumSpacingMs),
        maxAbsLandingErrorMs: finiteOrNull(last.landing?.maxAbsLandingErrorMs),
        maxAllocationSpreadMs: spreads.length ? Math.max(...spreads) : 0,
    };
}

function recommendStageGap(requestedGapMs, telemetry) {
    if (!(telemetry.samples > 0)) return requestedGapMs;
    const drift = Math.max(0, Number(telemetry.maxAbsLandingErrorMs ?? 0));
    const spread = Math.max(0, Number(telemetry.maxAllocationSpreadMs ?? 0));
    const observedRisk = drift + spread + MIN_TIMING_MARGIN_MS;
    return Math.max(requestedGapMs, Math.ceil(observedRisk));
}

function recommendBatchInterval(stageGapMs, telemetry) {
    const nominal = stageGapMs * DEFAULT_BATCH_INTERVAL_MULTIPLIER;
    if (!(telemetry.samples > 0)) return nominal;
    const drift = Math.max(0, Number(telemetry.maxAbsLandingErrorMs ?? 0));
    const spread = Math.max(0, Number(telemetry.maxAllocationSpreadMs ?? 0));
    return Math.max(nominal, Math.ceil(3 * stageGapMs + drift + spread + MIN_TIMING_MARGIN_MS));
}

function findSteadyInterval(pool, stageTemplate, firstLandingAt, minimumIntervalMs, stageGapMs) {
    const maxDurationMs = Math.max(...stageTemplate.map((stage) => stage.durationMs));
    const landingWindowMs = 3 * stageGapMs;
    const upperBoundMs = Math.ceil(maxDurationMs + landingWindowMs + stageGapMs);
    const test = (intervalMs) => {
        const requiredDepth = Math.min(
            MAX_STEADY_BATCHES,
            Math.max(3, Math.ceil((maxDurationMs + landingWindowMs) / intervalMs) + 3),
        );
        const batches = makeBatches(stageTemplate, requiredDepth, firstLandingAt, intervalMs);
        const hostReservation = reserveHostWindows(pool, batches);
        const aggregatePeak = peakRamUsage(batches);
        return {
            ok: hostReservation.ok,
            intervalMs,
            requiredDepth,
            peakRam: aggregatePeak.peakRam,
            blockedStage: hostReservation.blockedStage ?? "",
            blockedBatch: hostReservation.blockedBatch ?? 0,
            truncated: requiredDepth >= MAX_STEADY_BATCHES,
        };
    };

    const minimum = Math.max(1, Math.floor(minimumIntervalMs));
    const minTest = test(minimum);
    if (minTest.ok && !minTest.truncated) return minTest;

    const upperTest = test(upperBoundMs);
    if (!upperTest.ok || upperTest.truncated) {
        return { ...upperTest, ok: false, reason: upperTest.truncated ? "steady-state horizon exceeded simulation cap" : "host reservation still blocked at upper search bound" };
    }

    let low = minimum;
    let high = upperBoundMs;
    let best = upperTest;
    while (high - low > 25) {
        const mid = Math.floor((low + high) / 2);
        const result = test(mid);
        if (result.ok && !result.truncated) {
            best = result;
            high = mid;
        } else {
            low = mid + 1;
        }
    }

    for (let interval = Math.max(minimum, low - 25); interval <= high; interval += 1) {
        const result = test(interval);
        if (result.ok && !result.truncated) return result;
    }
    return best;
}

function makeBatches(stageTemplate, depth, firstLandingAt, batchIntervalMs) {
    const batches = [];
    for (let index = 0; index < depth; index += 1) {
        const batchFirstLandingAt = firstLandingAt + index * batchIntervalMs;
        const stages = stageTemplate.map((stage) => {
            const landingAt = batchFirstLandingAt + stage.offsetMs;
            return {
                ...stage,
                batch: index + 1,
                landingAt,
                startAt: landingAt - stage.durationMs,
            };
        });
        batches.push({ index: index + 1, firstLandingAt: batchFirstLandingAt, stages });
    }
    return batches;
}

function reserveHostWindows(pool, batches) {
    const hosts = pool.map((host) => ({
        hostname: host.hostname,
        usableRam: Math.max(0, Number(host.usableRam ?? 0)),
        reservations: [],
    }));
    const stages = batches
        .flatMap((batch) => batch.stages)
        .sort((a, b) => a.startAt - b.startAt || b.ram - a.ram || a.landingAt - b.landingAt);

    for (const stage of stages) {
        let remainingThreads = stage.threads;
        const candidates = hosts.map((host) => {
            const occupied = maxReservedRam(host.reservations, stage.startAt, stage.landingAt);
            const freeRam = Math.max(0, host.usableRam - occupied);
            return { host, freeRam, capacity: Math.floor(freeRam / stage.scriptRam) };
        }).sort((a, b) => b.capacity - a.capacity || b.freeRam - a.freeRam || a.host.hostname.localeCompare(b.host.hostname));

        for (const candidate of candidates) {
            if (remainingThreads <= 0) break;
            const threads = Math.min(remainingThreads, candidate.capacity);
            if (threads < 1) continue;
            const ram = threads * stage.scriptRam;
            candidate.host.reservations.push({
                startAt: stage.startAt,
                endAt: stage.landingAt,
                ram,
                batch: stage.batch,
                stage: stage.name,
                threads,
            });
            remainingThreads -= threads;
        }

        if (remainingThreads > 0) {
            return {
                ok: false,
                blockedBatch: stage.batch,
                blockedStage: stage.name,
                missingThreads: remainingThreads,
                hosts,
            };
        }
    }

    return { ok: true, blockedBatch: 0, blockedStage: "", missingThreads: 0, hosts };
}

function maxReservedRam(reservations, startAt, endAt) {
    const events = [];
    for (const reservation of reservations) {
        if (reservation.endAt <= startAt || reservation.startAt >= endAt) continue;
        const start = Math.max(startAt, reservation.startAt);
        const end = Math.min(endAt, reservation.endAt);
        events.push({ at: start, delta: reservation.ram });
        events.push({ at: end, delta: -reservation.ram });
    }
    events.sort((a, b) => a.at - b.at || a.delta - b.delta);
    let current = 0;
    let peak = 0;
    for (const event of events) {
        current += event.delta;
        peak = Math.max(peak, current);
    }
    return peak;
}

function peakRamUsage(batches) {
    const events = [];
    for (const batch of batches) {
        for (const stage of batch.stages) {
            events.push({ at: stage.startAt, delta: stage.ram });
            events.push({ at: stage.landingAt, delta: -stage.ram });
        }
    }
    events.sort((a, b) => a.at - b.at || a.delta - b.delta);
    let current = 0;
    let peakRam = 0;
    let peakAt = 0;
    for (const event of events) {
        current += event.delta;
        if (current > peakRam) {
            peakRam = current;
            peakAt = event.at;
        }
    }
    return { peakRam, peakAt };
}

function printAnalysis(ns, state) {
    ns.tprint(`[PIPELINE] ${state.status} ${state.target} | ${state.reason}`);
    if (!state.timing || !state.ram) return;
    ns.tprint(`[PIPELINE] Stage gap requested ${state.timing.requestedStageGapMs}ms → tuned ${state.timing.tunedStageGapMs}ms`);
    ns.tprint(`[PIPELINE] Batch interval requested ${state.timing.requestedBatchIntervalMs}ms → sustainable ${state.timing.tunedBatchIntervalMs}ms | mode ${state.timing.tuningMode}`);
    ns.tprint(`[PIPELINE] Timing telemetry ${state.timing.telemetry.samples} sample(s) | ${state.timing.telemetry.reason}`);
    ns.tprint(`[PIPELINE] Threads ${state.threads.hack}H / ${state.threads.weakenHack}W / ${state.threads.grow}G / ${state.threads.weakenGrow}W`);
    ns.tprint(`[PIPELINE] RAM available ${state.ram.availableRam.toFixed(2)} GB across ${state.ram.hostCount} hosts | one batch ${state.ram.singleBatchRam.toFixed(2)} GB`);
    ns.tprint(`[PIPELINE] Burst depth ${state.ram.burstDepth}${state.ram.depthSearchLimited ? `+ (search capped at ${state.ram.maxDepthSearch})` : ""} | steady-state concurrent window ${state.timing.steadyState.requiredDepth} batch(es) | peak ${state.timing.steadyState.peakRam.toFixed(2)} GB`);
    for (const row of state.ram.simulations) {
        const block = row.fits ? "FIT" : `BLOCKED${row.blockedStage ? ` at batch ${row.blockedBatch} ${row.blockedStage}` : ""}`;
        ns.tprint(`[PIPELINE] depth ${row.depth}: peak ${row.peakRam.toFixed(2)} GB ${block}`);
    }
}

function finiteCeil(value) {
    return Number.isFinite(value) && value > 0 ? Math.max(1, Math.ceil(value)) : 1;
}

function finiteOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function clamp(value, minimum, maximum) {
    if (!Number.isFinite(value)) return minimum;
    return Math.min(maximum, Math.max(minimum, value));
}
