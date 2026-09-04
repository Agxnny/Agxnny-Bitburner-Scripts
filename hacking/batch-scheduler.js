import { WORKER_SCRIPTS, getExecutionPool } from "/lib/execution.js";
import { publishBatchSchedulerState, readLastCompletedBatchState, readPlannerState } from "/lib/runtime-state.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const DEFAULT_HACK_FRACTION = 0.10;
const DEFAULT_STAGE_GAP_MS = 200;
const MIN_STAGE_GAP_MS = 75;
const DEFAULT_BATCH_INTERVAL_MULTIPLIER = 4;
const MIN_TIMING_MARGIN_MS = 25;
const START_LEAD_MS = 150;
const MAX_SIMULATED_BATCHES = 12;

/**
 * Dry-run planner for future pipelined HWGW scheduling.
 *
 * This script does NOT launch workers. It models a global landing calendar,
 * estimates safe intra-batch stage spacing and inter-batch admission spacing,
 * and simulates RAM occupancy over time using the current execution pool.
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
        version: 1,
        model: "PIPELINE_DRY_RUN_V1",
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
    const tunedBatchIntervalMs = recommendBatchInterval(tunedStageGapMs, telemetry);
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
        { name: "HACK", threads: hackThreads, durationMs: times.hack, ram: hackThreads * scriptRam.HACK, offsetMs: 0 },
        { name: "WEAKEN_HACK", threads: weakenHackThreads, durationMs: times.weaken, ram: weakenHackThreads * scriptRam.WEAKEN, offsetMs: tunedStageGapMs },
        { name: "GROW", threads: growThreads, durationMs: times.grow, ram: growThreads * scriptRam.GROW, offsetMs: 2 * tunedStageGapMs },
        { name: "WEAKEN_GROW", threads: weakenGrowThreads, durationMs: times.weaken, ram: weakenGrowThreads * scriptRam.WEAKEN, offsetMs: 3 * tunedStageGapMs },
    ];

    const pool = getExecutionPool(ns, planner);
    const availableRam = pool.reduce((sum, host) => sum + Math.max(0, Number(host.usableRam ?? 0)), 0);
    const firstLandingAt = now + firstLandingDelayMs;
    const simulations = [];
    let safeDepth = 0;

    for (let depth = 1; depth <= MAX_SIMULATED_BATCHES; depth += 1) {
        const batches = makeBatches(stageTemplate, depth, firstLandingAt, tunedBatchIntervalMs);
        const peak = peakRamUsage(batches);
        const fits = peak.peakRam <= availableRam + 1e-9;
        simulations.push({ depth, peakRam: peak.peakRam, peakAt: peak.peakAt, fits });
        if (!fits) break;
        safeDepth = depth;
    }

    const calendarPreview = makeBatches(stageTemplate, Math.min(Math.max(2, safeDepth), 4), firstLandingAt, tunedBatchIntervalMs)
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
        status: safeDepth > 0 ? "READY" : "BLOCKED",
        reason: safeDepth > 0
            ? "Dry-run pipeline calendar fits current aggregate remote RAM at the reported depth"
            : "Even one modeled batch exceeds current aggregate remote RAM",
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
            tunedBatchIntervalMs,
            firstLandingDelayMs,
            batchLandingWindowMs: 3 * tunedStageGapMs,
            tuningMode: telemetry.samples > 0 ? "TELEMETRY_ASSISTED" : "CONSERVATIVE_DEFAULT",
        },
        ram: {
            availableRam,
            singleBatchRam: stageTemplate.reduce((sum, stage) => sum + stage.ram, 0),
            safeDepth,
            simulations,
        },
        stageTemplate,
        calendarPreview,
        notes: [
            "Dry-run only: no workers are launched.",
            "Stage gap controls H→W1→G→W2 spacing inside each batch.",
            "Batch interval controls spacing between H landings of successive batches.",
            "The RAM model is time-aware but aggregate; host-by-host reservation is a later scheduler milestone.",
            "One retained completed batch is not enough for aggressive tuning; recommendations remain conservative until history exists.",
        ],
    };
}

function timingTelemetry(last, target) {
    if (!last || String(last.target ?? "") !== target || last.status !== "COMPLETE") {
        return { samples: 0, orderCorrect: null, minimumSpacingMs: null, maxAbsLandingErrorMs: null, maxAllocationSpreadMs: null };
    }
    const stages = Array.isArray(last.landing?.stages) ? last.landing.stages : [];
    const spreads = stages.map((stage) => Number(stage.allocationSpreadMs ?? 0)).filter(Number.isFinite);
    return {
        samples: 1,
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

function makeBatches(stageTemplate, depth, firstLandingAt, batchIntervalMs) {
    const batches = [];
    for (let index = 0; index < depth; index += 1) {
        const batchFirstLandingAt = firstLandingAt + index * batchIntervalMs;
        const stages = stageTemplate.map((stage) => {
            const landingAt = batchFirstLandingAt + stage.offsetMs;
            return {
                ...stage,
                landingAt,
                startAt: landingAt - stage.durationMs,
            };
        });
        batches.push({ index: index + 1, firstLandingAt: batchFirstLandingAt, stages });
    }
    return batches;
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
    ns.tprint(`[PIPELINE] Batch interval ${state.timing.tunedBatchIntervalMs}ms | mode ${state.timing.tuningMode}`);
    ns.tprint(`[PIPELINE] Threads ${state.threads.hack}H / ${state.threads.weakenHack}W / ${state.threads.grow}G / ${state.threads.weakenGrow}W`);
    ns.tprint(`[PIPELINE] RAM available ${state.ram.availableRam.toFixed(2)} GB | one batch ${state.ram.singleBatchRam.toFixed(2)} GB | simulated safe depth ${state.ram.safeDepth}`);
    for (const row of state.ram.simulations) {
        ns.tprint(`[PIPELINE] depth ${row.depth}: peak ${row.peakRam.toFixed(2)} GB ${row.fits ? "FIT" : "BLOCKED"}`);
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
