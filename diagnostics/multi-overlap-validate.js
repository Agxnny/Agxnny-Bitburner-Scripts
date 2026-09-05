import { WORKER_SCRIPTS, getExecutionPool } from "/lib/execution.js";
import {
    buildPreparedBatchTemplate,
    commitReservation,
    createHostCalendar,
    makeBatch,
    tryReserve,
} from "/lib/batch-allocation.js";
import { readOverlapEvidence, recordOverlapWave } from "/lib/multi-overlap-evidence.js";
import { targetOverlapPolicy } from "/lib/multi-overlap-policy.js";
import {
    RuntimePort,
    readBatchHistoryState,
    readControllerState,
    readPlannerState,
} from "/lib/runtime-state.js";
import { positionalArgs } from "/lib/output.js";

const DEFAULT_WAVES = 2;
const DEFAULT_HACK_FRACTION = 0.10;
const DEFAULT_STAGE_GAP_MS = 200;
const DEPTH = 2;
const DISPATCH_LEAD_MS = 100;
const LOOP_MS = 20;
const COMPLETE_GRACE_MS = 2_000;
const MONEY_TOLERANCE = 0.995;
const SECURITY_TOLERANCE = 0.05;
const MAX_LANDING_ERROR_MS = 150;
const MIN_SPACING_MS = 75;

