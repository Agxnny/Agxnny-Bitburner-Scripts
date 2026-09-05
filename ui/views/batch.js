import { currentMultiRequest, field, queueController, queueMultiRun, setField, status } from "/ui/actions.js";
import { button, card, details, el, heroMetric, kv, labeledControl, note, stat } from "/ui/components/layout.js";
import { age, batchThreadsText, countdownTo, msFmt, pctFine, ramFmt, signedMs, signedNum, stageShort } from "/ui/components/format.js";
import { styles } from "/ui/styles.js";

export function batchView(s) {
    const current = liveBatchState(s);
    const last = s.lastCompletedBatch ?? null;
    const scheduler = freshPipelineState(s);
    const multi = s.multiScheduler ?? null;
    return el("div", null,
        el("div", { style: styles.heroGrid },
            heroMetric("SERIAL BATCH", current?.status ?? "IDLE", current?.target ?? "no active serialized batch"),
            heroMetric("PIPELINE", schedulerMode(scheduler), scheduler ? `${scheduler.status ?? "—"} · ${age(scheduler.updatedAt)}` : "no active pipeline"),
            heroMetric("MULTI-TARGET", multiExecutionMode(multi), multi ? `${multi.status ?? "—"} · ${age(multi.updatedAt)}` : "no multi-target state"),
            heroMetric("LAST COMPLETE", last ? age(last.finishedAt) : "none", last?.target ?? "waiting"),
        ),
        card("Multi-target controls", multiTargetControls(s, multi), true),
        card("Multi-target activity", multiTargetActivity(multi), true),
        scheduler ? card("Pipeline", pipelineSummary(scheduler), true) : null,
        current ? card("Current serialized batch", currentBatch(current), true) : null,
        last ? card("Last completed batch", completedBatch(last), true) : null,
    );
}

function multiTargetControls(s, state) {
    const c = s.controller ?? {};
    const mode = String(c.executionMode?.mode ?? "STANDBY").toUpperCase();
    const pending = Boolean(c.executionMode?.pending);
    const running = state?.model?.startsWith("MULTI_TARGET_EXECUTOR") && state?.status === "RUNNING" && Date.now() - Number(state?.updatedAt ?? 0) < 5000;
    const canFinite = mode === "STANDBY" && !pending && !running && Number(c.execution?.activeJobs ?? 0) === 0;
    const completed = Array.isArray(state?.completed) ? state.completed : [];
    const inFlight = Array.isArray(state?.inFlight) ? state.inFlight : [];
    const admitted = Array.isArray(state?.admittedTargets) ? state.admittedTargets : [];
    const cfg = c.executionMode?.multiConfig ?? {};

    return el("div", null,
        el("div", { style: styles.multiControlGrid },
            labeledControl("Profile", el("select", {
                value: field("multiProfile"), onChange: (event) => setField("multiProfile", event.target.value), style: styles.input,
            }, el("option", { value: "money" }, "MONEY"), el("option", { value: "balanced" }, "BALANCED"), el("option", { value: "xp" }, "XP"))),
            numberField("Top targets", "multiTargetCount", 2, 12),
            numberField("Live batches", "multiDepth", 2, 12),
            numberField("Hack %", "multiHackPercent", 0.1, 90, 0.1),
            numberField("Stage gap ms", "multiStageGap", 75, 5000, 25),
            el("div", { style: styles.multiLaunch },
                button(running && mode === "STANDBY" ? "Running…" : "Finite wave", () => queueMultiRun(), !canFinite, "clear"),
                button(mode === "MULTI" ? "Update controller" : "Start controller", () => queueController({ action: "START_MULTI", ...currentMultiRequest() }), pending, "primary"),
            ),
        ),
        el("div", { style: styles.compactGrid },
            kv("Controller", pending ? `SWITCHING → ${c.executionMode.pending}` : mode),
            kv("Per-target cap", "1 batch · no same-target overlap yet"),
            kv("Controller config", cfg.profile ? `${String(cfg.profile).toUpperCase()} · ${cfg.globalDepth} live / top ${cfg.targetCount}` : "not set"),
            kv("Safety", c.executionMode?.multiSafetyStopped ? "STOPPED · Resume to clear" : "OK"),
            kv("Status", state?.model?.startsWith("MULTI_TARGET_EXECUTOR") ? state.status ?? "—" : "idle"),
            kv("Progress", state?.model?.startsWith("MULTI_TARGET_EXECUTOR") ? `${completed.length} complete · ${inFlight.length} in flight` : "—"),
        ),
        admitted.length ? el("div", { style: styles.pipelineRows }, ...admitted.slice(0, 12).map((target, i) => kv(`#${i + 1}`, target))) : null,
        note(mode === "MULTI" ? c.executionMode?.lastMessage ?? "Controller-managed multi-target mode active." : state?.model?.startsWith("MULTI_TARGET_EXECUTOR") ? state.reason ?? status("multiStatus") : status("multiStatus")),
        note("Controller MULTI repeats finite waves automatically. A wave safety failure stops further admissions until Resume. Same-target overlap remains disabled."),
    );
}

