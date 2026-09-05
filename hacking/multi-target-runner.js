import { WORKER_SCRIPTS, getExecutionPool } from "/lib/execution.js";
import {
    buildPreparedBatchTemplate,
    commitReservation,
    createHostCalendar,
    findLandingStart,
    makeBatch,
    normalizeObjectiveScores,
    tryReserve,
} from "/lib/batch-allocation.js";
import {
    RuntimePort,
    publishLastCompletedBatchState,
    publishMultiTargetSchedulerState,
    readEconomyTargetState,
    readPlannerState,
} from "/lib/runtime-state.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const DEFAULT_PROFILE = "money";
const DEFAULT_TARGET_COUNT = 4;
const DEFAULT_HACK_FRACTION = 0.10;
const DEFAULT_STAGE_GAP_MS = 200;
const GLOBAL_LIVE_DEPTH = 2;
const PER_TARGET_LIVE_DEPTH = 1;
const GLOBAL_LANDING_GAP_MS = 100;
const DISPATCH_LEAD_MS = 100;
const LOOP_MS = 20;
const COMPLETE_GRACE_MS = 2_000;
const MONEY_TOLERANCE = 0.995;
const SECURITY_TOLERANCE = 0.05;
const MAX_LANDING_ERROR_MS = 150;
const MIN_SPACING_MS = 75;
const PROFILE_WEIGHTS = Object.freeze({
    money: { money: 1.00, xp: 0.00 },
    balanced: { money: 0.70, xp: 0.30 },
    xp: { money: 0.00, xp: 1.00 },
});