/**
 * Dedicated real same-target depth-2 validator.
 * Usage: run diagnostics/multi-overlap-validate.js [target|auto] [waves] [hackFraction] [stageGapMs]
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    const args = positionalArgs(ns);
    const requestedTarget = String(args[0] ?? "auto").trim();
    const waves = clampInt(Number(args[1] ?? DEFAULT_WAVES), 1, 6);
    const hackFraction = clamp(Number(args[2] ?? DEFAULT_HACK_FRACTION), 0.001, 0.50);
    const stageGapMs = clampInt(Number(args[3] ?? DEFAULT_STAGE_GAP_MS), 75, 1000);

    const preflight = preflightCheck(ns);
    if (!preflight.ok) {
        ns.tprint(`[OVERLAP-VALIDATE] BLOCKED: ${preflight.reason}`);
        return;
    }

    const planner = readPlannerState(ns);
    const history = readBatchHistoryState(ns);
    const evidence = readOverlapEvidence(ns);
    const target = chooseTarget(ns, planner, history, evidence, requestedTarget, hackFraction, stageGapMs);
    if (!target.ok) {
        ns.tprint(`[OVERLAP-VALIDATE] BLOCKED: ${target.reason}`);
        return;
    }

    ns.tprint("=== SAME-TARGET OVERLAP VALIDATOR · REAL DEPTH 2 ===");
    ns.tprint(`[OVERLAP-VALIDATE] Target ${target.hostname} · ${waves} wave(s) · hack ${(hackFraction * 100).toFixed(1)}% · gap ${stageGapMs}ms`);
    ns.tprint("[OVERLAP-VALIDATE] Requires controller STANDBY. One validator owns Port 14 until complete.");
    ns.getPortHandle(RuntimePort.BATCH_TIMING_EVENTS).clear();

    let clean = 0;
    for (let wave = 1; wave <= waves; wave += 1) {
        if (!controllerStillStandby(ns)) {
            ns.tprint("[OVERLAP-VALIDATE] ABORTED: controller left STANDBY");
            return;
        }
        if (!isPrepared(ns, target.hostname)) {
            ns.tprint(`[OVERLAP-VALIDATE] BLOCKED: ${target.hostname} is no longer prepared`);
            return;
        }

        const result = await runWave(ns, target.entry, wave, hackFraction, stageGapMs);
        await recordOverlapWave(ns, result);
        ns.tprint(`[OVERLAP-VALIDATE] Wave ${wave}/${waves} ${result.healthy ? "CLEAN" : "FAILED"} | spacing ${fmt(result.minimumSpacingMs)} | drift ${fmt(result.maxAbsLandingErrorMs)} | ${result.reason}`);
        if (!result.healthy) {
            ns.tprint("[OVERLAP-VALIDATE] STOP: failed wave recorded; production overlap remains/demotes to depth 1.");
            return;
        }
        clean += 1;
    }

    const durable = readOverlapEvidence(ns)?.targets?.[target.hostname];
    ns.tprint(`[OVERLAP-VALIDATE] COMPLETE: ${clean}/${waves} clean this run · durable consecutive ${Number(durable?.consecutiveClean ?? 0)} · proven depth ${Number(durable?.provenDepth ?? 1)}`);
}

async function runWave(ns, entry, wave, hackFraction, stageGapMs) {
    const planner = readPlannerState(ns);
    const template = buildPreparedBatchTemplate(ns, entry, hackFraction, stageGapMs, { dispatchLeadMs: DISPATCH_LEAD_MS });
    if (!template.ok) return failed(template.hostname || entry.hostname, wave, hackFraction, stageGapMs, template.reason || "template failed");

    const pool = getExecutionPool(ns, planner);
    if (!pool.length) return failed(template.hostname, wave, hackFraction, stageGapMs, "No remote production RAM available");

    const hosts = createHostCalendar(pool, [], Date.now());
    const firstLandingAt = Date.now() + template.firstLandingDelayMs;
    const intervalMs = stageGapMs * 4;
    const batches = [0, 1].map((index) => {
        const batch = makeBatch(template, firstLandingAt + index * intervalMs, index + 1);
        batch.id = `overlap-${Date.now().toString(36)}-${ns.pid}-w${wave}-b${index + 1}`;
        return batch;
    });

    for (const batch of batches) {
        const reservation = tryReserve(hosts, batch);
        if (!reservation.ok) return failed(template.hostname, wave, hackFraction, stageGapMs, `RAM reservation failed for ${batch.id}`);
        commitReservation(hosts, reservation);
        attachAllocations(batch, reservation.allocations);
    }

    while (batches.some((batch) => !batch.done)) {
        if (!controllerStillStandby(ns)) {
            cancelAll(ns, batches);
            return failed(template.hostname, wave, hackFraction, stageGapMs, "Controller left STANDBY during wave", "ABORTED");
        }
        const now = Date.now();
        drainTimingEvents(ns, batches);
        for (const batch of batches) {
            for (const stage of batch.stages) {
                if (stage.launched || now < stage.startAt - DISPATCH_LEAD_MS) continue;
                const launched = launchStage(ns, batch, stage);
                if (!launched.ok) {
                    cancelAll(ns, batches);
                    return failed(template.hostname, wave, hackFraction, stageGapMs, `${batch.id} ${stage.name}: ${launched.reason}`);
                }
            }
        }
        for (const batch of batches) {
            if (batch.done) continue;
            const launched = batch.stages.every((stage) => stage.launched);
            const running = batch.stages.some((stage) => stage.jobs.some((job) => ns.isRunning(job.pid, job.hostname)));
            if (launched && !running && now >= batch.finalLandingAt - COMPLETE_GRACE_MS) batch.done = true;
        }
        await ns.sleep(LOOP_MS);
    }

    drainTimingEvents(ns, batches);
    return evaluateWave(ns, template.hostname, batches, wave, hackFraction, stageGapMs, intervalMs);
}

function evaluateWave(ns, target, batches, wave, hackFraction, stageGapMs, intervalMs) {
    const summaries = batches.map((batch) => summarizeBatch(batch));
    const events = summaries.flatMap((summary, batchIndex) => summary.stages.map((stage, stageIndex) => ({
        batchIndex,
        stageIndex,
        name: stage.name,
        actualLandingAt: stage.actualLandingAt,
    }))).sort((a, b) => a.actualLandingAt - b.actualLandingAt);
    const expected = [];
    for (let batchIndex = 0; batchIndex < DEPTH; batchIndex += 1) {
        for (let stageIndex = 0; stageIndex < 4; stageIndex += 1) expected.push(`${batchIndex}:${stageIndex}`);
    }
    const actual = events.map((event) => `${event.batchIndex}:${event.stageIndex}`);
    const globalOrderCorrect = expected.every((key, index) => actual[index] === key);
    let globalSpacing = Infinity;
    for (let i = 1; i < events.length; i += 1) globalSpacing = Math.min(globalSpacing, events[i].actualLandingAt - events[i - 1].actualLandingAt);
    const missingJobs = summaries.reduce((sum, summary) => sum + summary.missingJobs, 0);
    const maxDrift = Math.max(...summaries.map((summary) => summary.maxAbsLandingErrorMs));
    const minimumSpacingMs = Math.min(Number.isFinite(globalSpacing) ? globalSpacing : 0, ...summaries.map((summary) => summary.minimumSpacingMs));
    const money = ns.getServerMoneyAvailable(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const secDelta = Math.max(0, ns.getServerSecurityLevel(target) - ns.getServerMinSecurityLevel(target));
    const moneyRatio = maxMoney > 0 ? money / maxMoney : 0;

    let reason = "two complete HWGW landing streams preserved order and recovery";
    let healthy = true;
    if (missingJobs > 0) { healthy = false; reason = `${missingJobs} timing job(s) missing`; }
    else if (!summaries.every((summary) => summary.orderCorrect)) { healthy = false; reason = "within-batch landing order incorrect"; }
    else if (!globalOrderCorrect) { healthy = false; reason = "adjacent batch landing streams crossed"; }
    else if (maxDrift > MAX_LANDING_ERROR_MS) { healthy = false; reason = `landing drift ${maxDrift.toFixed(0)}ms exceeds ${MAX_LANDING_ERROR_MS}ms`; }
    else if (minimumSpacingMs < MIN_SPACING_MS) { healthy = false; reason = `minimum spacing ${minimumSpacingMs.toFixed(0)}ms below ${MIN_SPACING_MS}ms`; }
    else if (moneyRatio < MONEY_TOLERANCE) { healthy = false; reason = `final money recovered to ${(moneyRatio * 100).toFixed(2)}%`; }
    else if (secDelta > SECURITY_TOLERANCE) { healthy = false; reason = `final security recovered only to +${secDelta.toFixed(3)}`; }

    return {
        target,
        runId: `overlap-${Date.now().toString(36)}-${wave}`,
        status: healthy ? "CLEAN" : "FAILED",
        healthy,
        reason,
        depth: DEPTH,
        hackFraction,
        stageGapMs,
        batchIntervalMs: intervalMs,
        missingJobs,
        globalOrderCorrect,
        maxAbsLandingErrorMs: maxDrift,
        minimumSpacingMs,
        finalMoneyRatio: moneyRatio,
        finalSecurityDelta: secDelta,
    };
}

function summarizeBatch(batch) {
    const stages = batch.stages.map((stage) => {
        const events = [...stage.events].sort((a, b) => Number(a.finishedAt ?? 0) - Number(b.finishedAt ?? 0));
        const actualLandingAt = events.length ? Number(events[events.length - 1].finishedAt ?? 0) : 0;
        return {
            name: stage.name,
            actualLandingAt,
            landingErrorMs: actualLandingAt ? actualLandingAt - stage.landingAt : Infinity,
            missingJobs: Math.max(0, stage.allocations.length - events.length),
        };
    });
    const actualOrder = [...stages].sort((a, b) => a.actualLandingAt - b.actualLandingAt).map((stage) => stage.name);
    const expectedOrder = ["HACK", "WEAKEN_HACK", "GROW", "WEAKEN_GROW"];
    const orderCorrect = stages.every((stage) => stage.actualLandingAt > 0) && expectedOrder.every((name, index) => actualOrder[index] === name);
    const times = stages.map((stage) => stage.actualLandingAt).filter((time) => time > 0).sort((a, b) => a - b);
    let spacing = Infinity;
    for (let i = 1; i < times.length; i += 1) spacing = Math.min(spacing, times[i] - times[i - 1]);
    return {
        stages,
        orderCorrect,
        missingJobs: stages.reduce((sum, stage) => sum + stage.missingJobs, 0),
        maxAbsLandingErrorMs: Math.max(...stages.map((stage) => Math.abs(stage.landingErrorMs))),
        minimumSpacingMs: Number.isFinite(spacing) ? spacing : 0,
    };
}

function chooseTarget(ns, planner, history, evidence, requestedTarget, hackFraction, stageGapMs) {
    const rankings = Array.isArray(planner?.rankings) ? planner.rankings : [];
    const candidates = rankings.map((entry) => {
        const template = buildPreparedBatchTemplate(ns, entry, hackFraction, stageGapMs);
        const policy = targetOverlapPolicy(history, entry.hostname, evidence);
        return { entry, hostname: entry.hostname, template, policy };
    });
    if (requestedTarget && requestedTarget.toLowerCase() !== "auto") {
        const found = candidates.find((candidate) => candidate.hostname === requestedTarget);
        if (!found) return { ok: false, reason: `${requestedTarget} is not an eligible planner target` };
        if (!found.template.ok || !found.template.preparedNow) return { ok: false, reason: `${requestedTarget} is not prepared` };
        if (!found.policy.eligibleForValidation) return { ok: false, reason: `${requestedTarget} is not depth-2 validation eligible: ${found.policy.reason}` };
        return { ok: true, ...found };
    }
    const found = candidates.find((candidate) => candidate.template.ok && candidate.template.preparedNow && candidate.policy.eligibleForValidation && candidate.policy.provenDepth < 2);
    if (!found) return { ok: false, reason: "No prepared, pipeline-qualified target still needs dedicated depth-2 proof" };
    return { ok: true, ...found };
}

function preflightCheck(ns) {
    const controller = readControllerState(ns);
    if (!controller) return { ok: false, reason: "Controller state unavailable" };
    const mode = String(controller.executionMode?.mode ?? "STANDBY").toUpperCase();
    const pending = String(controller.executionMode?.pending ?? "");
    if (mode !== "STANDBY" || pending) return { ok: false, reason: `Controller must be fully STANDBY; current ${pending ? `${mode} -> ${pending}` : mode}` };
    if (Number(controller.execution?.activeJobs ?? 0) > 0) return { ok: false, reason: "Controller still has active standalone workers" };
    const blockedScripts = ["/hacking/pipeline-runner.js", "/hacking/multi-target-runner.js", "/hacking/automulti-controller.js"];
    for (const script of blockedScripts) if (ns.scriptRunning(script, "home")) return { ok: false, reason: `${script} is active on home` };
    const planner = readPlannerState(ns);
    for (const host of Array.isArray(planner?.executionHosts) ? planner.executionHosts : []) {
        const hostname = String(host?.hostname ?? "");
        if (!hostname) continue;
        try { if (ns.scriptRunning("/hacking/batch-runner.js", hostname)) return { ok: false, reason: `batch-runner.js is active on ${hostname}` }; } catch { /* stale host */ }
    }
    return { ok: true };
}

