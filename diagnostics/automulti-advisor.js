import { buildLiveAutoMultiDecision } from "/lib/automulti-live.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

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

    const live = buildLiveAutoMultiDecision(ns, objective);
    if (!live.ok) {
        ns.tprint(`[AUTOMULTI] BLOCKED: ${live.reason}`);
        return;
    }
    if (quiet) return;
    printDecision(ns, live);
}

function printDecision(ns, live) {
    const { decision, evidence, pool, rankingSource, candidateCount } = live;
    ns.tprint("=== AUTOMULTI ADVISOR · READ ONLY ===");
    ns.tprint(`[AUTOMULTI] ${decision.status} · objective ${decision.objective.toUpperCase()} · ranking ${rankingSource}`);
    ns.tprint(`[AUTOMULTI] Candidate universe ${candidateCount} · RAM ${formatRam(pool.usableRam)} usable across ${pool.hostCount} production host(s)`);
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