/**
 * First real multi-target executor prototype.
 *
 * Safety posture is intentionally conservative:
 * - finite one-wave execution only;
 * - global live depth hard-capped at 2;
 * - per-target live depth hard-capped at 1;
 * - only already-prepared targets are admitted;
 * - one coordinator owns Port 14 and routes timing events by batchId;
 * - no dynamic Port 19 live-depth promotion yet.
 *
 * Usage:
 *   run hacking/multi-target-runner.js [money|balanced|xp] [targetCount] [hackFraction] [stageGapMs]
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
    const quiet = isQuiet(ns);

    if (ns.getHostname() !== "home") {
        if (!quiet) ns.tprint("ERROR: Run hacking/multi-target-runner.js from home.");
        return;
    }

    const preflight = preflightCheck(ns);
    if (!preflight.ok) {
        publishState(ns, profile, "BLOCKED", preflight.reason, [], []);
        if (!quiet) ns.tprint(`[MULTI-REAL] BLOCKED: ${preflight.reason}`);
        return;
    }

    const planner = readPlannerState(ns);
    const economic = readEconomyTargetState(ns);
    const pool = getExecutionPool(ns, planner);
    const weights = PROFILE_WEIGHTS[profile];
    const templates = sourceRankings(planner, economic, profile)
        .slice(0, targetCount)
        .map((entry) => buildPreparedBatchTemplate(ns, entry, hackFraction, stageGapMs, { dispatchLeadMs: DISPATCH_LEAD_MS }))
        .filter((entry) => entry.ok);
    normalizeObjectiveScores(templates, weights);

    const prepared = templates.filter((target) => target.preparedNow);
    if (prepared.length < 2) {
        const reason = `Need at least 2 prepared candidate targets; found ${prepared.length}`;
        publishState(ns, profile, "BLOCKED", reason, [], []);
        if (!quiet) ns.tprint(`[MULTI-REAL] BLOCKED: ${reason}`);
        return;
    }

    const plan = buildConservativePlan(ns, pool, prepared);
    if (!plan.ok) {
        publishState(ns, profile, "BLOCKED", plan.reason, [], []);
        if (!quiet) ns.tprint(`[MULTI-REAL] BLOCKED: ${plan.reason}`);
        return;
    }

    ns.getPortHandle(RuntimePort.BATCH_TIMING_EVENTS).clear();
    const live = plan.batches;
    if (!quiet) {
        ns.tprint("=== MULTI-TARGET REAL · CONSERVATIVE PROTOTYPE ===");
        ns.tprint(`[MULTI-REAL] ${profile.toUpperCase()} | global depth ${GLOBAL_LIVE_DEPTH} | per-target depth ${PER_TARGET_LIVE_DEPTH}`);
        for (const batch of live) ns.tprint(`[MULTI-REAL] ADMIT ${batch.target} | ${batch.id}`);
    }

    publishState(ns, profile, "RUNNING", `${live.length} real batch(es) admitted`, live, []);
    let safetyStop = "";
    const completed = [];

    while (live.some((batch) => !batch.done)) {
        const now = Date.now();
        drainTimingEvents(ns, live);

        for (const batch of live) {
            if (batch.done || batch.cancelled) continue;
            for (const stage of batch.stages) {
                if (stage.launched || now < stage.startAt - DISPATCH_LEAD_MS) continue;
                const result = launchStage(ns, batch, stage);
                if (!result.ok) {
                    cancelBatch(ns, batch);
                    batch.cancelled = true;
                    batch.done = true;
                    safetyStop = `${batch.id} launch failed at ${stage.name}: ${result.reason}`;
                    break;
                }
            }
            if (safetyStop) break;
        }

        if (safetyStop) {
            for (const batch of live) {
                if (!batch.done) {
                    cancelBatch(ns, batch);
                    batch.cancelled = true;
                    batch.done = true;
                }
            }
            break;
        }

        for (const batch of live) {
            if (batch.done || batch.cancelled) continue;
            const allStagesLaunched = batch.stages.every((stage) => stage.launched);
            const anyRunning = batch.stages.some((stage) => stage.jobs.some((job) => ns.isRunning(job.pid, job.hostname)));
            if (allStagesLaunched && !anyRunning && now >= batch.finalLandingAt - COMPLETE_GRACE_MS) {
                const complete = finalizeBatch(ns, batch, stageGapMs);
                batch.done = true;
                batch.complete = complete;
                completed.push(complete);
                publishLastCompletedBatchState(ns, complete);

                const safety = validateComplete(complete);
                if (!quiet) {
                    ns.tprint(`[MULTI-REAL] ${safety.ok ? "COMPLETE" : "SAFETY STOP"} ${batch.target} | money ${(complete.final.moneyPercent * 100).toFixed(2)}% | sec +${complete.final.securityDelta.toFixed(3)} | ${complete.landing.orderCorrect ? "ORDER OK" : "ORDER BAD"}`);
                }
                if (!safety.ok) {
                    safetyStop = `${batch.id}: ${safety.reason}`;
                    break;
                }
            }
        }

        publishState(ns, profile, safetyStop ? "SAFETY_STOP" : "RUNNING", safetyStop || `${live.filter((batch) => !batch.done).length} batch(es) in flight`, live, completed);
        if (safetyStop) break;
        await ns.sleep(LOOP_MS);
    }

    const status = safetyStop ? "SAFETY_STOP" : "COMPLETE";
    const reason = safetyStop || `Completed ${completed.length}/${live.length} conservative real multi-target batch(es)`;
    publishState(ns, profile, status, reason, live, completed);
    if (!quiet) {
        ns.tprint(`[MULTI-REAL] ${status} | completed ${completed.length}/${live.length}`);
        if (safetyStop) ns.tprint(`[MULTI-REAL] ${safetyStop}`);
    }
}

function buildConservativePlan(ns, pool, prepared) {
    const hosts = createHostCalendar(pool, [], Date.now());
    const landings = [];
    const batches = [];
    const candidates = [...prepared].sort((a, b) => b.baseScore - a.baseScore || b.expectedCash - a.expectedCash || a.hostname.localeCompare(b.hostname));
    let sequence = 0;

    for (const target of candidates) {
        if (batches.length >= GLOBAL_LIVE_DEPTH) break;
        if (batches.some((batch) => batch.target === target.hostname)) continue;
        const firstLandingAt = findLandingStart(target, landings, Date.now() + target.firstLandingDelayMs, GLOBAL_LANDING_GAP_MS, Date.now());
        const batch = makeBatch(target, firstLandingAt, ++sequence);
        const reservation = tryReserve(hosts, batch);
        if (!reservation.ok) continue;
        commitReservation(hosts, reservation);
        attachAllocations(batch, reservation.allocations);
        batches.push(batch);
        for (const stage of batch.stages) landings.push(stage.landingAt);
    }

    if (batches.length < GLOBAL_LIVE_DEPTH) {
        return { ok: false, reason: `Could only reserve ${batches.length}/${GLOBAL_LIVE_DEPTH} distinct prepared targets`, batches: [] };
    }
    return { ok: true, batches };
}

function attachAllocations(batch, allocations) {
    for (const stage of batch.stages) {
        stage.script = scriptForStage(stage.name);
        stage.allocations = allocations
            .filter((allocation) => allocation.stage === stage.name)
            .map((allocation) => ({ hostname: allocation.hostname, threads: allocation.threads, ram: allocation.ram }));
        stage.jobs = [];
        stage.events = [];
        stage.launched = false;
    }
    batch.done = false;
    batch.cancelled = false;
}

function launchStage(ns, batch, stage) {
    const additionalMsec = Math.max(0, Math.floor(stage.landingAt - Date.now() - stage.durationMs));
    for (const allocation of stage.allocations) {
        const jobId = `${batch.id}-${stage.name}-${allocation.hostname}`;
        const pid = ns.exec(
            stage.script,
            allocation.hostname,
            allocation.threads,
            batch.target,
            jobId,
            allocation.threads,
            additionalMsec,
            batch.id,
            stage.name,
            stage.landingAt,
        );
        if (pid <= 0) return { ok: false, reason: `ns.exec failed on ${allocation.hostname}` };
        stage.jobs.push({ pid, hostname: allocation.hostname, threads: allocation.threads, jobId });
    }
    stage.launched = true;
    return { ok: true };
}

function cancelBatch(ns, batch) {
    for (const stage of batch.stages) {
        for (const job of stage.jobs) {
            try { ns.kill(job.pid, job.hostname); } catch { /* host may disappear */ }
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
            if (!batch) continue;
            const stage = batch.stages.find((entry) => entry.name === String(event.stage ?? ""));
            if (stage) stage.events.push(event);
        } catch {
            // Missing timing telemetry is detected during finalization.
        }
    }
}