function controllerStillStandby(ns) {
    const controller = readControllerState(ns);
    return Boolean(controller && String(controller.executionMode?.mode ?? "").toUpperCase() === "STANDBY" && !String(controller.executionMode?.pending ?? ""));
}
function isPrepared(ns, target) {
    const maxMoney = ns.getServerMaxMoney(target);
    return maxMoney > 0
        && ns.getServerMoneyAvailable(target) / maxMoney >= MONEY_TOLERANCE
        && ns.getServerSecurityLevel(target) - ns.getServerMinSecurityLevel(target) <= SECURITY_TOLERANCE;
}
function attachAllocations(batch, allocations) {
    for (const stage of batch.stages) {
        stage.script = stage.name === "HACK" ? WORKER_SCRIPTS.HACK : stage.name === "GROW" ? WORKER_SCRIPTS.GROW : WORKER_SCRIPTS.WEAKEN;
        stage.allocations = allocations.filter((allocation) => allocation.stage === stage.name);
        stage.jobs = [];
        stage.events = [];
        stage.launched = false;
    }
    batch.done = false;
}
function launchStage(ns, batch, stage) {
    const additionalMsec = Math.max(0, Math.floor(stage.landingAt - Date.now() - stage.durationMs));
    for (const allocation of stage.allocations) {
        const jobId = `${batch.id}-${stage.name}-${allocation.hostname}`;
        const pid = ns.exec(stage.script, allocation.hostname, allocation.threads, batch.target, jobId, allocation.threads, additionalMsec, batch.id, stage.name, stage.landingAt);
        if (pid <= 0) return { ok: false, reason: `ns.exec failed on ${allocation.hostname}` };
        stage.jobs.push({ pid, hostname: allocation.hostname });
    }
    stage.launched = true;
    return { ok: true };
}
function drainTimingEvents(ns, batches) {
    const byId = new Map(batches.map((batch) => [batch.id, batch]));
    const port = ns.getPortHandle(RuntimePort.BATCH_TIMING_EVENTS);
    while (!port.empty()) {
        try {
            const event = JSON.parse(String(port.read()));
            if (event?.type !== "BATCH_STAGE_COMPLETE") continue;
            const batch = byId.get(String(event.batchId ?? ""));
            const stage = batch?.stages.find((entry) => entry.name === String(event.stage ?? ""));
            if (stage) stage.events.push(event);
        } catch { /* malformed telemetry becomes missing telemetry */ }
    }
}
function cancelAll(ns, batches) {
    for (const batch of batches) for (const stage of batch.stages) for (const job of stage.jobs ?? []) {
        try { ns.kill(job.pid, job.hostname); } catch { /* host may disappear */ }
    }
}
function failed(target, wave, hackFraction, stageGapMs, reason, status = "FAILED") {
    return { target, runId: `overlap-${Date.now().toString(36)}-${wave}`, status, healthy: false, reason, depth: DEPTH, hackFraction, stageGapMs, maxAbsLandingErrorMs: 0, minimumSpacingMs: 0 };
}
function clamp(value, min, max) { return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min; }
function clampInt(value, min, max) { return Math.floor(clamp(value, min, max)); }
function fmt(value) { return `${Number(value ?? 0).toFixed(0)}ms`; }
