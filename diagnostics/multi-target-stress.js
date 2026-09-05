import {
    publishMultiTargetStressState,
    readControllerState,
    readMultiTargetSchedulerState,
} from "/lib/runtime-state.js";
import { recordStressEvidence } from "/lib/multi-stress-evidence.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const RUNNER = "/hacking/multi-target-runner.js";
const MODEL = "MULTI_TARGET_STRESS_V1";
const PROFILES = Object.freeze(["money", "balanced", "xp"]);
const POLL_MS = 250;
const PREP_RETRY_MS = 10_000;

/**
 * Progressive real multi-target stress test.
 *
 * Runs conservative finite waves sequentially while increasing distinct-target
 * concurrency. A depth must complete every requested wave cleanly before the
 * test advances to the next depth. In mixed mode the profile rotates through
 * MONEY, BALANCED, and XP to exercise a broader target set.
 *
 * The test never overlaps two multi-target coordinators, never runs unless the
 * production controller is fully parked in STANDBY, and stops escalating on
 * the first safety failure. BLOCKED waves are retried while the dedicated
 * prepper catches up, up to the configured prep-wait limit.
 *
 * Usage:
 *   run diagnostics/multi-target-stress.js [mixed|money|balanced|xp] [maxDepth] [wavesPerDepth] [targetCount] [hackFraction] [stageGapMs] [prepWaitMinutes]
 *
 * Defaults:
 *   mixed 8 2 12 0.10 200 10
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    const quiet = isQuiet(ns);
    const parsed = parseArgs(positionalArgs(ns));
    if (!parsed.ok) {
        ns.tprint(`[MULTI-STRESS] BLOCKED: ${parsed.reason}`);
        ns.tprint("[MULTI-STRESS] Usage: run diagnostics/multi-target-stress.js [mixed|money|balanced|xp] [maxDepth 2-12] [wavesPerDepth 1-10] [targetCount 2-12] [hackFraction 0.001-0.90] [stageGapMs 75-5000] [prepWaitMinutes 0-60]");
        return;
    }

    if (ns.getHostname() !== "home") {
        ns.tprint("[MULTI-STRESS] BLOCKED: run this test from home");
        return;
    }

    const preflight = stressPreflight(ns);
    if (!preflight.ok) {
        publish(ns, parsed.value, "BLOCKED", preflight.reason, createProgress());
        ns.tprint(`[MULTI-STRESS] BLOCKED: ${preflight.reason}`);
        return;
    }

    const cfg = parsed.value;
    const progress = createProgress();
    const startedAt = Date.now();
    progress.startedAt = startedAt;
    publish(ns, cfg, "RUNNING", "Starting progressive multi-target stress test", progress);

    if (!quiet) {
        ns.tprint("=== MULTI-TARGET STRESS TEST ===");
        ns.tprint(`[MULTI-STRESS] ${cfg.profileMode.toUpperCase()} | depth 2→${cfg.maxDepth} | ${cfg.wavesPerDepth} wave(s)/depth | top ${cfg.targetCount}`);
        ns.tprint(`[MULTI-STRESS] hack ${(cfg.hackFraction * 100).toFixed(1)}% | gap ${cfg.stageGapMs}ms | prep wait ${cfg.prepWaitMinutes}m`);
    }

    let resultStatus = "PASS";
    let resultReason = `Clean through depth ${progress.highestCleanDepth}`;
    let totalWaveIndex = 0;

    outer:
    for (let depth = 2; depth <= cfg.maxDepth; depth += 1) {
        progress.currentDepth = depth;
        progress.depthCleanWaves = 0;

        for (let wave = 1; wave <= cfg.wavesPerDepth; wave += 1) {
            progress.currentWave = wave;
            const profile = chooseProfile(cfg.profileMode, totalWaveIndex++);
            progress.currentProfile = profile;
            const prepDeadline = Date.now() + cfg.prepWaitMinutes * 60_000;
            let blockedAttempts = 0;

            while (true) {
                const controller = readControllerState(ns);
                const mode = String(controller?.executionMode?.mode ?? "").toUpperCase();
                const pending = String(controller?.executionMode?.pending ?? "").trim();
                if (!controller || mode !== "STANDBY" || pending) {
                    resultStatus = "ABORTED";
                    resultReason = `Controller left STANDBY before depth ${depth} wave ${wave}`;
                    break outer;
                }

                const launchAt = Date.now();
                const pid = ns.run(RUNNER, 1, profile, cfg.targetCount, cfg.hackFraction, cfg.stageGapMs, depth, "--quiet");
                if (pid <= 0) {
                    resultStatus = "BLOCKED";
                    resultReason = "Could not launch multi-target runner on home";
                    break outer;
                }

                progress.runnerPid = pid;
                progress.waveStatus = "RUNNING";
                progress.reason = `Depth ${depth} wave ${wave}/${cfg.wavesPerDepth} · ${profile.toUpperCase()} · PID ${pid}`;
                publish(ns, cfg, "RUNNING", progress.reason, progress);
                if (!quiet) ns.tprint(`[MULTI-STRESS] START depth ${depth} · wave ${wave}/${cfg.wavesPerDepth} · ${profile.toUpperCase()} · PID ${pid}`);

                let stopAfterWave = false;
                while (ns.isRunning(pid, "home")) {
                    const liveController = readControllerState(ns);
                    const liveMode = String(liveController?.executionMode?.mode ?? "").toUpperCase();
                    const livePending = String(liveController?.executionMode?.pending ?? "").trim();
                    if (!liveController || liveMode !== "STANDBY" || livePending) stopAfterWave = true;
                    publish(ns, cfg, "RUNNING", progress.reason, progress);
                    await ns.sleep(POLL_MS);
                }

                progress.runnerPid = 0;
                const state = readMultiTargetSchedulerState(ns);
                const fresh = Number(state?.updatedAt ?? 0) >= launchAt - 1000;
                const status = fresh ? String(state?.status ?? "UNKNOWN") : "MISSING_STATE";

                if (stopAfterWave) {
                    resultStatus = "ABORTED";
                    resultReason = `Controller mode changed while depth ${depth} wave ${wave} was draining`;
                    break outer;
                }

                if (status === "BLOCKED") {
                    blockedAttempts += 1;
                    progress.blockedRetries += 1;
                    progress.waveStatus = "WAITING_PREP";
                    progress.reason = String(state?.reason ?? "Wave blocked; waiting for prep/capacity");
                    publish(ns, cfg, "WAITING_PREP", progress.reason, progress);
                    if (!quiet) ns.tprint(`[MULTI-STRESS] WAIT depth ${depth} · ${progress.reason}`);
                    if (cfg.prepWaitMinutes <= 0 || Date.now() >= prepDeadline) {
                        resultStatus = "BLOCKED_TIMEOUT";
                        resultReason = `Depth ${depth} could not start after ${blockedAttempts} blocked attempt(s): ${progress.reason}`;
                        break outer;
                    }
                    await ns.sleep(PREP_RETRY_MS);
                    continue;
                }

                const waveResult = summarizeWave(state, depth, wave, profile, blockedAttempts);
                progress.results.push(waveResult);
                while (progress.results.length > 24) progress.results.shift();
                for (const target of waveResult.targets) progress.uniqueTargets.add(target);
                progress.maxObservedDriftMs = Math.max(progress.maxObservedDriftMs, waveResult.maxDriftMs);
                if (waveResult.minSpacingMs > 0) progress.minObservedSpacingMs = progress.minObservedSpacingMs > 0 ? Math.min(progress.minObservedSpacingMs, waveResult.minSpacingMs) : waveResult.minSpacingMs;

                if (!waveResult.clean) {
                    resultStatus = status === "SAFETY_STOP" ? "SAFETY_STOP" : "FAILED";
                    resultReason = `Depth ${depth} wave ${wave} failed: ${waveResult.reason}`;
                    break outer;
                }

                progress.totalCleanWaves += 1;
                progress.depthCleanWaves += 1;
                progress.waveStatus = "CLEAN";
                progress.reason = `Depth ${depth} wave ${wave}/${cfg.wavesPerDepth} clean across ${waveResult.targets.length} target(s)`;
                publish(ns, cfg, "RUNNING", progress.reason, progress);
                if (!quiet) ns.tprint(`[MULTI-STRESS] CLEAN depth ${depth} · ${profile.toUpperCase()} · targets ${waveResult.targets.join(", ")} · drift ${waveResult.maxDriftMs.toFixed(0)}ms · spacing ${waveResult.minSpacingMs.toFixed(0)}ms`);
                break;
            }
        }

        if (progress.depthCleanWaves === cfg.wavesPerDepth) {
            progress.highestCleanDepth = depth;
            progress.reason = `Depth ${depth} passed ${cfg.wavesPerDepth}/${cfg.wavesPerDepth} clean wave(s)`;
            publish(ns, cfg, "RUNNING", progress.reason, progress);
            if (!quiet) ns.tprint(`[MULTI-STRESS] DEPTH ${depth} PASSED`);
        }
    }

    progress.finishedAt = Date.now();
    if (resultStatus === "PASS") resultReason = `Stress test passed through depth ${progress.highestCleanDepth}`;
    progress.waveStatus = resultStatus;
    progress.reason = resultReason;
    const finalState = stressState(cfg, resultStatus, resultReason, progress);
    publishMultiTargetStressState(ns, finalState);
    const evidence = await recordStressEvidence(ns, finalState);

    ns.tprint(`[MULTI-STRESS] ${resultStatus} | highest clean depth ${progress.highestCleanDepth} | clean waves ${progress.totalCleanWaves} | unique targets ${progress.uniqueTargets.size}`);
    ns.tprint(`[MULTI-STRESS] drift max ${progress.maxObservedDriftMs.toFixed(0)}ms | spacing min ${progress.minObservedSpacingMs > 0 ? progress.minObservedSpacingMs.toFixed(0) : "—"}ms`);
    ns.tprint(`[MULTI-STRESS] evidence proven depth ${evidence.provenDepth} · ${evidence.uniqueTargets.length} unique target(s)`);
    ns.tprint(`[MULTI-STRESS] ${resultReason}`);
}

function parseArgs(args) {
    if (args.length > 7) return { ok: false, reason: `Too many positional arguments (${args.length})` };
    const profileMode = String(args[0] ?? "mixed").trim().toLowerCase();
    const maxDepth = optionalInteger(args[1], 8);
    const wavesPerDepth = optionalInteger(args[2], 2);
    const targetCount = optionalInteger(args[3], 12);
    const hackFraction = optionalNumber(args[4], 0.10);
    const stageGapMs = optionalInteger(args[5], 200);
    const prepWaitMinutes = optionalNumber(args[6], 10);
    if (!["mixed", ...PROFILES].includes(profileMode)) return { ok: false, reason: "profile must be mixed, money, balanced, or xp" };
    if (!Number.isInteger(maxDepth) || maxDepth < 2 || maxDepth > 12) return { ok: false, reason: "maxDepth must be 2-12" };
    if (!Number.isInteger(wavesPerDepth) || wavesPerDepth < 1 || wavesPerDepth > 10) return { ok: false, reason: "wavesPerDepth must be 1-10" };
    if (!Number.isInteger(targetCount) || targetCount < 2 || targetCount > 12) return { ok: false, reason: "targetCount must be 2-12" };
    if (targetCount < maxDepth) return { ok: false, reason: "targetCount must be at least maxDepth" };
    if (!Number.isFinite(hackFraction) || hackFraction < 0.001 || hackFraction > 0.90) return { ok: false, reason: "hackFraction must be 0.001-0.90" };
    if (!Number.isInteger(stageGapMs) || stageGapMs < 75 || stageGapMs > 5000) return { ok: false, reason: "stageGapMs must be 75-5000" };
    if (!Number.isFinite(prepWaitMinutes) || prepWaitMinutes < 0 || prepWaitMinutes > 60) return { ok: false, reason: "prepWaitMinutes must be 0-60" };
    return { ok: true, value: { profileMode, maxDepth, wavesPerDepth, targetCount, hackFraction, stageGapMs, prepWaitMinutes } };
}

function stressPreflight(ns) {
    const controller = readControllerState(ns);
    if (!controller) return { ok: false, reason: "Controller state unavailable" };
    const mode = String(controller.executionMode?.mode ?? "").toUpperCase();
    const pending = String(controller.executionMode?.pending ?? "").trim();
    if (mode !== "STANDBY" || pending) return { ok: false, reason: `Controller must be fully STANDBY; current ${pending ? `${mode} -> ${pending}` : mode}` };
    if (Number(controller.execution?.activeJobs ?? 0) > 0) return { ok: false, reason: "Controller standalone workers are still active" };
    if (ns.scriptRunning(RUNNER, "home")) return { ok: false, reason: "A multi-target runner is already active" };
    return { ok: true, reason: "" };
}

function summarizeWave(state, depth, wave, profile, blockedAttempts) {
    const completed = Array.isArray(state?.completed) ? state.completed : [];
    const targets = Array.isArray(state?.admittedTargets) ? state.admittedTargets.map(String) : [];
    const maxDriftMs = completed.reduce((max, entry) => Math.max(max, Number(entry?.maxAbsLandingErrorMs ?? 0)), 0);
    const spacings = completed.map((entry) => Number(entry?.minimumSpacingMs ?? 0)).filter((value) => value > 0);
    const minSpacingMs = spacings.length ? Math.min(...spacings) : 0;
    const healthy = completed.length === depth && completed.every((entry) => entry?.healthy === true);
    const status = String(state?.status ?? "UNKNOWN");
    const clean = status === "COMPLETE" && healthy && targets.length === depth;
    return { at: Date.now(), depth, wave, profile, status, clean, reason: clean ? "clean" : String(state?.reason ?? `${status}; completed ${completed.length}/${depth}`), targets, completed: completed.length, maxDriftMs, minSpacingMs, blockedAttempts, runId: String(state?.runId ?? "") };
}

function createProgress() {
    return { startedAt: 0, finishedAt: 0, currentDepth: 2, currentWave: 0, currentProfile: "", runnerPid: 0, waveStatus: "IDLE", reason: "", highestCleanDepth: 1, depthCleanWaves: 0, totalCleanWaves: 0, blockedRetries: 0, maxObservedDriftMs: 0, minObservedSpacingMs: 0, uniqueTargets: new Set(), results: [] };
}

function stressState(cfg, status, reason, progress) {
    return { version: 1, model: MODEL, status, reason, config: cfg, startedAt: progress.startedAt, finishedAt: progress.finishedAt, currentDepth: progress.currentDepth, currentWave: progress.currentWave, currentProfile: progress.currentProfile, runnerPid: progress.runnerPid, waveStatus: progress.waveStatus, highestCleanDepth: progress.highestCleanDepth, depthCleanWaves: progress.depthCleanWaves, totalCleanWaves: progress.totalCleanWaves, blockedRetries: progress.blockedRetries, maxObservedDriftMs: progress.maxObservedDriftMs, minObservedSpacingMs: progress.minObservedSpacingMs, uniqueTargets: [...progress.uniqueTargets], results: progress.results, updatedAt: Date.now() };
}
function publish(ns, cfg, status, reason, progress) { publishMultiTargetStressState(ns, stressState(cfg, status, reason, progress)); }
function chooseProfile(mode, index) { return mode !== "mixed" ? mode : PROFILES[index % PROFILES.length]; }
function optionalNumber(value, fallback) { return value === undefined || value === null || String(value).trim() === "" ? fallback : Number(value); }
function optionalInteger(value, fallback) { const number = optionalNumber(value, fallback); return Number.isFinite(number) ? Math.floor(number) : NaN; }
