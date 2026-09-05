import { buildPreparedBatchTemplate } from "/lib/batch-allocation.js";
import { getTargetBatchSafety } from "/lib/batch-history.js";
import { chooseAutoMultiDecision } from "/lib/automulti-decision.js";
import { summarizeExecutionPool } from "/lib/execution.js";
import { readStressEvidence } from "/lib/multi-stress-evidence.js";
import { readBatchHistoryState, readPlannerState } from "/lib/runtime-state.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const HACK_PERCENTS = Object.freeze([5, 7.5, 10, 12.5, 15, 20]);
const STAGE_GAP_MS = 200;
const MAX_TARGETS = 12;

/**
 * Read-only live AUTOMULTI advisor. It never launches workers or changes mode.
 * Usage: run diagnostics/automulti-advisor.js [money|balanced|xp]
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    const quiet = isQuiet(ns);
    const objective = String(positionalArgs(ns)[0] ?? "money").trim().toLowerCase();
    if (!["money", "balanced", "xp"].includes(objective)) {
        ns.tprint("[AUTOMULTI] Usage: run diagnostics/automulti-advisor.js [money|balanced|xp]");
        return;
    }

    const planner = readPlannerState(ns);
    if (!planner || !Array.isArray(planner.rankings)) {
        ns.tprint("[AUTOMULTI] BLOCKED: planner state unavailable");
        return;
    }

    const pool = summarizeExecutionPool(ns, planner);
    const history = readBatchHistoryState(ns);
    const evidence = readStressEvidence(ns);
    const rankings = planner.rankings.slice(0, MAX_TARGETS);
    const scenarios = HACK_PERCENTS.map((hackPercent) => buildScenario(
        ns, objective, hackPercent, rankings, pool.usableRam, history,
    ));
    const decision = chooseAutoMultiDecision({ objective, scenarios, evidence });

    if (quiet) return;
    printDecision(ns, decision, evidence, pool);
}

function buildScenario(ns, profile, hackPercent, rankings, usableRamGb, history) {
    const candidates = rankings
        .map((entry) => buildPreparedBatchTemplate(ns, entry, hackPercent / 100, STAGE_GAP_MS))
        .filter((template) => template.ok)
        .map((template) => candidateFromTemplate(template, history));
    return { profile, hackPercent, stageGapMs: STAGE_GAP_MS, usableRamGb, candidates };
}

function candidateFromTemplate(template, history) {
    const longestStageMs = Math.max(...template.stages.map((stage) => Number(stage.durationMs ?? 0)), 1);
    const totalThreads = Object.values(template.threads ?? {}).reduce((sum, value) => sum + Number(value ?? 0), 0);
    const safety = getTargetBatchSafety(history, template.hostname);
    return {
        hostname: template.hostname,
        prepared: template.preparedNow,
        batchRamGb: template.batchRam,
        moneyRate: template.expectedCash / (longestStageMs / 1000),
        xpRate: totalThreads / (longestStageMs / 1000),
        moneyEfficiency: template.moneyEfficiency,
        xpEfficiency: template.xpProxyEfficiency,
        safetyFactor: historyFactor(safety),
    };
}

function historyFactor(safety) {
    if (safety.sampleCount > 0 && safety.latestHealthy === false) return 0.50;
    if (safety.consecutiveClean >= 8) return 1.10;
    if (safety.consecutiveClean >= 4) return 1.05;
    if (safety.consecutiveClean >= 2) return 1.00;
    return 0.90;
}

function printDecision(ns, decision, evidence, pool) {
    ns.tprint("=== AUTOMULTI ADVISOR · READ ONLY ===");
    ns.tprint(`[AUTOMULTI] ${decision.status} · objective ${decision.objective.toUpperCase()}`);
    ns.tprint(`[AUTOMULTI] RAM ${formatRam(pool.usableRam)} usable across ${pool.hostCount} production host(s)`);
    ns.tprint(`[AUTOMULTI] Possible ${decision.possibleDepth} · Proven ${decision.provenDepth} · Effective ${decision.effectiveDepth}`);
    ns.tprint(`[AUTOMULTI] Durable proof ${decision.durableProvenDepth ?? evidence.provenDepth ?? 1} · fallback proof ${decision.fallbackProvenDepth ?? 2}`);
    if (decision.config) {
        const c = decision.config;
        ns.tprint(`[AUTOMULTI] CHOOSE ${c.profile.toUpperCase()} · depth ${c.globalDepth} · top ${c.targetCount} · hack ${Number(c.hackPercent).toFixed(1)}% · gap ${c.stageGapMs}ms`);
        ns.tprint(`[AUTOMULTI] Targets ${decision.selectedTargets.join(", ") || "—"}`);
        ns.tprint(`[AUTOMULTI] Prepared ${decision.metrics.preparedCount} · conservative selected RAM ${formatRam(decision.metrics.selectedBatchRamGb)}`);
    }
    if (decision.shouldValidate) ns.tprint(`[AUTOMULTI] VALIDATION CANDIDATE: depth ${decision.validationDepth}`);
    ns.tprint(`[AUTOMULTI] ${decision.reason}`);
    for (const alt of decision.alternatives ?? []) {
        ns.tprint(`[AUTOMULTI] alt hack ${Number(alt.hackPercent).toFixed(1)}% · possible ${alt.possibleDepth} · score ${formatScore(alt.objectiveScore)}`);
    }
}

function formatRam(value) { return `${Number(value ?? 0).toFixed(Number(value ?? 0) >= 100 ? 0 : 1)} GB`; }
function formatScore(value) {
    const n = Number(value ?? 0);
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}b`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}m`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(2)}k`;
    return n.toFixed(2);
}
