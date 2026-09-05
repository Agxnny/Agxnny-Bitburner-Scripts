import { readOverlapEvidence } from "/lib/multi-overlap-evidence.js";
import { publishOverlapValidationState, readOverlapValidationState } from "/lib/overlap-validation-state.js";
import { readPlannerState, readControllerState } from "/lib/runtime-state.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const FULL_DEPTH = "/diagnostics/multi-full-depth-test.js";
const SETTLE_MS = 250;

/** Sequentially full-depth test every planner target already proven to depth >=2. @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const quiet = isQuiet(ns), args = positionalArgs(ns);
    const waves = clampInt(Number(args[0] ?? 2), 2, 6);
    const hackFraction = clamp(Number(args[1] ?? 0.10), 0.001, 0.50);
    const stageGapMs = clampInt(Number(args[2] ?? 200), 75, 1000);
    if (!standby(ns)) return report(ns, quiet, "BLOCKED", "Controller must be fully STANDBY with no active jobs");
    if (ns.scriptRunning(FULL_DEPTH, "home")) return report(ns, quiet, "BLOCKED", "A full-depth target test is already running");

    const targets = provenTargets(ns);
    if (!targets.length) return report(ns, quiet, "BLOCKED", "No planner targets currently have durable PROVEN2+ evidence");
    const startedAt = Date.now();
    let completed = 0;

    for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        if (!standby(ns)) return finish(ns, quiet, targets, completed, "ABORTED", "Controller left STANDBY", startedAt);
        await publishOverlapValidationState(ns, setState(ns, target, index, targets, completed, waves, hackFraction, stageGapMs, startedAt));
        const pid = ns.run(FULL_DEPTH, 1, target, waves, hackFraction, stageGapMs, "--quiet");
        if (pid <= 0) return finish(ns, quiet, targets, completed, "BLOCKED", `Unable to launch full-depth test for ${target}`, startedAt);
        while (ns.isRunning(pid, "home")) await ns.sleep(SETTLE_MS);
        await ns.sleep(SETTLE_MS);
        completed += 1;
        const child = readOverlapValidationState(ns);
        const childStatus = String(child?.status ?? "UNKNOWN").toUpperCase();
        if (childStatus === "ABORTED") return finish(ns, quiet, targets, completed, "ABORTED", `${target}: ${child?.reason ?? "aborted"}`, startedAt);
    }
    return finish(ns, quiet, targets, completed, "COMPLETE", `Processed ${completed}/${targets.length} PROVEN2+ targets`, startedAt);
}

function provenTargets(ns) {
    const evidence = readOverlapEvidence(ns), rankings = readPlannerState(ns)?.rankings ?? [];
    return rankings.map((row) => row.hostname).filter(Boolean).filter((host) => Number(evidence?.targets?.[host]?.provenDepth ?? 1) >= 2);
}
function setState(ns, target, index, targets, completed, waves, hackFraction, stageGapMs, startedAt) {
    const proven = Number(readOverlapEvidence(ns)?.targets?.[target]?.provenDepth ?? 1);
    return { pid: ns.pid, target, status: "SET_DEPTH_CLIMB", reason: `Set target ${index + 1}/${targets.length}: ${target} · proven ${proven}`, fullDepthSet: true, setIndex: index + 1, setTotal: targets.length, setCompleted: completed, provenDepth: proven, requestedWaves: waves, hackFraction, stageGapMs, startedAt, inFlight: [] };
}
async function finish(ns, quiet, targets, completed, status, reason, startedAt) {
    await publishOverlapValidationState(ns, { pid: ns.pid, status, reason: `PROVEN2+ set: ${reason}`, fullDepthSet: true, setIndex: completed, setTotal: targets.length, setCompleted: completed, startedAt, updatedAt: Date.now(), inFlight: [] });
    if (!quiet) ns.tprint(`[FULL-DEPTH-SET] ${status} · ${reason}`);
}
function report(ns, quiet, status, reason) { if (!quiet) ns.tprint(`[FULL-DEPTH-SET] ${status}: ${reason}`); }
function standby(ns) { const c = readControllerState(ns); return Boolean(c && String(c.executionMode?.mode ?? "").toUpperCase() === "STANDBY" && !String(c.executionMode?.pending ?? "") && Number(c.execution?.activeJobs ?? 0) === 0); }
function clamp(v, min, max) { return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min; }
function clampInt(v, min, max) { return Math.floor(clamp(v, min, max)); }