function numberField(label, name, min, max, step = 1) {
    return labeledControl(label, el("input", { value: field(name), type: "number", min, max, step, onChange: (event) => setField(name, event.target.value), style: styles.input }));
}

function multiTargetActivity(state) {
    const isExecutor = Boolean(state?.model?.startsWith("MULTI_TARGET_EXECUTOR"));
    const inFlight = isExecutor && Array.isArray(state?.inFlight) ? state.inFlight : [];
    const completed = isExecutor && Array.isArray(state?.completed) ? state.completed : [];
    if (!isExecutor) return note("No real multi-target executor state yet.");
    return el("div", null,
        el("div", { style: styles.compactGrid },
            kv("Profile", String(state.profile ?? "—").toUpperCase()), kv("Run", state.runId ?? "—"),
            kv("Owner", state.controllerOwned ? "CONTROLLER" : "MANUAL"), kv("Active targets", inFlight.length), kv("Completed", completed.length),
        ),
        inFlight.length ? el("div", { style: styles.multiActivityRows }, ...inFlight.map(activeRow)) : note(state.status === "RUNNING" ? "No batches currently in flight." : "No active targets."),
        completed.length ? details("Completed target timings", el("div", { style: styles.multiActivityRows }, ...completed.slice(-12).reverse().map(completedRow))) : null,
    );
}

function activeRow(batch) {
    const launched = Array.isArray(batch?.launchedStages) ? batch.launchedStages.map(stageShort).join(" ") : "—";
    return el("div", { key: batch.id, style: styles.multiActivityRow },
        el("span", { style: styles.multiTargetName }, batch.target ?? "?"), el("span", { style: styles.goodText }, "ACTIVE"),
        el("span", { style: styles.right }, `H ${countdownTo(batch.firstLandingAt)}`), el("span", { style: styles.right }, `W2 ${countdownTo(batch.finalLandingAt)}`),
        el("span", { style: styles.dimText }, launched),
    );
}

function completedRow(entry) {
    const healthy = Boolean(entry?.healthy);
    return el("div", { key: entry.batchId, style: styles.multiActivityRow },
        el("span", { style: styles.multiTargetName }, entry.target ?? "?"), el("span", { style: healthy ? styles.goodText : styles.warnText }, healthy ? "CLEAN" : "CHECK"),
        el("span", { style: styles.right }, `${pctFine(entry.moneyPercent)} · sec ${signedNum(entry.securityDelta, 3)}`),
        el("span", { style: styles.right }, `drift ${msFmt(entry.maxAbsLandingErrorMs)}`),
        el("span", { style: styles.dimText }, `spacing ${msFmt(entry.minimumSpacingMs)} · ${entry.orderCorrect ? "ORDER OK" : "ORDER BAD"}`),
    );
}

function pipelineSummary(state) {
    const real = Boolean(state.execution);
    const admission = state.admission ?? {};
    const batches = real ? (state.inFlight ?? []) : (admission.batches ?? []);
    const interval = Number(state.batchIntervalMs ?? state.timing?.tunedBatchIntervalMs ?? 0);
    const gap = Number(state.stageGapMs ?? state.timing?.tunedStageGapMs ?? 0);
    const completed = real ? state.continuous ? `${Number(state.completedBatches ?? 0)} total` : `${state.completedBatches ?? 0}/${state.requestedBatches ?? 0}` : "—";
    return el("div", null,
        el("div", { style: styles.compactGrid },
            kv("Mode", real ? state.continuous ? "CONTINUOUS DEPTH-2" : "REAL DEPTH-2 TEST" : admission.enabled ? "ADMISSION SIM" : "PLANNER"),
            kv("Status", state.status ?? admission.decision?.status ?? "—"), kv("Stage gap", gap ? `${gap} ms` : "—"), kv("Cadence", interval ? `${interval} ms` : "—"),
            kv("Completed", completed), kv("Safety", state.safetyStopped || admission.safetyStopped ? "STOPPED" : "OK"),
        ),
        batches.length ? el("div", { style: styles.pipelineRows }, ...batches.slice(0, 2).map((batch) => kv(batch.id ?? "batch", `H ${countdownTo(batch.firstLandingAt)} · W2 ${countdownTo(batch.finalLandingAt)}`))) : null,
        note(state.reason || admission.decision?.reason || "Waiting"),
        (state.events ?? admission.events ?? []).length ? details("Recent pipeline events", el("div", null, ...(state.events ?? admission.events).slice(-8).map((event, i) => kv(`${event.type} ${i + 1}`, event.message)))) : null,
    );
}

