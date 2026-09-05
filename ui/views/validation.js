import { targetOverlapPolicy } from "/lib/multi-overlap-policy.js";
import { field, queueValidationRun, setField, status } from "/ui/actions.js";
import { badge, button, card, el, grid, kv, labeledControl, note, progressBar } from "/ui/components/layout.js";
import { styles } from "/ui/styles.js";

export function validationView(s) {
    const state = s.overlapValidation ?? {};
    const running = ["STARTING", "RUNNING", "BETWEEN_WAVES", "MIXED_NEXT"].includes(String(state.status ?? ""));
    const controllerMode = String(s.controller?.executionMode?.mode ?? "STANDBY").toUpperCase();
    const controllerPending = String(s.controller?.executionMode?.pending ?? "");
    const canStart = controllerMode === "STANDBY" && !controllerPending && !running;
    const rows = targetRows(s);

    return el("div", null,
        card("Overlap validation control", el("div", null,
            el("div", { style: styles.validationControlGrid },
                labeledControl("Target", targetSelect(s)),
                labeledControl("Waves", input("validationWaves", "number", 1, 6)),
                labeledControl("Hack %", input("validationHackPercent", "number", 0.1, 50)),
                labeledControl("Stage gap ms", input("validationStageGap", "number", 75, 1000)),
                el("div", { style: styles.multiLaunch }, button(running ? "VALIDATING…" : "START VALIDATION", queueValidationRun, !canStart)),
            ),
            el("div", { style: styles.goalStatus }, status("validationStatus")),
            note(controllerMode === "STANDBY" && !controllerPending
                ? "Mixed validates every currently prepared VALIDATE2 target sequentially. A specific target runs only that target."
                : `Validation launch locked until controller is fully STANDBY · current ${controllerPending ? `${controllerMode} → ${controllerPending}` : controllerMode}`),
        ), true),
        liveOverview(state),
        landingStream(state),
        evidenceTable(rows),
    );
}

function targetSelect(s) {
    const current = field("validationTarget") || "mixed";
    const rankings = Array.isArray(s.planner?.rankings) ? s.planner.rankings : [];
    return el("select", {
        value: current,
        onChange: (event) => setField("validationTarget", event.target.value),
        style: styles.input,
    },
        el("option", { value: "mixed" }, "MIXED · all VALIDATE2"),
        ...rankings.slice(0, 24).map((entry) => el("option", { key: entry.hostname, value: entry.hostname }, entry.hostname)),
    );
}

function input(name, type, min, max) {
    return el("input", {
        value: field(name),
        type,
        min,
        max,
        onChange: (event) => setField(name, event.target.value),
        style: styles.input,
    });
}

function liveOverview(state) {
    const live = state.live ?? {};
    const waveTotal = Number(state.requestedWaves ?? 0);
    const currentWave = Number(state.currentWave ?? 0);
    const expectedStages = Number(live.expectedStages ?? 8);
    const completedStages = Number(live.completedStages ?? 0);
    const expectedJobs = Number(live.expectedJobs ?? 0);
    const reportedJobs = Number(live.reportedJobs ?? 0);
    const fresh = Date.now() - Number(state.updatedAt ?? 0) <= 2000;
    const last = state.lastResult;

    return grid(
        card("Live validation", el("div", null,
            kv("Status", el("span", { style: toneStyle(state.status) }, String(state.status ?? "IDLE"))),
            kv("Target", state.target ?? "—"),
            kv("Wave", waveTotal ? `${currentWave}/${waveTotal}` : "—"),
            kv("Clean this run", Number(state.cleanWaves ?? 0)),
            kv("Telemetry", fresh ? badge("LIVE", "good") : badge("STALE", "warn")),
            state.mixed ? kv("Mixed progress", `${Number(state.mixedIndex ?? 0)}/${Number(state.mixedTotal ?? 0)}`) : null,
            note(state.reason ?? "Waiting for validation activity"),
        )),
        card("Progress", el("div", null,
            kv("Stages", `${completedStages}/${expectedStages}`),
            progressBar(expectedStages ? completedStages / expectedStages : 0),
            kv("Timing jobs", `${reportedJobs}/${expectedJobs || "—"}`),
            progressBar(expectedJobs ? reportedJobs / expectedJobs : 0),
            kv("Launched stages", `${Number(live.launchedStages ?? 0)}/${expectedStages}`),
            last ? kv("Last wave", last.healthy ? "CLEAN" : "FAILED") : null,
            last ? kv("Spacing / drift", `${fmtMs(last.minimumSpacingMs)} / ${fmtMs(last.maxAbsLandingErrorMs)}`) : null,
            last ? kv("Recovery", `${pct(last.finalMoneyRatio)} · sec +${Number(last.finalSecurityDelta ?? 0).toFixed(3)}`) : null,
        )),
    );
}