function finalizeBatch(ns, batch, gapMs) {
    const money = ns.getServerMoneyAvailable(batch.target);
    const maxMoney = ns.getServerMaxMoney(batch.target);
    const security = ns.getServerSecurityLevel(batch.target);
    const minSecurity = ns.getServerMinSecurityLevel(batch.target);
    const landing = summarizeLanding(batch.stages);
    const finishedAt = Date.now();
    return {
        version: 1,
        model: "MULTI_TARGET_EXECUTOR_V1_CONSERVATIVE",
        pipeline: true,
        multiTarget: true,
        status: "COMPLETE",
        batchId: batch.id,
        target: batch.target,
        gapMs,
        finishedAt,
        final: {
            money,
            maxMoney,
            moneyPercent: maxMoney > 0 ? money / maxMoney : 0,
            security,
            minSecurity,
            securityDelta: Math.max(0, security - minSecurity),
        },
        landing,
        updatedAt: finishedAt,
    };
}

function summarizeLanding(stages) {
    const results = stages.map((stage) => {
        const events = [...stage.events].sort((a, b) => Number(a.finishedAt ?? 0) - Number(b.finishedAt ?? 0));
        const expectedJobs = stage.allocations.length;
        const reportedJobs = events.length;
        const actualLandingAt = reportedJobs ? Number(events[reportedJobs - 1].finishedAt ?? 0) : 0;
        const firstCompletionAt = reportedJobs ? Number(events[0].finishedAt ?? 0) : 0;
        return {
            name: stage.name,
            plannedLandingAt: stage.landingAt,
            actualLandingAt,
            expectedJobs,
            reportedJobs,
            missingJobs: Math.max(0, expectedJobs - reportedJobs),
            landingErrorMs: actualLandingAt ? actualLandingAt - stage.landingAt : Infinity,
            allocationSpreadMs: reportedJobs > 1 ? actualLandingAt - firstCompletionAt : 0,
        };
    });
    const actualOrder = [...results].sort((a, b) => a.actualLandingAt - b.actualLandingAt).map((stage) => stage.name);
    const expectedOrder = ["HACK", "WEAKEN_HACK", "GROW", "WEAKEN_GROW"];
    const orderCorrect = results.every((stage) => stage.actualLandingAt > 0) && expectedOrder.every((name, index) => actualOrder[index] === name);
    const actualTimes = results.map((stage) => stage.actualLandingAt).filter((value) => value > 0).sort((a, b) => a - b);
    let minimumSpacingMs = Infinity;
    for (let i = 1; i < actualTimes.length; i += 1) minimumSpacingMs = Math.min(minimumSpacingMs, actualTimes[i] - actualTimes[i - 1]);
    const finiteErrors = results.map((stage) => Math.abs(stage.landingErrorMs)).filter(Number.isFinite);
    return {
        orderCorrect,
        expectedOrder,
        actualOrder,
        stages: results,
        missingJobs: results.reduce((sum, stage) => sum + stage.missingJobs, 0),
        maxAbsLandingErrorMs: finiteErrors.length ? Math.max(...finiteErrors) : Infinity,
        minimumSpacingMs: Number.isFinite(minimumSpacingMs) ? minimumSpacingMs : 0,
        maxAllocationSpreadMs: results.length ? Math.max(...results.map((stage) => stage.allocationSpreadMs)) : 0,
    };
}

