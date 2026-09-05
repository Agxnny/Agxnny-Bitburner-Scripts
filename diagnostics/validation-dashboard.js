import { readOverlapEvidence } from "/lib/multi-overlap-evidence.js";
import { readOverlapValidationState } from "/lib/overlap-validation-state.js";

const REFRESH_MS = 250;
const STALE_MS = 2_000;

/** Dedicated tail dashboard for same-target overlap validation. @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.clearLog();
    ns.tail();
    try { ns.resizeTail(760, 640); } catch {}
    while (true) {
        ns.clearLog();
        render(ns, readOverlapValidationState(ns), readOverlapEvidence(ns));
        await ns.sleep(REFRESH_MS);
    }
}

function render(ns, state, evidence) {
    const age = Date.now() - Number(state.updatedAt ?? 0);
    const status = String(state.status ?? "IDLE");
    const target = String(state.target ?? state.requestedTarget ?? "—");
    const waves = Number(state.requestedWaves ?? 0), current = Number(state.currentWave ?? 0), clean = Number(state.cleanWaves ?? 0);
    const durable = evidence?.targets?.[target] ?? null;
    const live = state.live ?? {};

    line(ns, "╔══════════════════════════════════════════════════════════════════════╗");
    line(ns, "║              SAME-TARGET OVERLAP VALIDATION DASHBOARD             ║");
    line(ns, "╚══════════════════════════════════════════════════════════════════════╝");
    line(ns, `${badge(status)}  ${target}   depth ${Number(state.depth ?? 2)}   wave ${current}/${waves || "—"}   clean ${clean}`);
    line(ns, `State ${ageLabel(age)}   runtime ${duration(Date.now() - Number(state.startedAt ?? Date.now()))}   PID ${Number(state.pid ?? 0) || "—"}`);
    line(ns, `Hack ${pct(state.hackFraction)}   stage gap ${ms(state.stageGapMs)}   batch interval ${ms(state.batchIntervalMs)}`);
    line(ns, "");

    line(ns, "LIVE TELEMETRY");
    line(ns, progress("Stages", Number(live.completedStages ?? 0), Number(live.expectedStages ?? 8)));
    line(ns, progress("Jobs", Number(live.reportedJobs ?? 0), Number(live.expectedJobs ?? 0)));
    line(ns, `Launched stages ${Number(live.launchedStages ?? 0)}/${Number(live.expectedStages ?? 8)}   Reason: ${String(state.reason ?? "—")}`);
    line(ns, "");

    line(ns, "LANDING STREAM");
    for (const [index, batch] of (state.inFlight ?? []).entries()) {
        line(ns, `Batch ${index + 1}  ${shortId(batch.id)}  ${batch.done ? "DONE" : "ACTIVE"}`);
        for (const stage of batch.stages ?? []) {
            const planned = Number(stage.landingAt ?? 0), actual = Number(stage.actualLandingAt ?? 0);
            const drift = actual && planned ? actual - planned : null;
            const marker = actual ? "✓" : stage.launched ? "→" : "·";
            line(ns, `  ${marker} ${String(stage.name).padEnd(12)} plan ${clock(planned)}  actual ${actual ? clock(actual) : "--:--:--.---"}  ${drift === null ? "" : signedMs(drift)}  jobs ${stage.events ?? 0}/${stage.jobs ?? 0}`);
        }
    }
    if (!(state.inFlight ?? []).length) line(ns, "  No active validation batches.");
    line(ns, "");

    line(ns, "LAST WAVE");
    const last = state.lastResult;
    if (last) line(ns, `${last.healthy ? "CLEAN ✓" : "FAILED ✗"}   spacing ${ms(last.minimumSpacingMs)}   max drift ${ms(last.maxAbsLandingErrorMs)}   money ${pct(last.finalMoneyRatio)}   sec +${Number(last.finalSecurityDelta ?? 0).toFixed(3)}`);
    else line(ns, "No completed wave in this run yet.");
    line(ns, "");

    line(ns, "DURABLE TARGET PROOF");
    if (durable) {
        line(ns, `Proven depth ${Number(durable.provenDepth ?? 1)}   consecutive clean ${Number(durable.consecutiveClean ?? 0)}   clean ${Number(durable.cleanWaves ?? 0)}   failed ${Number(durable.failedWaves ?? 0)}`);
        line(ns, `Best/worst evidence: min spacing ${ms(durable.minObservedSpacingMs)}   max drift ${ms(durable.maxObservedDriftMs)}   latest ${String(durable.lastStatus ?? "—")}`);
    } else line(ns, "No dedicated durable overlap evidence for this target yet.");
    line(ns, "");
    line(ns, status === "RUNNING" ? "Validator is live. Do not start another Port 14 coordinator." : "Dashboard is read-only; it can remain open between validation runs.");
}

function line(ns, text) { ns.print(text); }
function badge(status) { return `[${String(status).padEnd(14)}]`; }
function pct(value) { const n = Number(value); return Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : "—"; }
function ms(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? `${n.toFixed(0)}ms` : "—"; }
function signedMs(value) { return `${value >= 0 ? "+" : ""}${Number(value).toFixed(0)}ms`; }
function shortId(value) { const s = String(value ?? ""); return s.length > 34 ? `${s.slice(0, 31)}...` : s; }
function ageLabel(age) { return !Number.isFinite(age) || age > STALE_MS ? `STALE ${duration(age)}` : `LIVE ${duration(age)}`; }
function duration(value) { const msValue = Math.max(0, Number(value) || 0), sec = Math.floor(msValue / 1000); return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`; }
function clock(value) { if (!value) return "--:--:--.---"; const d = new Date(value); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`; }
function two(value) { return String(value).padStart(2, "0"); }
function progress(label, value, total) { const safeTotal = Math.max(0, total), ratio = safeTotal ? Math.min(1, value / safeTotal) : 0, width = 28, filled = Math.round(width * ratio); return `${label.padEnd(7)} [${"█".repeat(filled)}${"·".repeat(width - filled)}] ${value}/${safeTotal || "—"}`; }
