import { WORKER_SCRIPTS, getExecutionPool } from "/lib/execution.js";
import { RuntimePort, publishBatchState, readPlannerState } from "/lib/runtime-state.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const DEFAULT_HACK_FRACTION = 0.10;
const DEFAULT_GAP_MS = 200;
const DEFAULT_MONEY_TARGET_PERCENT = 1;
const SECURITY_TOLERANCE = 0.05;
const MONEY_TOLERANCE = 0.995;
const START_LEAD_MS = 150;
const EXPECTED_STAGE_ORDER = Object.freeze(["HACK", "WEAKEN_HACK", "GROW", "WEAKEN_GROW"]);

/**
 * Execute one synchronized HWGW batch on a prepared target.
 *
 * This is the first batching milestone: one safe batch at a time, not a pipelined
 * stream of overlapping batches yet. It is intended to run on a remote host.
 *
 * Usage:
 *   run hacking/batch-runner.js <target> [hackFraction] [gapMs] [moneyTargetPercent]
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    const args = positionalArgs(ns);
    const target = String(args[0] ?? "");
    const hackFraction = clamp(Number(args[1] ?? DEFAULT_HACK_FRACTION), 0.001, 0.90);
    const gapMs = Math.max(50, Math.floor(Number(args[2] ?? DEFAULT_GAP_MS)));
    const moneyTargetPercent = clamp(Number(args[3] ?? DEFAULT_MONEY_TARGET_PERCENT), 0.01, 1);
    const quiet = isQuiet(ns);

    if (!target) {
        if (!quiet) ns.tprint("Usage: run hacking/batch-runner.js <target> [hackFraction] [gapMs] [moneyTargetPercent]");
        return;
    }

    const planner = readPlannerState(ns);
    const batchId = `batch-${target}-${Date.now()}`;
    const plan = buildBatchPlan(ns, target, planner, batchId, hackFraction, gapMs, moneyTargetPercent);
    publishBatchState(ns, plan.state);

    if (!plan.ok) {
        if (!quiet) ns.tprint(`[BATCH] ${plan.state.status}: ${plan.state.reason}`);
        return;
    }

    // Single-batch mode guarantees there is only one active batch coordinator.
    // Clear stale timing events left by an interrupted prior run before launch.
    ns.getPortHandle(RuntimePort.BATCH_TIMING_EVENTS).clear();

    const launched = [];
    const timingEvents = [];
    const launchStartedAt = Date.now();

    for (const stage of plan.stages) {
        const additionalMsec = Math.max(0, Math.floor(stage.landingAt - Date.now() - stage.baseTimeMs));
        for (const allocation of stage.allocations) {
            const jobId = `${batchId}-${stage.name}-${allocation.hostname}`;
            const pid = ns.exec(
                stage.script,
                allocation.hostname,
                allocation.threads,
                target,
                jobId,
                allocation.threads,
                additionalMsec,
                batchId,
                stage.name,
                stage.landingAt,
            );

            if (pid <= 0) {
                for (const job of launched) ns.kill(job.pid, job.hostname);
                const failed = {
                    ...plan.state,
                    status: "LAUNCH_FAILED",
                    reason: `Could not launch ${stage.name} on ${allocation.hostname}; cancelled partial batch`,
                    updatedAt: Date.now(),
                };
                publishBatchState(ns, failed);
                if (!quiet) ns.tprint(`[BATCH] ${failed.reason}`);
                return;
            }

            launched.push({
                pid,
                hostname: allocation.hostname,
                threads: allocation.threads,
                stage: stage.name,
                jobId,
            });
        }
    }

    publishBatchState(ns, {
        ...plan.state,
        status: "RUNNING",
        launchedJobs: launched.length,
        launchStartedAt,
        updatedAt: Date.now(),
    });

    while (launched.some((job) => ns.isRunning(job.pid, job.hostname))) {
        drainTimingEvents(ns, batchId, timingEvents);
        await ns.sleep(25);
    }
    drainTimingEvents(ns, batchId, timingEvents);

    const finishedAt = Date.now();
    const money = ns.getServerMoneyAvailable(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const security = ns.getServerSecurityLevel(target);
    const minSecurity = ns.getServerMinSecurityLevel(target);
    const moneyPercent = maxMoney > 0 ? money / maxMoney : 0;
    const securityDelta = Math.max(0, security - minSecurity);
    const predicted = plan.state.predicted ?? {};
    const predictedMoneyPercent = Number(predicted.finalMoneyPercent ?? 0);
    const predictedSecurityDelta = Number(predicted.finalSecurityDelta ?? 0);
    const landing = summarizeLanding(plan.state.stages ?? [], timingEvents);

    const complete = {
        ...plan.state,
        version: 3,
        model: "SINGLE_HWGW_ADDITIONAL_MSEC_V3",
        status: "COMPLETE",
        launchedJobs: launched.length,
        launchStartedAt,
        finishedAt,
        durationMs: finishedAt - launchStartedAt,
        final: {
            money,
            maxMoney,
            moneyPercent,
            security,
            minSecurity,
            securityDelta,
        },
        comparison: {
            moneyPercentError: moneyPercent - predictedMoneyPercent,
            securityDeltaError: securityDelta - predictedSecurityDelta,
        },
        landing,
        updatedAt: finishedAt,
    };
    publishBatchState(ns, complete);

    if (!quiet) {
        ns.tprint(`[BATCH] COMPLETE ${target} | ${(complete.actualHackFraction * 100).toFixed(1)}% hack | gap ${gapMs}ms | ${launched.length} job(s)`);
        ns.tprint(`[BATCH] Predicted money ${(predictedMoneyPercent * 100).toFixed(2)}% | security +${predictedSecurityDelta.toFixed(3)}`);
        ns.tprint(`[BATCH] Actual    money ${(moneyPercent * 100).toFixed(2)}% | security +${securityDelta.toFixed(3)}`);
        ns.tprint(`[BATCH] Error     money ${(complete.comparison.moneyPercentError * 100).toFixed(3)}pp | security ${signed(complete.comparison.securityDeltaError, 3)}`);
        ns.tprint(`[BATCH] Landing   ${landing.orderCorrect ? "ORDER OK" : "ORDER ERROR"} | min spacing ${fmtMs(landing.minimumSpacingMs)} | max drift ${fmtMs(landing.maxAbsLandingErrorMs)}`);
    }
}

function buildBatchPlan(ns, target, planner, batchId, requestedHackFraction, gapMs, moneyTargetPercent) {
    const money = ns.getServerMoneyAvailable(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const desiredMoney = maxMoney * moneyTargetPercent;
    const security = ns.getServerSecurityLevel(target);
    const minSecurity = ns.getServerMinSecurityLevel(target);
    const securityDelta = Math.max(0, security - minSecurity);

    const baseState = {
        version: 3,
        model: "SINGLE_HWGW_ADDITIONAL_MSEC_V3",
        batchId,
        target,
        plannerUpdatedAt: Number(planner?.updatedAt ?? 0),
        requestedHackFraction,
        moneyTargetPercent,
        gapMs,
        runnerHost: ns.getHostname(),
        status: "PLANNING",
        reason: "",
        initial: {
            money,
            maxMoney,
            moneyPercent: maxMoney > 0 ? money / maxMoney : 0,
            desiredMoney,
            security,
            minSecurity,
            securityDelta,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };

    if (!(maxMoney > 0)) return fail(baseState, "Target has no money");
    if (securityDelta > SECURITY_TOLERANCE) return fail(baseState, `Target security is +${securityDelta.toFixed(3)}; batch requires prepared security`);
    if (money < desiredMoney * MONEY_TOLERANCE) return fail(baseState, `Target money is ${(money / maxMoney * 100).toFixed(1)}%; batch requires prepared money`);

    const hackPerThread = Math.max(0, ns.hackAnalyze(target));
    if (!(hackPerThread > 0)) return fail(baseState, "hackAnalyze returned zero");

    const hackThreads = Math.max(1, Math.floor(requestedHackFraction / hackPerThread));
    const actualHackFraction = Math.min(0.90, hackThreads * hackPerThread);
    const recoveryMultiplier = 1 / Math.max(0.01, 1 - actualHackFraction);
    const growThreads = finiteCeil(ns.growthAnalyze(target, recoveryMultiplier, 1));
    const weakenPerThread = Math.max(0, ns.weakenAnalyze(1, 1));
    if (!(weakenPerThread > 0)) return fail(baseState, "weakenAnalyze returned zero");

    const hackSecurity = Math.max(0, ns.hackAnalyzeSecurity(hackThreads, target));
    const growSecurity = Math.max(0, ns.growthAnalyzeSecurity(growThreads));
    const weakenHackThreads = Math.max(1, Math.ceil(hackSecurity / weakenPerThread));
    const weakenGrowThreads = Math.max(1, Math.ceil(growSecurity / weakenPerThread));
    const weakenHackEffect = weakenHackThreads * weakenPerThread;
    const weakenGrowEffect = weakenGrowThreads * weakenPerThread;

    const predictedAfterHackMoney = Math.max(0, money * (1 - actualHackFraction));
    const predictedFinalMoney = Math.min(maxMoney, predictedAfterHackMoney * recoveryMultiplier);
    const predictedAfterHackSecurityDelta = securityDelta + hackSecurity;
    const predictedAfterW1SecurityDelta = Math.max(0, predictedAfterHackSecurityDelta - weakenHackEffect);
    const predictedAfterGrowSecurityDelta = predictedAfterW1SecurityDelta + growSecurity;
    const predictedFinalSecurityDelta = Math.max(0, predictedAfterGrowSecurityDelta - weakenGrowEffect);

    const predicted = {
        afterHackMoney: predictedAfterHackMoney,
        finalMoney: predictedFinalMoney,
        finalMoneyPercent: maxMoney > 0 ? predictedFinalMoney / maxMoney : 0,
        hackSecurityIncrease: hackSecurity,
        growSecurityIncrease: growSecurity,
        weakenHackEffect,
        weakenGrowEffect,
        afterHackSecurityDelta: predictedAfterHackSecurityDelta,
        afterWeakenHackSecurityDelta: predictedAfterW1SecurityDelta,
        afterGrowSecurityDelta: predictedAfterGrowSecurityDelta,
        finalSecurityDelta: predictedFinalSecurityDelta,
    };

    const times = {
        hack: ns.getHackTime(target),
        grow: ns.getGrowTime(target),
        weaken: ns.getWeakenTime(target),
    };

    const baseLandingDelay = Math.max(
        times.hack,
        times.weaken - gapMs,
        times.grow - 2 * gapMs,
        times.weaken - 3 * gapMs,
    ) + START_LEAD_MS;
    const firstLandingAt = Date.now() + baseLandingDelay;

    const stageSpecs = [
        { name: "HACK", script: WORKER_SCRIPTS.HACK, threads: hackThreads, baseTimeMs: times.hack, landingAt: firstLandingAt },
        { name: "WEAKEN_HACK", script: WORKER_SCRIPTS.WEAKEN, threads: weakenHackThreads, baseTimeMs: times.weaken, landingAt: firstLandingAt + gapMs },
        { name: "GROW", script: WORKER_SCRIPTS.GROW, threads: growThreads, baseTimeMs: times.grow, landingAt: firstLandingAt + 2 * gapMs },
        { name: "WEAKEN_GROW", script: WORKER_SCRIPTS.WEAKEN, threads: weakenGrowThreads, baseTimeMs: times.weaken, landingAt: firstLandingAt + 3 * gapMs },
    ];

    const allocationResult = allocateBatch(ns, planner, stageSpecs);
    if (!allocationResult.ok) return fail(baseState, allocationResult.reason, {
        actualHackFraction,
        threads: { hack: hackThreads, weakenHack: weakenHackThreads, grow: growThreads, weakenGrow: weakenGrowThreads },
        predicted,
    });

    const totalRam = allocationResult.stages.reduce((sum, stage) => sum + stage.ram, 0);
    return {
        ok: true,
        state: {
            ...baseState,
            status: "READY",
            reason: "Prepared target and full HWGW allocation fit the remote pool",
            actualHackFraction,
            recoveryMultiplier,
            threads: { hack: hackThreads, weakenHack: weakenHackThreads, grow: growThreads, weakenGrow: weakenGrowThreads },
            securityEffects: { hack: hackSecurity, grow: growSecurity, weakenHack: weakenHackEffect, weakenGrow: weakenGrowEffect },
            predicted,
            timing: {
                ...times,
                firstLandingAt,
                lastLandingAt: firstLandingAt + 3 * gapMs,
                landingWindowMs: 3 * gapMs,
            },
            totalRam,
            stages: allocationResult.stages.map((stage) => ({
                name: stage.name,
                threads: stage.threads,
                ram: stage.ram,
                landingAt: stage.landingAt,
                allocations: stage.allocations.map((a) => ({ hostname: a.hostname, threads: a.threads })),
            })),
            updatedAt: Date.now(),
        },
        stages: allocationResult.stages,
    };
}

function allocateBatch(ns, planner, specs) {
    const hosts = getExecutionPool(ns, planner).map((host) => ({ ...host, remainingRam: host.usableRam }));
    if (hosts.length === 0) return { ok: false, reason: "No remote execution hosts", stages: [] };

    const work = specs.map((spec) => {
        const scriptRam = ns.getScriptRam(spec.script, "home");
        return { ...spec, scriptRam, ram: spec.threads * scriptRam, allocations: [] };
    });
    if (work.some((stage) => !(stage.scriptRam > 0))) return { ok: false, reason: "Could not determine worker RAM", stages: [] };

    const allocationOrder = [...work].sort((a, b) => b.ram - a.ram);
    for (const stage of allocationOrder) {
        let remainingThreads = stage.threads;
        hosts.sort((a, b) => b.remainingRam - a.remainingRam || a.hostname.localeCompare(b.hostname));
        for (const host of hosts) {
            if (remainingThreads <= 0) break;
            const capacity = Math.floor(host.remainingRam / stage.scriptRam);
            const threads = Math.min(remainingThreads, capacity);
            if (threads < 1) continue;
            stage.allocations.push({ hostname: host.hostname, threads });
            host.remainingRam -= threads * stage.scriptRam;
            remainingThreads -= threads;
        }
        if (remainingThreads > 0) {
            return { ok: false, reason: `${stage.name} is short ${remainingThreads} thread(s) after full-batch RAM reservation`, stages: [] };
        }
    }

    return { ok: true, stages: specs.map((spec) => work.find((stage) => stage.name === spec.name)), reason: "" };
}

function drainTimingEvents(ns, batchId, sink) {
    const port = ns.getPortHandle(RuntimePort.BATCH_TIMING_EVENTS);
    while (!port.empty()) {
        const raw = port.read();
        try {
            const event = JSON.parse(String(raw));
            if (event?.type === "BATCH_STAGE_COMPLETE" && String(event.batchId ?? "") === batchId) {
                sink.push(event);
            }
        } catch {
            // Ignore malformed timing events; missing-job telemetry will expose it.
        }
    }
}

function summarizeLanding(stages, events) {
    const stageResults = stages.map((stage) => {
        const matching = events
            .filter((event) => String(event.stage ?? "") === stage.name)
            .sort((a, b) => Number(a.finishedAt ?? 0) - Number(b.finishedAt ?? 0));
        const expectedJobs = Array.isArray(stage.allocations) ? stage.allocations.length : 0;
        const firstCompletionAt = matching.length ? Number(matching[0].finishedAt ?? 0) : 0;
        const actualLandingAt = matching.length ? Number(matching[matching.length - 1].finishedAt ?? 0) : 0;
        const plannedLandingAt = Number(stage.landingAt ?? 0);
        return {
            name: stage.name,
            plannedLandingAt,
            expectedJobs,
            reportedJobs: matching.length,
            missingJobs: Math.max(0, expectedJobs - matching.length),
            firstCompletionAt,
            actualLandingAt,
            allocationSpreadMs: matching.length > 1 ? actualLandingAt - firstCompletionAt : 0,
            landingErrorMs: actualLandingAt > 0 ? actualLandingAt - plannedLandingAt : null,
            complete: matching.length === expectedJobs && expectedJobs > 0,
        };
    });

    const completeStages = stageResults.filter((stage) => stage.actualLandingAt > 0);
    const actualOrder = [...completeStages]
        .sort((a, b) => a.actualLandingAt - b.actualLandingAt)
        .map((stage) => stage.name);
    const allReported = stageResults.every((stage) => stage.complete);
    const orderCorrect = allReported
        && EXPECTED_STAGE_ORDER.every((name, index) => actualOrder[index] === name);

    const adjacentSpacing = [];
    for (let i = 1; i < stageResults.length; i += 1) {
        const previous = stageResults[i - 1];
        const current = stageResults[i];
        adjacentSpacing.push({
            from: previous.name,
            to: current.name,
            spacingMs: previous.actualLandingAt > 0 && current.actualLandingAt > 0
                ? current.actualLandingAt - previous.actualLandingAt
                : null,
        });
    }

    const validSpacing = adjacentSpacing
        .map((entry) => entry.spacingMs)
        .filter((value) => Number.isFinite(value));
    const validErrors = stageResults
        .map((stage) => stage.landingErrorMs)
        .filter((value) => Number.isFinite(value));

    return {
        expectedOrder: [...EXPECTED_STAGE_ORDER],
        actualOrder,
        orderCorrect,
        expectedJobs: stageResults.reduce((sum, stage) => sum + stage.expectedJobs, 0),
        reportedJobs: events.length,
        missingJobs: stageResults.reduce((sum, stage) => sum + stage.missingJobs, 0),
        minimumSpacingMs: validSpacing.length ? Math.min(...validSpacing) : null,
        maxAbsLandingErrorMs: validErrors.length ? Math.max(...validErrors.map((value) => Math.abs(value))) : null,
        adjacentSpacing,
        stages: stageResults,
    };
}

function fail(baseState, reason, extra = {}) {
    return {
        ok: false,
        stages: [],
        state: { ...baseState, ...extra, status: "BLOCKED", reason, updatedAt: Date.now() },
    };
}

function finiteCeil(value) {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.ceil(value);
}

function signed(value, digits = 3) {
    const n = Number(value ?? 0);
    return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function fmtMs(value) {
    return Number.isFinite(value) ? `${Number(value).toFixed(0)}ms` : "n/a";
}

function clamp(value, minimum, maximum) {
    if (!Number.isFinite(value)) return minimum;
    return Math.min(maximum, Math.max(minimum, value));
}
