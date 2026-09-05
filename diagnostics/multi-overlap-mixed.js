import { buildPreparedBatchTemplate } from "/lib/batch-allocation.js";
import { readOverlapEvidence } from "/lib/multi-overlap-evidence.js";
import { targetOverlapPolicy } from "/lib/multi-overlap-policy.js";
import { publishOverlapValidationState } from "/lib/overlap-validation-state.js";
import { readBatchHistoryState, readControllerState, readPlannerState } from "/lib/runtime-state.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const VALIDATOR = "/diagnostics/multi-overlap-validate.js";

/** Sequentially validates a prepared target set while preserving single Port-14 ownership. @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    const raw = positionalArgs(ns);
    const scopeToken = String(raw[0] ?? "").toLowerCase();
    const hasScope = scopeToken === "all" || scopeToken === "validate2";
    const scope = hasScope ? scopeToken : "validate2";
    const offset = hasScope ? 1 : 0;
    const waves = clampInt(Number(raw[offset] ?? 2), 1, 6);
    const hackFraction = clamp(Number(raw[offset + 1] ?? 0.10), 0.001, 0.50);
    const stageGapMs = clampInt(Number(raw[offset + 2] ?? 200), 75, 1000);
    const quiet = isQuiet(ns);

    if (!controllerStandby(ns)) {
        if (!quiet) ns.tprint("[OVERLAP-MIXED] BLOCKED: controller must be fully STANDBY");
        return;
    }

    const planner = readPlannerState(ns);
    const history = readBatchHistoryState(ns);
    const evidence = readOverlapEvidence(ns);
    const candidates = (Array.isArray(planner?.rankings) ? planner.rankings : [])
        .map((entry) => inspect(ns, entry, history, evidence, hackFraction, stageGapMs))
        .filter((entry) => entry.ready && entry.policy.provenDepth < 2)
        .filter((entry) => scope === "all" || entry.policy.eligibleForValidation);

    if (!candidates.length) {
        await publishOverlapValidationState(ns, {
            status: "MIXED_COMPLETE",
            mixed: true,
            mixedScope: scope,
            mixedIndex: 0,
            mixedTotal: 0,
            reason: scope === "all" ? "No prepared targets currently need depth-2 proof" : "No prepared VALIDATE2 targets currently need proof",
            inFlight: [],
        });
        if (!quiet) ns.tprint(`[OVERLAP-MIXED] ${scope === "all" ? "No prepared targets" : "No prepared VALIDATE2 targets"} currently need proof`);
        return;
    }

    if (!quiet) ns.tprint(`[OVERLAP-MIXED] ${scope.toUpperCase()} ${candidates.length} target(s): ${candidates.map((entry) => entry.hostname).join(", ")}`);
    let completed = 0;
    for (let index = 0; index < candidates.length; index += 1) {
        const target = candidates[index].hostname;
        if (!controllerStandby(ns)) {
            await publishOverlapValidationState(ns, { status: "ABORTED", mixed: true, mixedScope: scope, mixedIndex: index, mixedTotal: candidates.length, reason: "Controller left STANDBY", inFlight: [] });
            if (!quiet) ns.tprint("[OVERLAP-MIXED] ABORTED: controller left STANDBY");
            return;
        }
        await publishOverlapValidationState(ns, {
            status: "MIXED_NEXT",
            target,
            mixed: true,
            mixedScope: scope,
            mixedIndex: index + 1,
            mixedTotal: candidates.length,
            reason: `${scope === "all" ? "All prepared" : "Mixed VALIDATE2"} ${index + 1}/${candidates.length}: starting ${target}`,
        });
        const childArgs = [target, waves, hackFraction, stageGapMs];
        if (scope === "all") childArgs.push("--allow-unqualified");
        if (quiet) childArgs.push("--quiet");
        const pid = ns.run(VALIDATOR, 1, ...childArgs);
        if (pid <= 0) {
            await publishOverlapValidationState(ns, { status: "FAILED", mixed: true, mixedScope: scope, mixedIndex: index + 1, mixedTotal: candidates.length, reason: `Could not launch validator for ${target}`, inFlight: [] });
            if (!quiet) ns.tprint(`[OVERLAP-MIXED] STOP: could not launch validator for ${target}`);
            return;
        }
        while (ns.isRunning(pid, "home")) await ns.sleep(250);
        completed += 1;
    }
    await publishOverlapValidationState(ns, {
        status: "MIXED_COMPLETE",
        mixed: true,
        mixedScope: scope,
        mixedIndex: completed,
        mixedTotal: candidates.length,
        reason: `${scope === "all" ? "All-prepared" : "Mixed VALIDATE2"} validation finished ${completed}/${candidates.length} target(s)`,
        inFlight: [],
    });
    if (!quiet) ns.tprint(`[OVERLAP-MIXED] COMPLETE ${completed}/${candidates.length}`);
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
