import { WORKER_SCRIPTS, getExecutionPool } from "/lib/execution.js";
import { publishBatchState, readPlannerState } from "/lib/runtime-state.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const DEFAULT_HACK_FRACTION = 0.10;
const DEFAULT_GAP_MS = 200;
const DEFAULT_MONEY_TARGET_PERCENT = 1;
const SECURITY_TOLERANCE = 0.05;
const MONEY_TOLERANCE = 0.995;
const START_LEAD_MS = 150;

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

    const launched = [];
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
        await ns.sleep(25);
    }

    const finishedAt = Date.now();
    const money = ns.getServerMoneyAvailable(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const security = ns.getServerSecurityLevel(target);
    const minSecurity = ns.getServerMinSecurityLevel(target);

    const complete = {
        ...plan.state,
        status: "COMPLETE",
        launchedJobs: launched.length,
        launchStartedAt,
        finishedAt,
        durationMs: finishedAt - launchStartedAt,
        final: {
            money,
            maxMoney,
            moneyPercent: maxMoney > 0 ? money / maxMoney : 0,
            security,
            minSecurity,
            securityDelta: Math.max(0, security - minSecurity),
        },
        updatedAt: finishedAt,
    };
    publishBatchState(ns, complete);

    if (!quiet) {
        ns.tprint(`[BATCH] COMPLETE ${target} | ${(complete.actualHackFraction * 100).toFixed(1)}% hack | gap ${gapMs}ms | ${launched.length} job(s)`);
        ns.tprint(`[BATCH] Final money ${(complete.final.moneyPercent * 100).toFixed(1)}% | security +${complete.final.securityDelta.toFixed(3)}`);
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
        version: 1,
        model: "SINGLE_HWGW_ADDITIONAL_MSEC_V1",
        batchId,
        target,
        plannerUpdatedAt: Number(planner?.updatedAt ?? 0),
        requestedHackFraction,
        moneyTargetPercent,
        gapMs,
        runnerHost: ns.getHostname(),
        status: "PLANNING",
        reason: "",
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
    // Do not pass target here. growthAnalyzeSecurity(threads, host, cores) caps
    // the result to the grow threads needed from the target's CURRENT money.
    // Batch planning happens while the target is prepared at max money, but the
    // GROW stage runs only after HACK has removed money. We therefore need the
    // uncapped per-thread security increase for every planned grow thread.
    const growSecurity = Math.max(0, ns.growthAnalyzeSecurity(growThreads));
    const weakenHackThreads = Math.max(1, Math.ceil(hackSecurity / weakenPerThread));
    const weakenGrowThreads = Math.max(1, Math.ceil(growSecurity / weakenPerThread));

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
    });

    const totalRam = allocationResult.stages.reduce((sum, stage) => sum + stage.ram, 0);
    return {
        ok: true,
        state: {
            ...baseState,
            status: "READY",
            reason: "Prepared target and full HWGW allocation fit the remote pool",
            actualHackFraction,
            threads: { hack: hackThreads, weakenHack: weakenHackThreads, grow: growThreads, weakenGrow: weakenGrowThreads },
            securityEffects: { hack: hackSecurity, grow: growSecurity },
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

    // Allocate largest RAM stages first so fragmentation is less likely to make a
    // theoretically fitting batch fail.
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

function clamp(value, minimum, maximum) {
    if (!Number.isFinite(value)) return minimum;
    return Math.min(maximum, Math.max(minimum, value));
}