function currentBatch(batch) {
    return el("div", null,
        el("div", { style: styles.compactGrid }, kv("Target", batch.target ?? "—"), kv("Threads", batchThreadsText(batch.threads ?? {})), kv("W2", countdownTo(batch.timing?.lastLandingAt)), kv("RAM", ramFmt(batch.totalRam))),
        plannedSchedule(batch),
    );
}

function completedBatch(last) {
    return el("div", null,
        el("div", { style: styles.compactGrid },
            kv("Model", last.multiTarget ? "MULTI-TARGET" : last.pipeline ? "PIPELINE" : "SERIAL"), kv("Target", last.target ?? "—"),
            kv("Money", pctFine(last.final?.moneyPercent)), kv("Security Δ", signedNum(last.final?.securityDelta, 3)),
            kv("Order", last.landing?.orderCorrect ? "H → W1 → G → W2 ✓" : "CHECK"), kv("Min spacing", msFmt(last.landing?.minimumSpacingMs)),
            kv("Max drift", msFmt(last.landing?.maxAbsLandingErrorMs)), kv("Events", `${Number(last.landing?.reportedJobs ?? 0)}/${Number(last.landing?.expectedJobs ?? 0)}`),
        ), timingGraph(last), details("Stage diagnostics", stageDetails(last)),
    );
}

function plannedSchedule(batch) {
    const stages = Array.isArray(batch.stages) ? batch.stages : [];
    return stages.length ? el("div", { style: styles.stageStrip }, ...stages.map((stage) => stat(stageShort(stage.name), countdownTo(stage.landingAt)))) : null;
}

function timingGraph(batch) {
    const stages = Array.isArray(batch.landing?.stages) ? batch.landing.stages.filter((s) => Number(s.plannedLandingAt) > 0 && Number(s.actualLandingAt) > 0) : [];
    if (!stages.length) return note("No completed landing timing available.");
    const times = stages.flatMap((stage) => [Number(stage.plannedLandingAt), Number(stage.actualLandingAt)]);
    const padding = Math.max(30, Number(batch.gapMs ?? 200) * 0.35);
    const start = Math.min(...times) - padding;
    const span = Math.max(1, Math.max(...times) + padding - start);
    const pos = (time) => `${Math.max(0, Math.min(100, ((Number(time) - start) / span) * 100)).toFixed(2)}%`;
    return el("div", { style: styles.timeline }, ...stages.map((stage) => el("div", { key: stage.name, style: styles.timelineRow },
        el("span", { style: styles.timelineLabel }, stageShort(stage.name)),
        el("div", { style: styles.timelineTrack }, el("div", { style: styles.timelineBaseline }), el("div", { style: { ...styles.timelineMarkerPlanned, left: pos(stage.plannedLandingAt) } }), el("div", { style: { ...styles.timelineMarkerActual, left: pos(stage.actualLandingAt) } })),
        el("span", { style: styles.timelineError }, signedMs(stage.landingErrorMs)),
    )));
}

function stageDetails(batch) {
    const stages = Array.isArray(batch.landing?.stages) ? batch.landing.stages : [];
    return stages.length ? el("div", null, ...stages.map((stage) => kv(stageShort(stage.name), `error ${signedMs(stage.landingErrorMs)} · spread ${msFmt(stage.allocationSpreadMs)} · jobs ${stage.reportedJobs}/${stage.expectedJobs}`))) : note("No stage telemetry.");
}

function freshPipelineState(s) {
    const state = s.scheduler ?? null;
    if (!state) return null;
    if (s.controller?.executionMode?.pipelineRunning) return state;
    return Date.now() - Number(state.updatedAt ?? 0) < 5000 ? state : null;
}
function schedulerMode(s) { return !s ? "OFF" : s.execution ? s.continuous ? "CONT DEPTH-2" : "REAL DEPTH-2" : s.admission?.enabled ? "SIM DEPTH-2" : "PLANNER"; }
function multiExecutionMode(state) { if (!state?.model?.startsWith("MULTI_TARGET_EXECUTOR")) return "OFF"; return state.status === "RUNNING" ? `LIVE ${Number(state.globalLiveDepthCap ?? 0)}` : state.status ?? "READY"; }
function liveBatchState(s) {
    const batch = s.batch ?? null;
    const mode = s.controller?.executionMode ?? {};
    if (!batch || String(batch.status ?? "") === "COMPLETE") return null;
    if (!mode.batchRunning && !["PLANNING", "READY", "RUNNING"].includes(String(batch.status ?? ""))) return null;
    if (batch.target && s.controller?.hostname && batch.target !== s.controller.hostname) return null;
    return batch;
}
