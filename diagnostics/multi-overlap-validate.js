import { WORKER_SCRIPTS, getExecutionPool } from "/lib/execution.js";
import { buildPreparedBatchTemplate, commitReservation, createHostCalendar, makeBatch, tryReserve } from "/lib/batch-allocation.js";
import { readOverlapEvidence, recordOverlapWave } from "/lib/multi-overlap-evidence.js";
import { publishOverlapValidationState } from "/lib/overlap-validation-state.js";
import { targetOverlapPolicy } from "/lib/multi-overlap-policy.js";
import { RuntimePort, readBatchHistoryState, readControllerState, readPlannerState } from "/lib/runtime-state.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const DEFAULT_WAVES = 2, DEFAULT_HACK_FRACTION = 0.10, DEFAULT_STAGE_GAP_MS = 200;
const DEPTH = 2, DISPATCH_LEAD_MS = 100, LOOP_MS = 20, COMPLETE_GRACE_MS = 2_000;
const MONEY_TOLERANCE = 0.995, SECURITY_TOLERANCE = 0.05, MAX_LANDING_ERROR_MS = 150, MIN_SPACING_MS = 75;
const ALLOW_UNQUALIFIED_FLAG = "--allow-unqualified";

/** Dedicated real same-target depth-2 validator. @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const quiet = isQuiet(ns);
    const allowUnqualified = ns.args.some((arg) => String(arg).toLowerCase() === ALLOW_UNQUALIFIED_FLAG);
    const args = positionalArgs(ns).filter((arg) => String(arg).toLowerCase() !== ALLOW_UNQUALIFIED_FLAG);
    const requestedTarget = String(args[0] ?? "auto").trim();
    const waves = clampInt(Number(args[1] ?? DEFAULT_WAVES), 1, 6);
    const hackFraction = clamp(Number(args[2] ?? DEFAULT_HACK_FRACTION), 0.001, 0.50);
    const stageGapMs = clampInt(Number(args[3] ?? DEFAULT_STAGE_GAP_MS), 75, 1000);
    const startedAt = Date.now();
    const base = { pid: ns.pid, requestedTarget, requestedWaves: waves, hackFraction, stageGapMs, depth: DEPTH, startedAt, allowUnqualified };

    const preflight = preflightCheck(ns);
    if (!preflight.ok) return stopEarly(ns, base, "BLOCKED", preflight.reason);
    const planner = readPlannerState(ns), history = readBatchHistoryState(ns), evidence = readOverlapEvidence(ns);
    const target = chooseTarget(ns, planner, history, evidence, requestedTarget, hackFraction, stageGapMs, allowUnqualified);
    if (!target.ok) return stopEarly(ns, base, "BLOCKED", target.reason);

    if (!quiet) {
        ns.tprint("=== SAME-TARGET OVERLAP VALIDATOR · REAL DEPTH 2 ===");
        ns.tprint(`[OVERLAP-VALIDATE] Target ${target.hostname} · ${waves} wave(s) · hack ${(hackFraction * 100).toFixed(1)}% · gap ${stageGapMs}ms${allowUnqualified ? " · explicit qualification test" : ""}`);
    }
    ns.getPortHandle(RuntimePort.BATCH_TIMING_EVENTS).clear();
    let clean = 0;
    await publishOverlapValidationState(ns, { ...base, target: target.hostname, status: "STARTING", reason: allowUnqualified && !target.policy.eligibleForValidation ? "Explicit prepared-target qualification admitted" : "Validation admitted", currentWave: 0, cleanWaves: 0, inFlight: [] });

    for (let wave = 1; wave <= waves; wave += 1) {
        if (!controllerStillStandby(ns)) return stopEarly(ns, { ...base, target: target.hostname, currentWave: wave, cleanWaves: clean }, "ABORTED", "Controller left STANDBY");
        if (!isPrepared(ns, target.hostname)) return stopEarly(ns, { ...base, target: target.hostname, currentWave: wave, cleanWaves: clean }, "BLOCKED", `${target.hostname} is no longer prepared`);
        const result = await runWave(ns, target.entry, wave, hackFraction, stageGapMs, base, clean, waves);
        await recordOverlapWave(ns, result);
        if (!quiet) ns.tprint(`[OVERLAP-VALIDATE] Wave ${wave}/${waves} ${result.healthy ? "CLEAN" : "FAILED"} | spacing ${fmt(result.minimumSpacingMs)} | drift ${fmt(result.maxAbsLandingErrorMs)} | ${result.reason}`);
        if (!result.healthy) {
            await publishOverlapValidationState(ns, { ...base, target: target.hostname, status: result.status, reason: result.reason, currentWave: wave, cleanWaves: clean, lastResult: result, inFlight: [] });
            return;
        }
        clean += 1;
        await publishOverlapValidationState(ns, { ...base, target: target.hostname, status: wave < waves ? "BETWEEN_WAVES" : "COMPLETE", reason: result.reason, currentWave: wave, cleanWaves: clean, lastResult: result, inFlight: [] });
    }
    const durable = readOverlapEvidence(ns)?.targets?.[target.hostname];
    await publishOverlapValidationState(ns, { ...base, target: target.hostname, status: "COMPLETE", reason: `${clean}/${waves} clean; proven depth ${Number(durable?.provenDepth ?? 1)}`, currentWave: waves, cleanWaves: clean, provenDepth: Number(durable?.provenDepth ?? 1), inFlight: [] });
    if (!quiet) ns.tprint(`[OVERLAP-VALIDATE] COMPLETE: ${clean}/${waves} clean this run · durable consecutive ${Number(durable?.consecutiveClean ?? 0)} · proven depth ${Number(durable?.provenDepth ?? 1)}`);
}

async function runWave(ns, entry, wave, hackFraction, stageGapMs, base, clean, requestedWaves) {
    const planner = readPlannerState(ns);
    const template = buildPreparedBatchTemplate(ns, entry, hackFraction, stageGapMs, { dispatchLeadMs: DISPATCH_LEAD_MS });
    if (!template.ok) return failed(template.hostname || entry.hostname, wave, hackFraction, stageGapMs, template.reason || "template failed");
    const pool = getExecutionPool(ns, planner);
    if (!pool.length) return failed(template.hostname, wave, hackFraction, stageGapMs, "No remote production RAM available");
    const hosts = createHostCalendar(pool, [], Date.now()), firstLandingAt = Date.now() + template.firstLandingDelayMs, intervalMs = stageGapMs * 4;
    const batches = [0, 1].map((index) => { const batch = makeBatch(template, firstLandingAt + index * intervalMs, index + 1); batch.id = `overlap-${Date.now().toString(36)}-${ns.pid}-w${wave}-b${index + 1}`; return batch; });
    for (const batch of batches) {
        const reservation = tryReserve(hosts, batch);
        if (!reservation.ok) return failed(template.hostname, wave, hackFraction, stageGapMs, `RAM reservation failed for ${batch.id}`);
        commitReservation(hosts, reservation); attachAllocations(batch, reservation.allocations);
    }

    let lastPublish = 0;
    while (batches.some((batch) => !batch.done)) {
        if (!controllerStillStandby(ns)) { cancelAll(ns, batches); return failed(template.hostname, wave, hackFraction, stageGapMs, "Controller left STANDBY during wave", "ABORTED"); }
        const now = Date.now(); drainTimingEvents(ns, batches);
        for (const batch of batches) for (const stage of batch.stages) {
            if (stage.launched || now < stage.startAt - DISPATCH_LEAD_MS) continue;
            const launched = launchStage(ns, batch, stage);
            if (!launched.ok) { cancelAll(ns, batches); return failed(template.hostname, wave, hackFraction, stageGapMs, `${batch.id} ${stage.name}: ${launched.reason}`); }
        }
        for (const batch of batches) {
            if (batch.done) continue;
            const launched = batch.stages.every((stage) => stage.launched), running = batch.stages.some((stage) => stage.jobs.some((job) => ns.isRunning(job.pid, job.hostname)));
            if (launched && !running && now >= batch.finalLandingAt - COMPLETE_GRACE_MS) batch.done = true;
        }
        if (now - lastPublish >= 250) {
            lastPublish = now;
            await publishOverlapValidationState(ns, { ...base, target: template.hostname, requestedWaves, status: "RUNNING", reason: `Wave ${wave} active`, currentWave: wave, cleanWaves: clean, batchIntervalMs: intervalMs, inFlight: batches.map(publicBatch), live: liveMetrics(batches) });
        }
        await ns.sleep(LOOP_MS);
    }
    drainTimingEvents(ns, batches);
    return evaluateWave(ns, template.hostname, batches, wave, hackFraction, stageGapMs, intervalMs);
}

function publicBatch(batch) { return { id: batch.id, firstLandingAt: batch.firstLandingAt, finalLandingAt: batch.finalLandingAt, done: batch.done, stages: batch.stages.map((s) => ({ name: s.name, landingAt: s.landingAt, launched: s.launched, jobs: s.jobs.length, events: s.events.length, actualLandingAt: latestEvent(s.events) })) }; }
function liveMetrics(batches) { const stages = batches.flatMap((b) => b.stages); return { launchedStages: stages.filter((s) => s.launched).length, completedStages: stages.filter((s) => s.events.length > 0).length, expectedStages: stages.length, expectedJobs: stages.reduce((n, s) => n + s.allocations.length, 0), reportedJobs: stages.reduce((n, s) => n + s.events.length, 0) }; }
function latestEvent(events) { return Math.max(0, ...events.map((e) => Number(e.finishedAt ?? 0))); }

function evaluateWave(ns, target, batches, wave, hackFraction, stageGapMs, intervalMs) {
    const summaries = batches.map(summarizeBatch);
    const events = summaries.flatMap((summary, batchIndex) => summary.stages.map((stage, stageIndex) => ({ batchIndex, stageIndex, actualLandingAt: stage.actualLandingAt }))).sort((a, b) => a.actualLandingAt - b.actualLandingAt);
    const expected = []; for (let b = 0; b < DEPTH; b += 1) for (let s = 0; s < 4; s += 1) expected.push(`${b}:${s}`);
    const actual = events.map((e) => `${e.batchIndex}:${e.stageIndex}`), globalOrderCorrect = expected.every((key, i) => actual[i] === key);
    let globalSpacing = Infinity; for (let i = 1; i < events.length; i += 1) globalSpacing = Math.min(globalSpacing, events[i].actualLandingAt - events[i - 1].actualLandingAt);
    const missingJobs = summaries.reduce((sum, s) => sum + s.missingJobs, 0), maxDrift = Math.max(...summaries.map((s) => s.maxAbsLandingErrorMs));
    const minimumSpacingMs = Math.min(Number.isFinite(globalSpacing) ? globalSpacing : 0, ...summaries.map((s) => s.minimumSpacingMs));
    const maxMoney = ns.getServerMaxMoney(target), moneyRatio = maxMoney > 0 ? ns.getServerMoneyAvailable(target) / maxMoney : 0, secDelta = Math.max(0, ns.getServerSecurityLevel(target) - ns.getServerMinSecurityLevel(target));
    let reason = "two complete HWGW landing streams preserved order and recovery", healthy = true;
    if (missingJobs > 0) [healthy, reason] = [false, `${missingJobs} timing job(s) missing`];
    else if (!summaries.every((s) => s.orderCorrect)) [healthy, reason] = [false, "within-batch landing order incorrect"];
    else if (!globalOrderCorrect) [healthy, reason] = [false, "adjacent batch landing streams crossed"];
    else if (maxDrift > MAX_LANDING_ERROR_MS) [healthy, reason] = [false, `landing drift ${maxDrift.toFixed(0)}ms exceeds ${MAX_LANDING_ERROR_MS}ms`];
    else if (minimumSpacingMs < MIN_SPACING_MS) [healthy, reason] = [false, `minimum spacing ${minimumSpacingMs.toFixed(0)}ms below ${MIN_SPACING_MS}ms`];
    else if (moneyRatio < MONEY_TOLERANCE) [healthy, reason] = [false, `final money recovered to ${(moneyRatio * 100).toFixed(2)}%`];
    else if (secDelta > SECURITY_TOLERANCE) [healthy, reason] = [false, `final security recovered only to +${secDelta.toFixed(3)}`];
    return { target, runId: `overlap-${Date.now().toString(36)}-${wave}`, status: healthy ? "CLEAN" : "FAILED", healthy, reason, depth: DEPTH, hackFraction, stageGapMs, batchIntervalMs: intervalMs, missingJobs, globalOrderCorrect, maxAbsLandingErrorMs: maxDrift, minimumSpacingMs, finalMoneyRatio: moneyRatio, finalSecurityDelta: secDelta };
}

function summarizeBatch(batch) {
    const stages = batch.stages.map((stage) => { const events = [...stage.events].sort((a, b) => Number(a.finishedAt ?? 0) - Number(b.finishedAt ?? 0)); const actualLandingAt = events.length ? Number(events.at(-1).finishedAt ?? 0) : 0; return { name: stage.name, actualLandingAt, landingErrorMs: actualLandingAt ? actualLandingAt - stage.landingAt : Infinity, missingJobs: Math.max(0, stage.allocations.length - events.length) }; });
    const actualOrder = [...stages].sort((a, b) => a.actualLandingAt - b.actualLandingAt).map((s) => s.name), expectedOrder = ["HACK", "WEAKEN_HACK", "GROW", "WEAKEN_GROW"];
    const orderCorrect = stages.every((s) => s.actualLandingAt > 0) && expectedOrder.every((name, i) => actualOrder[i] === name); const times = stages.map((s) => s.actualLandingAt).filter((t) => t > 0).sort((a, b) => a - b);
    let spacing = Infinity; for (let i = 1; i < times.length; i += 1) spacing = Math.min(spacing, times[i] - times[i - 1]);
    return { stages, orderCorrect, missingJobs: stages.reduce((sum, s) => sum + s.missingJobs, 0), maxAbsLandingErrorMs: Math.max(...stages.map((s) => Math.abs(s.landingErrorMs))), minimumSpacingMs: Number.isFinite(spacing) ? spacing : 0 };
}

function chooseTarget(ns, planner, history, evidence, requestedTarget, hackFraction, stageGapMs, allowUnqualified) {
    const candidates = (Array.isArray(planner?.rankings) ? planner.rankings : []).map((entry) => ({ entry, hostname: entry.hostname, template: buildPreparedBatchTemplate(ns, entry, hackFraction, stageGapMs), policy: targetOverlapPolicy(history, entry.hostname, evidence) }));
    if (requestedTarget && requestedTarget.toLowerCase() !== "auto") {
        const found = candidates.find((c) => c.hostname === requestedTarget);
        if (!found) return { ok: false, reason: `${requestedTarget} is not an eligible planner target` };
        if (!found.template.ok || !found.template.preparedNow) return { ok: false, reason: `${requestedTarget} is not prepared` };
        if (!allowUnqualified && !found.policy.eligibleForValidation) return { ok: false, reason: `${requestedTarget} is not depth-2 validation eligible: ${found.policy.reason}` };
        return { ok: true, ...found };
    }
    const found = candidates.find((c) => c.template.ok && c.template.preparedNow && c.policy.eligibleForValidation && c.policy.provenDepth < 2);
    return found ? { ok: true, ...found } : { ok: false, reason: "No prepared, pipeline-qualified target still needs dedicated depth-2 proof" };
}
function preflightCheck(ns) {
    if (ns.getHostname() !== "home") return { ok: false, reason: "Run validator from home" };
    const controller = readControllerState(ns); if (!controller) return { ok: false, reason: "Controller state unavailable" }; const mode = String(controller.executionMode?.mode ?? "STANDBY").toUpperCase(), pending = String(controller.executionMode?.pending ?? "");
    if (mode !== "STANDBY" || pending) return { ok: false, reason: `Controller must be fully STANDBY; current ${pending ? `${mode} -> ${pending}` : mode}` }; if (Number(controller.execution?.activeJobs ?? 0) > 0) return { ok: false, reason: "Controller still has active standalone workers" };
    for (const script of ["/hacking/pipeline-runner.js", "/hacking/multi-target-runner.js", "/hacking/automulti-controller.js"]) if (ns.scriptRunning(script, "home")) return { ok: false, reason: `${script} is active on home` };
    const planner = readPlannerState(ns); for (const host of Array.isArray(planner?.executionHosts) ? planner.executionHosts : []) { const hostname = String(host?.hostname ?? ""); if (!hostname) continue; try { if (ns.scriptRunning("/hacking/batch-runner.js", hostname)) return { ok: false, reason: `batch-runner.js is active on ${hostname}` }; } catch {} } return { ok: true };
}
function controllerStillStandby(ns) { const c = readControllerState(ns); return Boolean(c && String(c.executionMode?.mode ?? "").toUpperCase() === "STANDBY" && !String(c.executionMode?.pending ?? "")); }
function isPrepared(ns, target) { const max = ns.getServerMaxMoney(target); return max > 0 && ns.getServerMoneyAvailable(target) / max >= MONEY_TOLERANCE && ns.getServerSecurityLevel(target) - ns.getServerMinSecurityLevel(target) <= SECURITY_TOLERANCE; }
function attachAllocations(batch, allocations) { for (const stage of batch.stages) { stage.script = stage.name === "HACK" ? WORKER_SCRIPTS.HACK : stage.name === "GROW" ? WORKER_SCRIPTS.GROW : WORKER_SCRIPTS.WEAKEN; stage.allocations = allocations.filter((a) => a.stage === stage.name); stage.jobs = []; stage.events = []; stage.launched = false; } batch.done = false; }
function launchStage(ns, batch, stage) { const additionalMsec = Math.max(0, Math.floor(stage.landingAt - Date.now() - stage.durationMs)); for (const a of stage.allocations) { const jobId = `${batch.id}-${stage.name}-${a.hostname}`; const pid = ns.exec(stage.script, a.hostname, a.threads, batch.target, jobId, a.threads, additionalMsec, batch.id, stage.name, stage.landingAt); if (pid <= 0) return { ok: false, reason: `ns.exec failed on ${a.hostname}` }; stage.jobs.push({ pid, hostname: a.hostname }); } stage.launched = true; return { ok: true }; }
function drainTimingEvents(ns, batches) { const byId = new Map(batches.map((b) => [b.id, b])), port = ns.getPortHandle(RuntimePort.BATCH_TIMING_EVENTS); while (!port.empty()) try { const event = JSON.parse(String(port.read())); if (event?.type !== "BATCH_STAGE_COMPLETE") continue; const batch = byId.get(String(event.batchId ?? "")), stage = batch?.stages.find((s) => s.name === String(event.stage ?? "")); if (stage) stage.events.push(event); } catch {} }
function cancelAll(ns, batches) { for (const b of batches) for (const s of b.stages) for (const job of s.jobs ?? []) try { ns.kill(job.pid, job.hostname); } catch {} }
async function stopEarly(ns, base, status, reason) { await publishOverlapValidationState(ns, { ...base, status, reason, inFlight: [] }); if (!isQuiet(ns)) ns.tprint(`[OVERLAP-VALIDATE] ${status}: ${reason}`); }
function failed(target, wave, hackFraction, stageGapMs, reason, status = "FAILED") { return { target, runId: `overlap-${Date.now().toString(36)}-${wave}`, status, healthy: false, reason, depth: DEPTH, hackFraction, stageGapMs, maxAbsLandingErrorMs: 0, minimumSpacingMs: 0 }; }
function clamp(value, min, max) { return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min; }
function clampInt(value, min, max) { return Math.floor(clamp(value, min, max)); }
function fmt(value) { return `${Number(value ?? 0).toFixed(0)}ms`; }
