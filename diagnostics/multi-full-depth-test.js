import { readOverlapEvidence } from "/lib/multi-overlap-evidence.js";
import { readOverlapValidationState, publishOverlapValidationState } from "/lib/overlap-validation-state.js";
import { tuningDepthLadder } from "/lib/multi-target-tuning.js";
import { readControllerState } from "/lib/runtime-state.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const VALIDATOR = "/diagnostics/multi-depth-validate.js";
const SETTLE_MS = 250;

/** Climb every target-local depth until failure/resource ceiling, preserving evidence at every level. @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const quiet = isQuiet(ns), args = positionalArgs(ns);
    const target = String(args[0] ?? "").trim();
    const waves = clampInt(Number(args[1] ?? 2), 2, 6);
    const hackFraction = clamp(Number(args[2] ?? 0.10), 0.001, 0.50);
    const stageGapMs = clampInt(Number(args[3] ?? 200), 75, 1000);
    if (!target) return report(ns, quiet, "BLOCKED", "Select a target");
    if (!standby(ns)) return report(ns, quiet, "BLOCKED", "Controller must be fully STANDBY with no active jobs");
    if (ns.scriptRunning(VALIDATOR, "home")) return report(ns, quiet, "BLOCKED", "Depth validator is already running");

    const ladder = tuningDepthLadder();
    let proven = Number(readOverlapEvidence(ns)?.targets?.[target]?.provenDepth ?? 1);
    const startDepth = ladder.find((depth) => depth > proven) ?? ladder.at(-1);
    const depths = ladder.filter((depth) => depth >= startDepth);
    if (!quiet) ns.tprint(`[FULL-DEPTH] ${target} · starting above proven ${proven} · ${waves} waves/depth · ${(hackFraction * 100).toFixed(1)}% · ${stageGapMs}ms`);

    for (const depth of depths) {
        if (!standby(ns)) return finish(ns, quiet, target, proven, depth, "ABORTED", "Controller left STANDBY");
        await publishOverlapValidationState(ns, { pid: ns.pid, target, status: "DEPTH_CLIMB", reason: `Launching depth ${depth}; last proven ${proven}`, depth, provenDepth: proven, fullDepthTest: true, requestedWaves: waves, currentWave: 0, cleanWaves: 0, hackFraction, stageGapMs, startedAt: Date.now(), inFlight: [] });
        const pid = ns.run(VALIDATOR, 1, target, depth, waves, hackFraction, stageGapMs, "--quiet");
        if (pid <= 0) return finish(ns, quiet, target, proven, depth, "BLOCKED", "Unable to launch depth validator on home");
        while (ns.isRunning(pid, "home")) await ns.sleep(SETTLE_MS);
        await ns.sleep(SETTLE_MS);

        const evidence = readOverlapEvidence(ns), profile = evidence?.targets?.[target]?.depths?.[String(depth)];
        const state = readOverlapValidationState(ns);
        if (profile?.proven && profile?.latestHealthy !== false) {
            proven = Math.max(proven, depth);
            if (!quiet) ns.tprint(`[FULL-DEPTH] depth ${depth} PROVEN · ${profile.consecutiveClean} consecutive clean · spacing ${fmt(profile.minObservedSpacingMs)} · drift ${fmt(profile.maxObservedDriftMs)}`);
            continue;
        }
        const status = String(state?.status ?? profile?.lastStatus ?? "FAILED").toUpperCase();
        const reason = String(state?.reason ?? profile?.lastReason ?? `Depth ${depth} did not prove clean`);
        return finish(ns, quiet, target, proven, depth, status === "BLOCKED" ? "CEILING" : "FAILED", reason);
    }
    return finish(ns, quiet, target, proven, 0, "COMPLETE", `Reached configured validation ceiling at depth ${proven}`);
}

async function finish(ns, quiet, target, proven, attempted, status, reason) {
    await publishOverlapValidationState(ns, { pid: ns.pid, target, status, reason: `Full-depth test: ${reason}`, fullDepthTest: true, provenDepth: proven, attemptedDepth: attempted, depth: attempted || proven, updatedAt: Date.now(), inFlight: [] });
    if (!quiet) ns.tprint(`[FULL-DEPTH] ${status} · ${target} · proven depth ${proven}${attempted ? ` · stopped at ${attempted}` : ""} · ${reason}`);
}
function report(ns, quiet, status, reason) { if (!quiet) ns.tprint(`[FULL-DEPTH] ${status}: ${reason}`); }
function standby(ns) { const c = readControllerState(ns); return Boolean(c && String(c.executionMode?.mode ?? "").toUpperCase() === "STANDBY" && !String(c.executionMode?.pending ?? "") && Number(c.execution?.activeJobs ?? 0) === 0); }
function clamp(v, min, max) { return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min; }
function clampInt(v, min, max) { return Math.floor(clamp(v, min, max)); }
function fmt(v) { return `${Number(v ?? 0).toFixed(0)}ms`; }