function landingStream(state) {
    const batches = Array.isArray(state.inFlight) ? state.inFlight : [];
    return card("Landing stream", el("div", null,
        batches.length ? batches.map((batch, index) => el("div", { key: batch.id, style: { marginBottom: "8px" } },
            el("div", { style: styles.strategyTitle }, `Batch ${index + 1} · ${batch.done ? "DONE" : "ACTIVE"}`),
            el("div", { style: styles.stageStrip }, ...(batch.stages ?? []).map((stage) => el("div", { key: stage.name, style: styles.stat },
                el("div", { style: styles.statLabel }, stage.name),
                el("div", { style: styles.statValue }, stage.actualLandingAt ? `✓ ${signedMs(Number(stage.actualLandingAt) - Number(stage.landingAt))}` : stage.launched ? "IN FLIGHT" : "WAITING"),
                el("div", { style: styles.dimText }, `${stage.events ?? 0}/${stage.jobs ?? 0} jobs`),
            ))),
        )) : note("No active validation batches. Start a target or Mixed validation above."),
    ), true);
}

function evidenceTable(rows) {
    return card("Depth-2 evidence", el("div", null,
        ...rows.map((row) => el("div", { key: row.hostname, style: styles.validationRow },
            el("span", { style: styles.multiTargetName }, row.hostname),
            el("span", { style: toneStyle(row.state) }, row.state),
            el("span", { style: styles.right }, `${row.consecutive} clean`),
            el("span", { style: styles.right }, `depth ${row.provenDepth}`),
            el("span", { style: styles.dimText }, row.reason),
        )),
        rows.length ? null : note("No planner targets available yet."),
    ), true);
}

function targetRows(s) {
    const rankings = Array.isArray(s.planner?.rankings) ? s.planner.rankings : [];
    return rankings.slice(0, 16).map((entry) => {
        const policy = targetOverlapPolicy(s.batchHistory, entry.hostname, s.overlapEvidence);
        const durable = s.overlapEvidence?.targets?.[entry.hostname] ?? {};
        const state = policy.provenDepth >= 2 ? "PROVEN2" : policy.eligibleForValidation ? "VALIDATE2" : "DEPTH1";
        return { hostname: entry.hostname, state, provenDepth: policy.provenDepth, consecutive: Number(durable.consecutiveClean ?? 0), reason: policy.reason };
    });
}
function toneStyle(value) {
    const text = String(value ?? "").toUpperCase();
    if (text.includes("FAILED") || text.includes("ABORT")) return styles.badText;
    if (text.includes("PROVEN") || text.includes("CLEAN") || text.includes("COMPLETE")) return styles.goodText;
    if (text.includes("RUN") || text.includes("START") || text.includes("VALIDATE") || text.includes("MIXED")) return styles.warnText;
    return styles.dimText;
}
function fmtMs(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? `${n.toFixed(0)}ms` : "—"; }
function signedMs(value) { return `${value >= 0 ? "+" : ""}${Number(value).toFixed(0)}ms`; }
function pct(value) { const n = Number(value); return Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : "—"; }
