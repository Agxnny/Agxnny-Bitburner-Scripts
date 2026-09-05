import { buildPreparedBatchTemplate } from "/lib/batch-allocation.js";
import { readOverlapEvidence } from "/lib/multi-overlap-evidence.js";
import { targetOverlapPolicy } from "/lib/multi-overlap-policy.js";
import { publishOverlapValidationState } from "/lib/overlap-validation-state.js";
import { readBatchHistoryState, readControllerState, readPlannerState } from "/lib/runtime-state.js";
import { positionalArgs } from "/lib/output.js";

const VALIDATOR = "/diagnostics/multi-overlap-validate.js";

/** Sequentially validates every currently prepared depth-2 candidate once. @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const args = positionalArgs(ns);
    const waves = clampInt(Number(args[0] ?? 2), 1, 6);
    const hackFraction = clamp(Number(args[1] ?? 0.10), 0.001, 0.50);
    const stageGapMs = clampInt(Number(args[2] ?? 200), 75, 1000);

    if (!controllerStandby(ns)) {
        ns.tprint("[OVERLAP-MIXED] BLOCKED: controller must be fully STANDBY");
        return;
    }

    const planner = readPlannerState(ns);
    const history = readBatchHistoryState(ns);
    const evidence = readOverlapEvidence(ns);
    const candidates = (Array.isArray(planner?.rankings) ? planner.rankings : [])
        .map((entry) => inspect(ns, entry, history, evidence, hackFraction, stageGapMs))
        .filter((entry) => entry.ready && entry.policy.eligibleForValidation && entry.policy.provenDepth < 2);

    if (!candidates.length) {
        ns.tprint("[OVERLAP-MIXED] No prepared VALIDATE2 targets currently need proof");
        return;
    }

    ns.tprint(`[OVERLAP-MIXED] ${candidates.length} target(s): ${candidates.map((entry) => entry.hostname).join(", ")}`);
    let completed = 0;
    for (let index = 0; index < candidates.length; index += 1) {
        const target = candidates[index].hostname;
        if (!controllerStandby(ns)) {
            ns.tprint("[OVERLAP-MIXED] ABORTED: controller left STANDBY");
            return;
        }
        await publishOverlapValidationState(ns, {
            status: "MIXED_NEXT",
            target,
            mixed: true,
            mixedIndex: index + 1,
            mixedTotal: candidates.length,
            reason: `Mixed validation ${index + 1}/${candidates.length}: starting ${target}`,
        });
        const pid = ns.run(VALIDATOR, 1, target, waves, hackFraction, stageGapMs, "--quiet");
        if (pid <= 0) {
            ns.tprint(`[OVERLAP-MIXED] STOP: could not launch validator for ${target}`);
            return;
        }
        while (ns.isRunning(pid, "home")) await ns.sleep(250);
        completed += 1;
    }
    await publishOverlapValidationState(ns, {
        status: "MIXED_COMPLETE",
        mixed: true,
        mixedIndex: completed,
        mixedTotal: candidates.length,
        reason: `Mixed validation finished ${completed}/${candidates.length} target(s)`,
        inFlight: [],
    });
    ns.tprint(`[OVERLAP-MIXED] COMPLETE ${completed}/${candidates.length}`);
}

function inspect(ns, entry, history, evidence, hackFraction, stageGapMs) {
    const template = buildPreparedBatchTemplate(ns, entry, hackFraction, stageGapMs);
    return {
        hostname: String(entry?.hostname ?? ""),
        ready: Boolean(template?.ok && template.preparedNow),
        policy: targetOverlapPolicy(history, entry?.hostname, evidence),
    };
}
function controllerStandby(ns) {
    const controller = readControllerState(ns);
    return Boolean(controller && String(controller.executionMode?.mode ?? "").toUpperCase() === "STANDBY" && !String(controller.executionMode?.pending ?? ""));
}
function clamp(value, min, max) { return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min; }
function clampInt(value, min, max) { return Math.floor(clamp(value, min, max)); }
