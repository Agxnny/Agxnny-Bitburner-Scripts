import { WORKER_SCRIPTS, getExecutionPool } from "/lib/execution.js";
import { buildPreparedBatchTemplate, commitReservation, createHostCalendar, makeBatch, tryReserve } from "/lib/batch-allocation.js";
import { recordOverlapWave } from "/lib/multi-overlap-evidence.js";
import { publishOverlapValidationState } from "/lib/overlap-validation-state.js";
import { RuntimePort, readControllerState, readPlannerState } from "/lib/runtime-state.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const DISPATCH_LEAD_MS = 100, LOOP_MS = 20, COMPLETE_GRACE_MS = 2_000;
const MONEY_TOLERANCE = 0.995, SECURITY_TOLERANCE = 0.05, MAX_DRIFT_MS = 150, MIN_SPACING_MS = 75;

/** Real configurable same-target validator. Conservative streams are serialized by batch landing order. @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const quiet = isQuiet(ns), args = positionalArgs(ns);
    const target = String(args[0] ?? "").trim();
    const depth = clampInt(Number(args[1] ?? 2), 2, 32);
    const waves = clampInt(Number(args[2] ?? 2), 1, 6);
    const hackFraction = clamp(Number(args[3] ?? 0.10), 0.001, 0.50);
    const stageGapMs = clampInt(Number(args[4] ?? 200), 75, 1000);
    const base = { pid: ns.pid, target, requestedTarget: target, depth, requestedWaves: waves, hackFraction, stageGapMs, startedAt: Date.now(), validatorModel: "MULTI_DEPTH_VALIDATE_V1" };
    const preflight = preflightCheck(ns, target);
    if (!preflight.ok) return stop(ns, base, "BLOCKED", preflight.reason, quiet);
    if (!quiet) ns.tprint(`[DEPTH-VALIDATE] ${target} · depth ${depth} · ${waves} waves · hack ${(hackFraction * 100).toFixed(1)}% · gap ${stageGapMs}ms`);
    ns.getPortHandle(RuntimePort.BATCH_TIMING_EVENTS).clear();
    let clean = 0;
    for (let wave = 1; wave <= waves; wave += 1) {
        if (!standby(ns)) return stop(ns, { ...base, currentWave: wave, cleanWaves: clean }, "ABORTED", "Controller left STANDBY", quiet);
        if (!prepared(ns, target)) return stop(ns, { ...base, currentWave: wave, cleanWaves: clean }, "BLOCKED", `${target} is no longer prepared`, quiet);
        const result = await runWave(ns, base, wave, clean);
        await recordOverlapWave(ns, result);
        if (!quiet) ns.tprint(`[DEPTH-VALIDATE] depth ${depth} wave ${wave}/${waves} ${result.healthy ? "CLEAN" : "FAILED"} · spacing ${fmt(result.minimumSpacingMs)} · drift ${fmt(result.maxAbsLandingErrorMs)} · ${result.reason}`);
        if (!result.healthy) return publishOverlapValidationState(ns, { ...base, status: result.status, reason: result.reason, currentWave: wave, cleanWaves: clean, lastResult: result, inFlight: [] });
        clean += 1;
        await publishOverlapValidationState(ns, { ...base, status: wave < waves ? "BETWEEN_WAVES" : "COMPLETE", reason: result.reason, currentWave: wave, cleanWaves: clean, lastResult: result, inFlight: [] });
    }
    if (!quiet) ns.tprint(`[DEPTH-VALIDATE] COMPLETE · ${target} depth ${depth} · ${clean}/${waves} clean`);
}

async function runWave(ns, base, wave, clean) {
    const planner = readPlannerState(ns), entry = (planner?.rankings ?? []).find((r) => r.hostname === base.target);
    if (!entry) return failed(base, wave, "Target missing from planner");
    const template = buildPreparedBatchTemplate(ns, entry, base.hackFraction, base.stageGapMs, { dispatchLeadMs: DISPATCH_LEAD_MS });
    if (!template.ok || !template.preparedNow) return failed(base, wave, template.reason || "Target is not prepared");
    const pool = getExecutionPool(ns, planner);
    if (!pool.length) return failed(base, wave, "No remote production RAM available", "BLOCKED");
    const hosts = createHostCalendar(pool, [], Date.now());
    const intervalMs = base.stageGapMs * 4, firstLandingAt = Date.now() + template.firstLandingDelayMs;
    const batches = Array.from({ length: base.depth }, (_, i) => {
        const batch = makeBatch(template, firstLandingAt + i * intervalMs, i + 1);
        batch.id = `depth-${base.depth}-${Date.now().toString(36)}-${ns.pid}-w${wave}-b${i + 1}`;
        return batch;
    });
    for (const batch of batches) {
        const reservation = tryReserve(hosts, batch);
        if (!reservation.ok) return failed(base, wave, `RAM ceiling reached while reserving batch ${batch.sequence ?? "?"}`, "BLOCKED");
        commitReservation(hosts, reservation); attach(batch, reservation.allocations);
    }
    let lastPublish = 0;
    while (batches.some((b) => !b.done)) {
        if (!standby(ns)) { cancel(ns, batches); return failed(base, wave, "Controller left STANDBY during wave", "ABORTED"); }
        const now = Date.now(); drain(ns, batches);
        for (const batch of batches) for (const stage of batch.stages) {
            if (stage.launched || now < stage.startAt - DISPATCH_LEAD_MS) continue;
            const launched = launch(ns, batch, stage);
            if (!launched.ok) { cancel(ns, batches); return failed(base, wave, `${batch.id} ${stage.name}: ${launched.reason}`); }
        }
        for (const batch of batches) {
            if (batch.done) continue;
            const launched = batch.stages.every((s) => s.launched), running = batch.stages.some((s) => s.jobs.some((j) => ns.isRunning(j.pid, j.hostname)));
            if (launched && !running && now >= batch.finalLandingAt - COMPLETE_GRACE_MS) batch.done = true;
        }
        if (now - lastPublish >= 250) {
            lastPublish = now;
            await publishOverlapValidationState(ns, { ...base, status: "RUNNING", reason: `Depth ${base.depth} · wave ${wave} active`, currentWave: wave, cleanWaves: clean, batchIntervalMs: intervalMs, inFlight: batches.map(publicBatch), live: liveMetrics(batches) });
        }
        await ns.sleep(LOOP_MS);
    }
    drain(ns, batches);
    return evaluate(ns, base, wave, batches, intervalMs);
}

function evaluate(ns, base, wave, batches, intervalMs) {
    const summaries = batches.map(summarize), events = [];
    summaries.forEach((summary, bi) => summary.stages.forEach((stage, si) => events.push({ bi, si, at: stage.actualLandingAt })));
    events.sort((a, b) => a.at - b.at);
    const expected = []; for (let b = 0; b < base.depth; b += 1) for (let s = 0; s < 4; s += 1) expected.push(`${b}:${s}`);
    const actual = events.map((e) => `${e.bi}:${e.si}`), globalOrderCorrect = expected.every((key, i) => actual[i] === key);
    let spacing = Infinity; for (let i = 1; i < events.length; i += 1) spacing = Math.min(spacing, events[i].at - events[i - 1].at);
    const missingJobs = summaries.reduce((n, s) => n + s.missingJobs, 0);
    const maxDrift = Math.max(...summaries.map((s) => s.maxAbsLandingErrorMs));
    const minimumSpacingMs = Math.min(Number.isFinite(spacing) ? spacing : 0, ...summaries.map((s) => s.minimumSpacingMs));
    const maxMoney = ns.getServerMaxMoney(base.target), moneyRatio = maxMoney > 0 ? ns.getServerMoneyAvailable(base.target) / maxMoney : 0;
    const secDelta = Math.max(0, ns.getServerSecurityLevel(base.target) - ns.getServerMinSecurityLevel(base.target));
    let healthy = true, reason = `${base.depth} complete HWGW streams preserved order and final recovery`;
    if (missingJobs) [healthy, reason] = [false, `${missingJobs} timing job(s) missing`];
    else if (!summaries.every((s) => s.orderCorrect)) [healthy, reason] = [false, "within-batch landing order incorrect"];
    else if (!globalOrderCorrect) [healthy, reason] = [false, "batch landing streams crossed"];
    else if (maxDrift > MAX_DRIFT_MS) [healthy, reason] = [false, `landing drift ${maxDrift.toFixed(0)}ms exceeds ${MAX_DRIFT_MS}ms`];
    else if (minimumSpacingMs < MIN_SPACING_MS) [healthy, reason] = [false, `minimum spacing ${minimumSpacingMs.toFixed(0)}ms below ${MIN_SPACING_MS}ms`];
    else if (moneyRatio < MONEY_TOLERANCE) [healthy, reason] = [false, `final money recovered to ${(moneyRatio * 100).toFixed(2)}%`];
    else if (secDelta > SECURITY_TOLERANCE) [healthy, reason] = [false, `final security recovered only to +${secDelta.toFixed(3)}`];
    return { target: base.target, runId: `depth-${base.depth}-${Date.now().toString(36)}-${wave}`, status: healthy ? "CLEAN" : "FAILED", healthy, reason, depth: base.depth, hackFraction: base.hackFraction, stageGapMs: base.stageGapMs, batchIntervalMs: intervalMs, missingJobs, globalOrderCorrect, maxAbsLandingErrorMs: maxDrift, minimumSpacingMs, finalMoneyRatio: moneyRatio, finalSecurityDelta: secDelta };
}

function summarize(batch) {
    const stages = batch.stages.map((stage) => { const at = latest(stage.events); return { name: stage.name, actualLandingAt: at, landingErrorMs: at ? at - stage.landingAt : Infinity, missingJobs: Math.max(0, stage.allocations.length - stage.events.length) }; });
    const expected = ["HACK", "WEAKEN_HACK", "GROW", "WEAKEN_GROW"], order = [...stages].sort((a, b) => a.actualLandingAt - b.actualLandingAt).map((s) => s.name);
    const times = stages.map((s) => s.actualLandingAt).filter((n) => n > 0).sort((a, b) => a - b); let spacing = Infinity;
    for (let i = 1; i < times.length; i += 1) spacing = Math.min(spacing, times[i] - times[i - 1]);
    return { stages, orderCorrect: stages.every((s) => s.actualLandingAt > 0) && expected.every((name, i) => order[i] === name), missingJobs: stages.reduce((n, s) => n + s.missingJobs, 0), maxAbsLandingErrorMs: Math.max(...stages.map((s) => Math.abs(s.landingErrorMs))), minimumSpacingMs: Number.isFinite(spacing) ? spacing : 0 };
}
function attach(batch, allocations) { for (const stage of batch.stages) { stage.script = stage.name === "HACK" ? WORKER_SCRIPTS.HACK : stage.name === "GROW" ? WORKER_SCRIPTS.GROW : WORKER_SCRIPTS.WEAKEN; stage.allocations = allocations.filter((a) => a.stage === stage.name); stage.jobs = []; stage.events = []; stage.launched = false; } batch.done = false; }
function launch(ns, batch, stage) { const delay = Math.max(0, Math.floor(stage.landingAt - Date.now() - stage.durationMs)); for (const a of stage.allocations) { const id = `${batch.id}-${stage.name}-${a.hostname}`; const pid = ns.exec(stage.script, a.hostname, a.threads, batch.target, id, a.threads, delay, batch.id, stage.name, stage.landingAt); if (pid <= 0) return { ok: false, reason: `ns.exec failed on ${a.hostname}` }; stage.jobs.push({ pid, hostname: a.hostname }); } stage.launched = true; return { ok: true }; }
function drain(ns, batches) { const byId = new Map(batches.map((b) => [b.id, b])), port = ns.getPortHandle(RuntimePort.BATCH_TIMING_EVENTS); while (!port.empty()) try { const e = JSON.parse(String(port.read())); if (e?.type !== "BATCH_STAGE_COMPLETE") continue; const b = byId.get(String(e.batchId ?? "")), s = b?.stages.find((x) => x.name === String(e.stage ?? "")); if (s) s.events.push(e); } catch {} }
function publicBatch(b) { return { id: b.id, firstLandingAt: b.firstLandingAt, finalLandingAt: b.finalLandingAt, done: b.done, stages: b.stages.map((s) => ({ name: s.name, landingAt: s.landingAt, launched: s.launched, jobs: s.jobs.length, events: s.events.length, actualLandingAt: latest(s.events) })) }; }
function liveMetrics(batches) { const stages = batches.flatMap((b) => b.stages); return { launchedStages: stages.filter((s) => s.launched).length, completedStages: stages.filter((s) => s.events.length > 0).length, expectedStages: stages.length, expectedJobs: stages.reduce((n, s) => n + s.allocations.length, 0), reportedJobs: stages.reduce((n, s) => n + s.events.length, 0) }; }
function latest(events) { return Math.max(0, ...events.map((e) => Number(e.finishedAt ?? 0))); }
function cancel(ns, batches) { for (const b of batches) for (const s of b.stages) for (const j of s.jobs ?? []) try { ns.kill(j.pid, j.hostname); } catch {} }
function failed(base, wave, reason, status = "FAILED") { return { target: base.target, runId: `depth-${base.depth}-${Date.now().toString(36)}-${wave}`, status, healthy: false, reason, depth: base.depth, hackFraction: base.hackFraction, stageGapMs: base.stageGapMs, maxAbsLandingErrorMs: 0, minimumSpacingMs: 0 }; }
function preflightCheck(ns, target) { if (ns.getHostname() !== "home") return { ok: false, reason: "Run from home" }; if (!target) return { ok: false, reason: "Select a target" }; if (!standby(ns)) return { ok: false, reason: "Controller must be fully STANDBY" }; const planner = readPlannerState(ns); const entry = (planner?.rankings ?? []).find((r) => r.hostname === target); if (!entry) return { ok: false, reason: `${target} is not an eligible planner target` }; if (!prepared(ns, target)) return { ok: false, reason: `${target} is not prepared` }; for (const script of ["/hacking/pipeline-runner.js", "/hacking/multi-target-runner.js", "/hacking/automulti-controller.js"]) if (ns.scriptRunning(script, "home")) return { ok: false, reason: `${script} is active` }; return { ok: true }; }
function standby(ns) { const c = readControllerState(ns); return Boolean(c && String(c.executionMode?.mode ?? "").toUpperCase() === "STANDBY" && !String(c.executionMode?.pending ?? "") && Number(c.execution?.activeJobs ?? 0) === 0); }
function prepared(ns, target) { const max = ns.getServerMaxMoney(target); return max > 0 && ns.getServerMoneyAvailable(target) / max >= MONEY_TOLERANCE && ns.getServerSecurityLevel(target) - ns.getServerMinSecurityLevel(target) <= SECURITY_TOLERANCE; }
async function stop(ns, base, status, reason, quiet) { await publishOverlapValidationState(ns, { ...base, status, reason, inFlight: [] }); if (!quiet) ns.tprint(`[DEPTH-VALIDATE] ${status}: ${reason}`); }
function clamp(v, min, max) { return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min; }
function clampInt(v, min, max) { return Math.floor(clamp(v, min, max)); }
function fmt(v) { return `${Number(v ?? 0).toFixed(0)}ms`; }