function validateComplete(complete) {
    if (!complete.landing.orderCorrect) return { ok: false, reason: "stage landing order incorrect" };
    if (complete.landing.missingJobs > 0) return { ok: false, reason: `${complete.landing.missingJobs} timing job(s) missing` };
    if (complete.final.moneyPercent < MONEY_TOLERANCE) return { ok: false, reason: `money recovered to only ${(complete.final.moneyPercent * 100).toFixed(2)}%` };
    if (complete.final.securityDelta > SECURITY_TOLERANCE) return { ok: false, reason: `security recovered only to +${complete.final.securityDelta.toFixed(3)}` };
    if (complete.landing.maxAbsLandingErrorMs > MAX_LANDING_ERROR_MS) return { ok: false, reason: `landing drift ${complete.landing.maxAbsLandingErrorMs.toFixed(0)}ms exceeds ${MAX_LANDING_ERROR_MS}ms` };
    if (complete.landing.minimumSpacingMs < MIN_SPACING_MS) return { ok: false, reason: `minimum spacing ${complete.landing.minimumSpacingMs.toFixed(0)}ms below ${MIN_SPACING_MS}ms` };
    return { ok: true, reason: "" };
}

function preflightCheck(ns) {
    if (ns.scriptRunning("/hacking/pipeline-runner.js", "home")) return { ok: false, reason: "Single-target pipeline-runner is active on home" };
    if (ns.scriptRunning("/hacking/multi-target-sim.js", "home")) return { ok: false, reason: "Planning simulator is active on home; stop it before real execution" };
    const planner = readPlannerState(ns);
    const hosts = new Set(["home"]);
    for (const host of Array.isArray(planner?.executionHosts) ? planner.executionHosts : []) {
        const hostname = String(host?.hostname ?? "").trim();
        if (hostname) hosts.add(hostname);
    }
    for (const hostname of hosts) {
        try {
            if (ns.scriptRunning("/hacking/batch-runner.js", hostname)) return { ok: false, reason: `Serialized batch-runner is active on ${hostname}` };
        } catch {
            // Ignore stale planner hosts.
        }
    }
    return { ok: true, reason: "" };
}

function publishState(ns, profile, status, reason, batches, completed) {
    publishMultiTargetSchedulerState(ns, {
        version: 1,
        model: "MULTI_TARGET_EXECUTOR_V1_CONSERVATIVE",
        dryRun: false,
        launchesWorkers: true,
        consumesBatchTimingPort: true,
        profile,
        status,
        reason,
        globalLiveDepthCap: GLOBAL_LIVE_DEPTH,
        perTargetLiveDepthCap: PER_TARGET_LIVE_DEPTH,
        inFlight: batches.filter((batch) => !batch.done).map((batch) => ({
            id: batch.id,
            target: batch.target,
            firstLandingAt: batch.firstLandingAt,
            finalLandingAt: batch.finalLandingAt,
            launchedStages: batch.stages.filter((stage) => stage.launched).map((stage) => stage.name),
        })),
        completed: completed.map((entry) => ({
            batchId: entry.batchId,
            target: entry.target,
            healthy: validateComplete(entry).ok,
            moneyPercent: entry.final.moneyPercent,
            securityDelta: entry.final.securityDelta,
            orderCorrect: entry.landing.orderCorrect,
            maxAbsLandingErrorMs: entry.landing.maxAbsLandingErrorMs,
            minimumSpacingMs: entry.landing.minimumSpacingMs,
        })),
        updatedAt: Date.now(),
    });
}

function sourceRankings(planner, economic, profile) {
    if (profile === "xp") return Array.isArray(planner?.rankings) ? planner.rankings : [];
    const economicRows = Array.isArray(economic?.rankings) ? economic.rankings : [];
    if (economicRows.length >= 2) return economicRows;
    return Array.isArray(planner?.rankings) ? planner.rankings : [];
}

function scriptForStage(name) {
    if (name === "HACK") return WORKER_SCRIPTS.HACK;
    if (name === "GROW") return WORKER_SCRIPTS.GROW;
    return WORKER_SCRIPTS.WEAKEN;
}

function normalizeProfile(value) {
    const profile = String(value ?? DEFAULT_PROFILE).trim().toLowerCase();
    return PROFILE_WEIGHTS[profile] ? profile : DEFAULT_PROFILE;
}
function clamp(value, min, max) { return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min; }
function clampInt(value, min, max) { return Math.floor(clamp(value, min, max)); }
