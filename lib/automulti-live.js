import { buildPreparedBatchTemplate } from "/lib/batch-allocation.js";
import { getTargetBatchSafety } from "/lib/batch-history.js";
import { chooseAutoMultiDecision } from "/lib/automulti-decision.js";
import { summarizeExecutionPool } from "/lib/execution.js";
import { readStressEvidence } from "/lib/multi-stress-evidence.js";
import { multiTargetRankings, multiTargetRankingSource, normalizeMultiProfile } from "/lib/multi-target-ranking.js";
import { readBatchHistoryState, readEconomyTargetState, readPlannerState } from "/lib/runtime-state.js";

export const AUTO_HACK_PERCENTS = Object.freeze([5, 7.5, 10, 12.5, 15, 20]);
export const AUTO_STAGE_GAP_MS = 200;
export const AUTO_MAX_TARGETS = 12;

/** Build the exact live input consumed by the pure AUTOMULTI decision engine. */
export function buildLiveAutoMultiDecision(ns, objective = "money") {
    const profile = normalizeMultiProfile(objective);
    const planner = readPlannerState(ns);
    if (!planner || !Array.isArray(planner.rankings)) {
        return { ok: false, reason: "planner state unavailable", decision: null };
    }

    const economic = readEconomyTargetState(ns);
    const pool = summarizeExecutionPool(ns, planner);
    const history = readBatchHistoryState(ns);
    const evidence = readStressEvidence(ns);
    const rankings = multiTargetRankings(planner, economic, profile).slice(0, AUTO_MAX_TARGETS);
    const rankingSource = multiTargetRankingSource(planner, economic, profile);
    const scenarios = AUTO_HACK_PERCENTS.map((hackPercent) => buildScenario(
        ns,
        profile,
        hackPercent,
        rankings,
        pool.usableRam,
        history,
    ));
    const decision = chooseAutoMultiDecision({ objective: profile, scenarios, evidence });
    return {
        ok: true,
        decision,
        evidence,
        pool,
        rankingSource,
        candidateCount: rankings.length,
        updatedAt: Date.now(),
    };
}

function buildScenario(ns, profile, hackPercent, rankings, usableRamGb, history) {
    const candidates = rankings
        .map((entry) => buildPreparedBatchTemplate(ns, entry, hackPercent / 100, AUTO_STAGE_GAP_MS))
        .filter((template) => template.ok)
        .map((template) => candidateFromTemplate(template, history));
    return { profile, hackPercent, stageGapMs: AUTO_STAGE_GAP_MS, usableRamGb, candidates };
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
