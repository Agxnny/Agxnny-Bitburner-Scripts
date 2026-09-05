import { WORKER_SCRIPTS, getExecutionPool } from "/lib/execution.js";
import {
    RuntimePort,
    publishBatchSchedulerState,
    publishLastCompletedBatchState,
    readBatchState,
    readControllerState,
    readLastCompletedBatchState,
    readPlannerState,
} from "/lib/runtime-state.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const DEFAULT_HACK_FRACTION = 0.10;
const DEFAULT_STAGE_GAP_MS = 200;
const MIN_STAGE_GAP_MS = 75;
const MAX_DEPTH = 2;
const DEFAULT_BATCH_COUNT = 2;
const START_LEAD_MS = 250;
const DISPATCH_LEAD_MS = 100;
const LOOP_MS = 20;
const COMPLETE_GRACE_MS = 2_000;
const MONEY_TOLERANCE = 0.995;
const SECURITY_TOLERANCE = 0.05;
const MIN_TIMING_MARGIN_MS = 25;
const MAX_STEADY_BATCHES = 256;
const MAX_EVENTS = 14;
const EXPECTED_STAGE_ORDER = Object.freeze(["HACK", "WEAKEN_HACK", "GROW", "WEAKEN_GROW"]);

/**
 * Opt-in first executable pipeline test.
 *
 * This runner is intentionally NOT controller-integrated. The controller must be
 * parked in manual PREP/HOLD on the same target before this script will start.
 * It executes at most two real batches at once, owns Port 14 while running, and
 * stops admitting new waves on any launch/timing/recovery failure.
 *
 * Usage:
 *   run hacking/pipeline-runner.js <target> [hackFraction] [stageGapMs] [batchCount]
 *
 * Recommended first test:
 *   run hacking/pipeline-runner.js phantasy 0.10 200 2
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    const args = positionalArgs(ns);
    const target = String(args[0] ?? "");
    const hackFraction = clamp(Number(args[1] ?? DEFAULT_HACK_FRACTION), 0.001, 0.90);
    const requestedGapMs = Math.max(MIN_STAGE_GAP_MS, Math.floor(Number(args[2] ?? DEFAULT_STAGE_GAP_MS)));
    const requestedBatches = clampInt(Number(args[3] ?? DEFAULT_BATCH_COUNT), 1, 20);
    const quiet = isQuiet(ns);

    if (!target) {
        if (!quiet) ns.tprint("Usage: run hacking/pipeline-runner.js <target> [hackFraction] [stageGapMs] [batchCount]");
        return;
    }

    const preflight = preflightCheck(ns, target);
    if (!preflight.ok) {
        if (!quiet) {
            ns.tprint(`[PIPELINE-REAL] BLOCKED: ${preflight.reason}`);
            ns.tprint("[PIPELINE-REAL] Park the controller with Prep target to 100%, wait for PREPARED HOLD, then retry.");
        }
        publishRunnerState(ns, {
            target,
            status: "BLOCKED",
            reason: preflight.reason,
            requestedBatches,
            completedBatches: 0,
            inFlight: [],
            events: [],
        });
        return;
    }

    // This runner is the only real batch coordinator allowed by preflight.
    // Clear the old serialized queue once, then own/reroute every new event by batchId.
    ns.getPortHandle(RuntimePort.BATCH_TIMING_EVENTS).clear();

    const events = [];
    const completedRecent = [];
    let completedBatches = 0;
    let wave = 0;
    let safetyStopped = false;
    let safetyReason = "";

    pushEvent(events, "START", `Real pipeline test started on ${target}; depth cap ${MAX_DEPTH}, requested ${requestedBatches} batch(es)`);
    if (!quiet) ns.tprint(`[PIPELINE-REAL] START ${target} | hard depth ${MAX_DEPTH} | ${requestedBatches} batch(es)`);

    while (completedBatches < requestedBatches && !safetyStopped) {
        const waveSize = Math.min(MAX_DEPTH, requestedBatches - completedBatches);
        const wavePlan = buildWavePlan(ns, target, hackFraction, requestedGapMs, waveSize, ++wave);
        if (!wavePlan.ok) {
            safetyStopped = true;
            safetyReason = wavePlan.reason;
            pushEvent(events, "STOP", safetyReason);
            break;
        }

        if (!targetPrepared(ns, target)) {
            safetyStopped = true;
            safetyReason = "Target left prepared baseline before wave admission";
            pushEvent(events, "STOP", safetyReason);
            break;
        }

        const live = wavePlan.batches;
        pushEvent(events, "ADMIT", `Wave ${wave}: admitted ${live.length} real batch(es) at ${wavePlan.batchIntervalMs} ms cadence`);
        if (!quiet) ns.tprint(`[PIPELINE-REAL] ADMIT wave ${wave} | ${live.length} batch(es) | interval ${wavePlan.batchIntervalMs}ms`);

        while (live.some((batch) => !batch.done)) {
            const now = Date.now();
            drainTimingEvents(ns, live);

            for (const batch of live) {
                if (batch.done || batch.cancelled) continue;
                for (const stage of batch.stages) {
                    if (stage.launched || now < stage.startAt - DISPATCH_LEAD_MS) continue;
                    const launched = launchStage(ns, target, batch, stage);
                    if (!launched.ok) {
                        cancelBatch(ns, batch);
                        batch.cancelled = true;
                        batch.done = true;
                        safetyStopped = true;
                        safetyReason = `${batch.id} launch failed at ${stage.name}: ${launched.reason}`;
                        pushEvent(events, "STOP", safetyReason);
                        break;
                    }
                    pushEvent(events, "LAUNCH", `${batch.id} ${stage.name} · ${stage.jobs.length} allocation(s)`);
                }
            }

            for (const batch of live) {
                if (batch.done || batch.cancelled) continue;
                const allStagesLaunched = batch.stages.every((stage) => stage.launched);
                const anyRunning = batch.stages.some((stage) => stage.jobs.some((job) => ns.isRunning(job.pid, job.hostname)));
                if (allStagesLaunched && !anyRunning && now >= batch.finalLandingAt - COMPLETE_GRACE_MS) {
                    const complete = finalizeBatch(ns, target, batch, wavePlan);
                    batch.done = true;
                    batch.complete = complete;
                    completedBatches += 1;
                    completedRecent.push(complete);
                    while (completedRecent.length > 4) completedRecent.shift();
                    publishLastCompletedBatchState(ns, complete);

                    const safety = validateComplete(complete);
                    pushEvent(events, safety.ok ? "COMPLETE" : "STOP", safety.ok
                        ? `${batch.id} healthy · spacing ${fmtMs(complete.landing.minimumSpacingMs)} · drift ${fmtMs(complete.landing.maxAbsLandingErrorMs)}`
                        : `${batch.id}: ${safety.reason}`);
                    if (!quiet) ns.tprint(`[PIPELINE-REAL] ${safety.ok ? "COMPLETE" : "SAFETY STOP"} ${batch.id} | money ${(complete.final.moneyPercent * 100).toFixed(2)}% | sec +${complete.final.securityDelta.toFixed(3)} | ${complete.landing.orderCorrect ? "ORDER OK" : "ORDER BAD"}`);
                    if (!safety.ok) {
                        safetyStopped = true;
                        safetyReason = `${batch.id}: ${safety.reason}`;
                    }
                }
            }

            publishRunnerState(ns, {
                target,
                status: safetyStopped ? "DRAINING_AFTER_STOP" : "RUNNING",
                reason: safetyStopped ? safetyReason : `Wave ${wave} active`,
                requestedBatches,
                completedBatches,
                stageGapMs: wavePlan.stageGapMs,
                batchIntervalMs: wavePlan.batchIntervalMs,
                inFlight: live.filter((batch) => !batch.done).map(publicBatch),
                completedRecent,
                events,
                safetyStopped,
                safetyReason,
            });

            await ns.sleep(LOOP_MS);
        }

        if (safetyStopped) break;
        if (!targetPrepared(ns, target)) {
            safetyStopped = true;
            safetyReason = "Wave completed but target is outside prepared tolerance; stopping before next admission";
            pushEvent(events, "STOP", safetyReason);
            break;
        }
    }

    const status = safetyStopped ? "SAFETY_STOP" : "COMPLETE";
    publishRunnerState(ns, {
        target,
        status,
        reason: safetyStopped ? safetyReason : `Completed requested ${completedBatches} pipeline batch(es)`,
        requestedBatches,
        completedBatches,
        inFlight: [],
        completedRecent,
        events,
        safetyStopped,
        safetyReason,
    });

    if (!quiet) {
        ns.tprint(`[PIPELINE-REAL] ${status} | completed ${completedBatches}/${requestedBatches}`);
        if (safetyStopped) ns.tprint(`[PIPELINE-REAL] ${safetyReason}`);
    }
}

function preflightCheck(ns, target) {
    const controller = readControllerState(ns);
    const batch = readBatchState(ns);
    if (!controller) return { ok: false, reason: "Controller state unavailable" };
    if (String(controller.hostname ?? "") !== target) return { ok: false, reason: `Controller target is ${String(controller.hostname ?? "none")}, not ${target}` };
    if (!controller.prep?.hold) return { ok: false, reason: "Controller is not in PREPARED HOLD" };
    if (Number(controller.execution?.activeJobs ?? 0) > 0) return { ok: false, reason: "Controller still has active standalone workers" };
    if (controller.executionMode?.batchRunning) return { ok: false, reason: "Serialized batch runner is active" };
    if (batch && ["PLANNING", "READY", "RUNNING"].includes(String(batch.status ?? ""))) return { ok: false, reason: `Port 12 still reports active batch state ${batch.status}` };
    if (!targetPrepared(ns, target)) return { ok: false, reason: "Target is not at prepared money/security baseline" };
    return { ok: true, reason: "" };
}

function buildWavePlan(ns, target, hackFraction, requestedGapMs, depth, wave) {
    const planner = readPlannerState(ns);
    const last = readLastCompletedBatchState(ns);
    const template = buildTemplate(ns, target, hackFraction, requestedGapMs, last);
    if (!template.ok) return template;

    const pool = getExecutionPool(ns, planner);
    if (!pool.length) return { ok: false, reason: "No remote execution RAM available" };

    const minimumIntervalMs = template.stageGapMs * 4;
    const steady = findSteadyInterval(pool, template.stages, minimumIntervalMs, template.stageGapMs);
    if (!steady.ok) return { ok: false, reason: `Could not find sustainable interval: ${steady.reason || "RAM reservation blocked"}` };

    const firstLandingAt = Date.now() + template.firstLandingDelayMs;
    const batches = makeBatches(template.stages, depth, firstLandingAt, steady.intervalMs, target, wave);
    const reservation = reserveHostWindows(pool, batches);
    if (!reservation.ok) {
        return { ok: false, reason: `Depth-${depth} wave reservation blocked at batch ${reservation.blockedBatch} ${reservation.blockedStage}; short ${reservation.missingThreads} thread(s)` };
    }

    attachAllocations(batches, reservation.allocations);
    return {
        ok: true,
        stageGapMs: template.stageGapMs,
        batchIntervalMs: steady.intervalMs,
        actualHackFraction: template.actualHackFraction,
        predicted: template.predicted,
        batches,
    };
}

function buildTemplate(ns, target, requestedHackFraction, requestedGapMs, last) {
    const maxMoney = ns.getServerMaxMoney(target);
    if (!(maxMoney > 0)) return { ok: false, reason: "Target has no money" };
    const hackPerThread = Math.max(0, ns.hackAnalyze(target));
    const weakenPerThread = Math.max(0, ns.weakenAnalyze(1, 1));
    if (!(hackPerThread > 0 && weakenPerThread > 0)) return { ok: false, reason: "Hack/weaken analysis returned zero" };

    const hackThreads = Math.max(1, Math.floor(requestedHackFraction / hackPerThread));
    const actualHackFraction = Math.min(0.90, hackThreads * hackPerThread);
    const recoveryMultiplier = 1 / Math.max(0.01, 1 - actualHackFraction);
    const growThreads = finiteCeil(ns.growthAnalyze(target, recoveryMultiplier, 1));
    const hackSecurity = Math.max(0, ns.hackAnalyzeSecurity(hackThreads, target));
    const growSecurity = Math.max(0, ns.growthAnalyzeSecurity(growThreads));
    const weakenHackThreads = Math.max(1, Math.ceil(hackSecurity / weakenPerThread));
    const weakenGrowThreads = Math.max(1, Math.ceil(growSecurity / weakenPerThread));

    const telemetry = matchingTelemetry(last, target);
    const observedRisk = telemetry
        ? Math.max(0, Number(telemetry.maxAbsLandingErrorMs ?? 0)) + Math.max(0, Number(telemetry.maxAllocationSpreadMs ?? 0)) + MIN_TIMING_MARGIN_MS
        : 0;
    const stageGapMs = Math.max(requestedGapMs, Math.ceil(observedRisk));

    const times = {
        hack: ns.getHackTime(target),
        grow: ns.getGrowTime(target),
        weaken: ns.getWeakenTime(target),
    };
    const firstLandingDelayMs = Math.max(
        times.hack,
        times.weaken - stageGapMs,
        times.grow - 2 * stageGapMs,
        times.weaken - 3 * stageGapMs,
    ) + START_LEAD_MS;

    const scriptRam = {
        HACK: ns.getScriptRam(WORKER_SCRIPTS.HACK, "home"),
        GROW: ns.getScriptRam(WORKER_SCRIPTS.GROW, "home"),
        WEAKEN: ns.getScriptRam(WORKER_SCRIPTS.WEAKEN, "home"),
    };
    if (!(scriptRam.HACK > 0 && scriptRam.GROW > 0 && scriptRam.WEAKEN > 0)) return { ok: false, reason: "Could not determine worker RAM" };

    const stages = [
        { name: "HACK", script: WORKER_SCRIPTS.HACK, threads: hackThreads, durationMs: times.hack, scriptRam: scriptRam.HACK, ram: hackThreads * scriptRam.HACK, offsetMs: 0 },
        { name: "WEAKEN_HACK", script: WORKER_SCRIPTS.WEAKEN, threads: weakenHackThreads, durationMs: times.weaken, scriptRam: scriptRam.WEAKEN, ram: weakenHackThreads * scriptRam.WEAKEN, offsetMs: stageGapMs },
        { name: "GROW", script: WORKER_SCRIPTS.GROW, threads: growThreads, durationMs: times.grow, scriptRam: scriptRam.GROW, ram: growThreads * scriptRam.GROW, offsetMs: 2 * stageGapMs },
        { name: "WEAKEN_GROW", script: WORKER_SCRIPTS.WEAKEN, threads: weakenGrowThreads, durationMs: times.weaken, scriptRam: scriptRam.WEAKEN, ram: weakenGrowThreads * scriptRam.WEAKEN, offsetMs: 3 * stageGapMs },
    ];

    return {
        ok: true,
        stageGapMs,
        firstLandingDelayMs,
        actualHackFraction,
        predicted: { finalMoneyPercent: 1, finalSecurityDelta: 0 },
        stages,
    };
}

function makeBatches(template, depth, firstLandingAt, intervalMs, target, wave) {
    const batches = [];
    for (let index = 0; index < depth; index += 1) {
        const batchFirstLandingAt = firstLandingAt + index * intervalMs;
        const id = `pipe-${target}-${Date.now()}-${wave}-${index + 1}`;
        const stages = template.map((stage) => ({
            ...stage,
            batch: index + 1,
            landingAt: batchFirstLandingAt + stage.offsetMs,
            startAt: batchFirstLandingAt + stage.offsetMs - stage.durationMs,
            allocations: [],
            jobs: [],
            launched: false,
        }));
        batches.push({
            id,
            index: index + 1,
            firstLandingAt: batchFirstLandingAt,
            finalLandingAt: batchFirstLandingAt + 3 * (template[1].offsetMs - template[0].offsetMs),
            stages,
            timingEvents: [],
            done: false,
            cancelled: false,
            createdAt: Date.now(),
        });
    }
    return batches;
}

function reserveHostWindows(pool, batches) {
    const hosts = pool.map((host) => ({ hostname: host.hostname, usableRam: Math.max(0, Number(host.usableRam ?? 0)), reservations: [] }));
    const allocations = {};
    const stages = batches.flatMap((batch) => batch.stages).sort((a, b) => a.startAt - b.startAt || b.ram - a.ram || a.landingAt - b.landingAt);

    for (const stage of stages) {
        let remainingThreads = stage.threads;
        const key = `${stage.batch}:${stage.name}`;
        allocations[key] = [];
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
            candidate.host.reservations.push({ startAt: stage.startAt, endAt: stage.landingAt, ram, batch: stage.batch, stage: stage.name, threads });
            allocations[key].push({ hostname: candidate.host.hostname, threads, ram });
            remainingThreads -= threads;
        }
        if (remainingThreads > 0) return { ok: false, blockedBatch: stage.batch, blockedStage: stage.name, missingThreads: remainingThreads, allocations };
    }
    return { ok: true, blockedBatch: 0, blockedStage: "", missingThreads: 0, allocations };
}

function attachAllocations(batches, allocations) {
    for (const batch of batches) {
        for (const stage of batch.stages) stage.allocations = allocations[`${batch.index}:${stage.name}`] ?? [];
    }
}

function findSteadyInterval(pool, stageTemplate, minimumIntervalMs, stageGapMs) {
    const maxDurationMs = Math.max(...stageTemplate.map((stage) => stage.durationMs));
    const landingWindowMs = 3 * stageGapMs;
    const test = (intervalMs) => {
        const depth = Math.min(MAX_STEADY_BATCHES, Math.max(3, Math.ceil((maxDurationMs + landingWindowMs) / intervalMs) + 3));
        const fake = makeBatches(stageTemplate, depth, Date.now() + maxDurationMs + 500, intervalMs, "steady", 0);
        const result = reserveHostWindows(pool, fake);
        return { ok: result.ok && depth < MAX_STEADY_BATCHES, intervalMs, depth };
    };

    const minimum = Math.max(1, Math.floor(minimumIntervalMs));
    const minResult = test(minimum);
    if (minResult.ok) return minResult;

    let low = minimum;
    let high = Math.ceil(maxDurationMs + landingWindowMs + stageGapMs);
    const highResult = test(high);
    if (!highResult.ok) return { ok: false, intervalMs: high, reason: "reservation still blocked at upper interval bound" };

    while (high - low > 25) {
        const mid = Math.floor((low + high) / 2);
        if (test(mid).ok) high = mid;
        else low = mid + 1;
    }
    for (let value = Math.max(minimum, low - 25); value <= high; value += 1) {
        const result = test(value);
        if (result.ok) return result;
    }
    return highResult;
}

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
    for (const event of events) {
        current += event.delta;
        peak = Math.max(peak, current);
    }
    return peak;
}

function launchStage(ns, target, batch, stage) {
    stage.launched = true;
    for (const allocation of stage.allocations) {
        const additionalMsec = Math.max(0, Math.floor(stage.landingAt - Date.now() - stage.durationMs));
        const jobId = `${batch.id}-${stage.name}-${allocation.hostname}`;
        const pid = ns.exec(
            stage.script,
            allocation.hostname,
            allocation.threads,
            target,
            jobId,
            allocation.threads,
            additionalMsec,
            batch.id,
            stage.name,
            stage.landingAt,
        );
        if (pid <= 0) {
            for (const job of stage.jobs) ns.kill(job.pid, job.hostname);
            stage.jobs = [];
            return { ok: false, reason: `ns.exec failed on ${allocation.hostname}` };
        }
        stage.jobs.push({ pid, hostname: allocation.hostname, threads: allocation.threads, jobId });
    }
    return { ok: true };
}

function cancelBatch(ns, batch) {
    for (const stage of batch.stages) {
        for (const job of stage.jobs) {
            if (ns.isRunning(job.pid, job.hostname)) ns.kill(job.pid, job.hostname);
        }
    }
}

function drainTimingEvents(ns, batches) {
    const byId = new Map(batches.map((batch) => [batch.id, batch]));
    const port = ns.getPortHandle(RuntimePort.BATCH_TIMING_EVENTS);
    while (!port.empty()) {
        const raw = port.read();
        try {
            const event = JSON.parse(String(raw));
            if (event?.type !== "BATCH_STAGE_COMPLETE") continue;
            const batch = byId.get(String(event.batchId ?? ""));
            if (batch) batch.timingEvents.push(event);
        } catch {
            // Malformed events become missing-event telemetry on completion.
        }
    }
}

function finalizeBatch(ns, target, batch, plan) {
    const money = ns.getServerMoneyAvailable(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const security = ns.getServerSecurityLevel(target);
    const minSecurity = ns.getServerMinSecurityLevel(target);
    const moneyPercent = maxMoney > 0 ? money / maxMoney : 0;
    const securityDelta = Math.max(0, security - minSecurity);
    const landing = summarizeLanding(batch.stages, batch.timingEvents);
    const finishedAt = Date.now();
    return {
        version: 4,
        model: "PIPELINE_HWGW_DEPTH2_V1",
        batchId: batch.id,
        target,
        status: "COMPLETE",
        pipeline: true,
        maxDepth: MAX_DEPTH,
        gapMs: plan.stageGapMs,
        batchIntervalMs: plan.batchIntervalMs,
        actualHackFraction: plan.actualHackFraction,
        threads: {
            hack: batch.stages.find((s) => s.name === "HACK")?.threads ?? 0,
            weakenHack: batch.stages.find((s) => s.name === "WEAKEN_HACK")?.threads ?? 0,
            grow: batch.stages.find((s) => s.name === "GROW")?.threads ?? 0,
            weakenGrow: batch.stages.find((s) => s.name === "WEAKEN_GROW")?.threads ?? 0,
        },
        predicted: plan.predicted,
        final: { money, maxMoney, moneyPercent, security, minSecurity, securityDelta },
        comparison: {
            moneyPercentError: moneyPercent - Number(plan.predicted.finalMoneyPercent ?? 1),
            securityDeltaError: securityDelta - Number(plan.predicted.finalSecurityDelta ?? 0),
        },
        timing: {
            firstLandingAt: batch.firstLandingAt,
            lastLandingAt: batch.finalLandingAt,
            landingWindowMs: 3 * plan.stageGapMs,
        },
        stages: batch.stages.map((stage) => ({
            name: stage.name,
            threads: stage.threads,
            ram: stage.ram,
            landingAt: stage.landingAt,
            allocations: stage.allocations.map((a) => ({ hostname: a.hostname, threads: a.threads })),
        })),
        landing,
        createdAt: batch.createdAt,
        launchStartedAt: Math.min(...batch.stages.flatMap((stage) => stage.jobs.map(() => stage.startAt))),
        finishedAt,
        durationMs: Math.max(0, finishedAt - batch.createdAt),
        updatedAt: finishedAt,
    };
}

function summarizeLanding(stages, events) {
    const stageResults = stages.map((stage) => {
        const matching = events.filter((event) => String(event.stage ?? "") === stage.name).sort((a, b) => Number(a.finishedAt ?? 0) - Number(b.finishedAt ?? 0));
        const expectedJobs = stage.allocations.length;
        const firstCompletionAt = matching.length ? Number(matching[0].finishedAt ?? 0) : 0;
        const actualLandingAt = matching.length ? Number(matching[matching.length - 1].finishedAt ?? 0) : 0;
        return {
            name: stage.name,
            plannedLandingAt: stage.landingAt,
            expectedJobs,
            reportedJobs: matching.length,
            missingJobs: Math.max(0, expectedJobs - matching.length),
            firstCompletionAt,
            actualLandingAt,
            allocationSpreadMs: matching.length > 1 ? actualLandingAt - firstCompletionAt : 0,
            landingErrorMs: actualLandingAt > 0 ? actualLandingAt - stage.landingAt : null,
            complete: expectedJobs > 0 && matching.length === expectedJobs,
        };
    });
    const actualOrder = stageResults.filter((s) => s.actualLandingAt > 0).sort((a, b) => a.actualLandingAt - b.actualLandingAt).map((s) => s.name);
    const orderCorrect = stageResults.every((s) => s.complete) && EXPECTED_STAGE_ORDER.every((name, i) => actualOrder[i] === name);
    const adjacentSpacing = [];
    for (let i = 1; i < stageResults.length; i += 1) {
        const previous = stageResults[i - 1];
        const current = stageResults[i];
        adjacentSpacing.push({ from: previous.name, to: current.name, spacingMs: previous.actualLandingAt && current.actualLandingAt ? current.actualLandingAt - previous.actualLandingAt : null });
    }
    const spacing = adjacentSpacing.map((x) => x.spacingMs).filter(Number.isFinite);
    const errors = stageResults.map((x) => x.landingErrorMs).filter(Number.isFinite);
    return {
        expectedOrder: [...EXPECTED_STAGE_ORDER],
        actualOrder,
        orderCorrect,
        expectedJobs: stageResults.reduce((sum, s) => sum + s.expectedJobs, 0),
        reportedJobs: events.length,
        missingJobs: stageResults.reduce((sum, s) => sum + s.missingJobs, 0),
        minimumSpacingMs: spacing.length ? Math.min(...spacing) : null,
        maxAbsLandingErrorMs: errors.length ? Math.max(...errors.map((v) => Math.abs(v))) : null,
        adjacentSpacing,
        stages: stageResults,
    };
}

function validateComplete(batch) {
    const failures = [];
    if (!batch.landing?.orderCorrect) failures.push("landing order incorrect");
    if (Number(batch.landing?.missingJobs ?? 0) > 0) failures.push(`${batch.landing.missingJobs} timing event(s) missing`);
    if (Number(batch.final?.moneyPercent ?? 0) < MONEY_TOLERANCE) failures.push(`money ${(Number(batch.final?.moneyPercent ?? 0) * 100).toFixed(2)}%`);
    if (Number(batch.final?.securityDelta ?? Infinity) > SECURITY_TOLERANCE) failures.push(`security +${Number(batch.final?.securityDelta ?? 0).toFixed(3)}`);
    return { ok: failures.length === 0, reason: failures.join("; ") };
}

function matchingTelemetry(last, target) {
    if (!last || last.status !== "COMPLETE" || String(last.target ?? "") !== target) return null;
    const spreads = Array.isArray(last.landing?.stages) ? last.landing.stages.map((s) => Number(s.allocationSpreadMs ?? 0)).filter(Number.isFinite) : [];
    return {
        maxAbsLandingErrorMs: Number(last.landing?.maxAbsLandingErrorMs ?? 0),
        maxAllocationSpreadMs: spreads.length ? Math.max(...spreads) : 0,
    };
}

function targetPrepared(ns, target) {
    const maxMoney = ns.getServerMaxMoney(target);
    const money = ns.getServerMoneyAvailable(target);
    const security = ns.getServerSecurityLevel(target);
    const minSecurity = ns.getServerMinSecurityLevel(target);
    return maxMoney > 0 && money / maxMoney >= MONEY_TOLERANCE && security - minSecurity <= SECURITY_TOLERANCE;
}

function publishRunnerState(ns, state) {
    publishBatchSchedulerState(ns, {
        version: 4,
        model: "PIPELINE_EXECUTOR_DEPTH2_V1",
        dryRun: false,
        simulation: false,
        execution: true,
        maxDepth: MAX_DEPTH,
        updatedAt: Date.now(),
        ...state,
    });
}

function publicBatch(batch) {
    return {
        id: batch.id,
        firstLandingAt: batch.firstLandingAt,
        finalLandingAt: batch.finalLandingAt,
        stages: batch.stages.map((stage) => ({ name: stage.name, startAt: stage.startAt, landingAt: stage.landingAt, launched: stage.launched, jobs: stage.jobs.length })),
    };
}

function pushEvent(events, type, message) {
    events.push({ at: Date.now(), type, message });
    while (events.length > MAX_EVENTS) events.shift();
}

function finiteCeil(value) {
    return Number.isFinite(value) && value > 0 ? Math.max(1, Math.ceil(value)) : 1;
}

function fmtMs(value) {
    return Number.isFinite(Number(value)) ? `${Number(value).toFixed(0)}ms` : "n/a";
}

function clamp(value, minimum, maximum) {
    if (!Number.isFinite(value)) return minimum;
    return Math.min(maximum, Math.max(minimum, value));
}

function clampInt(value, minimum, maximum) {
    return Math.floor(clamp(value, minimum, maximum));
}
