import { isControllerStateStale } from "/lib/runtime-state.js";
import { currentMultiRequest, queueController, status } from "/ui/actions.js";
import { button, card, el, grid, healthRow, heroMetric, kv, note, progressBar } from "/ui/components/layout.js";
import { compactMs, moneyFmt, num, pctFine, ramFmt } from "/ui/components/format.js";
import { styles } from "/ui/styles.js";

const WORKER_LATE_RATIO = 0.15;
const WORKER_LATE_MIN_MS = 5_000;

export function overviewView(s) {
    const c = s.controller ?? {};
    const m = c.money ?? {};
    const sec = c.security ?? {};
    const exec = c.execution ?? {};
    const tele = s.telemetry ?? {};
    const mode = c.executionMode?.mode ?? "STANDBY";
    const workers = Array.isArray(exec.activeWorkers) ? exec.activeWorkers : [];

    return el("div", null,
        el("div", { style: styles.heroGrid },
            heroMetric("TARGET", c.hostname ?? "waiting", `${pctFine(Number(m.max ?? 0) > 0 ? Number(m.current ?? 0) / Number(m.max) : 0)} · sec +${Math.max(0, Number(sec.current ?? 0) - Number(sec.minimum ?? 0)).toFixed(2)}`),
            heroMetric("INCOME · 5M", `${moneyFmt(tele.incomePerSecond5m)}/s`, `${Number(tele.hackEvents ?? 0)} hack events`),
            heroMetric("REMOTE RAM", ramFmt(exec.usableRam), `${Number(exec.hostCount ?? 0)} hosts`),
            heroMetric("EXECUTION", modeLabel(mode), executionSubtext(c)),
        ),
        card("Quick controls", quickControls(s), true),
        grid(
            card("Target", el("div", null,
                kv("Mode", c.targetControl?.mode ?? "AUTO"),
                kv("Money", `${moneyFmt(m.current)} / ${moneyFmt(m.max)}`),
                progressBar(Number(m.max ?? 0) > 0 ? Number(m.current ?? 0) / Number(m.max) : 0),
                kv("Security", `${num(sec.current)} / ${num(sec.minimum)}`),
                kv("Action", `${c.action ?? "—"} · ${c.tactical?.status ?? "waiting"}`),
                note(c.reason ?? "Waiting for controller state"),
            )),
            card("Health + economy", el("div", null,
                healthRow("Controller", Boolean(s.controller) && !isControllerStateStale(s.controller)),
                healthRow("Planner", Boolean(s.planner?.selectedTarget)),
                healthRow("Economy", Boolean(s.economic?.selectedTarget)),
                kv("Cash", moneyFmt(s.economy?.cash)),
                kv("Goal", s.economy?.goal?.title ?? "No goal"),
                kv("Cloud", s.purchase?.status ?? "idle"),
            )),
        ),
        workers.length ? card(`Active workers · ${workers.length}`, activeWorkersView(workers), true) : null,
    );
}

function quickControls(s) {
    const c = s.controller ?? {};
    const mode = c.executionMode?.mode ?? "STANDBY";
    const pending = Boolean(c.executionMode?.pending);
    const target = String(c.hostname ?? "");
    const resumeUseful = Boolean(c.prep?.hold || c.executionMode?.pipelineSafetyStopped || c.executionMode?.multiSafetyStopped);
    return el("div", null,
        el("div", { style: styles.controlGrid },
            el("div", null,
                kv("Execution", pending ? `SWITCHING → ${c.executionMode.pending}` : modeLabel(mode)),
                kv("Prep", c.prep?.hold ? "PREPARED HOLD" : c.prep?.active ? `PREP ${c.prep.stage ?? "ACTIVE"}` : "off"),
                kv("Pipeline", c.executionMode?.pipelineSafetyStopped ? "SAFETY STOP" : c.executionMode?.pipelineRunning ? "RUNNING · depth 2" : mode === "PIPELINE" ? "ready / preparing" : "off"),
                kv("Multi", c.executionMode?.multiSafetyStopped ? "SAFETY STOP" : c.executionMode?.multiRunning ? `RUNNING · ${c.executionMode?.multiConfig?.globalDepth ?? "?"} targets` : mode === "MULTI" ? "controller-managed waves" : "off"),
            ),
            el("div", { style: styles.controlActions },
                modeButton("Standby", "STANDBY", mode, pending, "clear"),
                modeButton("HGW", "HGW", mode, pending, "clear"),
                modeButton("Batch", "BATCH", mode, pending, "primary"),
                modeButton("Pipeline", "PIPELINE", mode, pending, "primary"),
                button("Multi", () => queueController({ action: "START_MULTI", ...currentMultiRequest() }), pending, "primary"),
                button("Prep + hold", () => queueController({ action: "PREP_TARGET", target }), !target, "primary"),
                button("Resume", () => queueController({ action: "RESUME_AUTO" }), !resumeUseful, "clear"),
            ),
        ),
        el("div", { style: styles.goalStatus }, c.executionMode?.lastMessage || c.prep?.lastMessage || status("controllerStatus")),
    );
}

function modeButton(label, requestedMode, currentMode, pending, tone) {
    return button(label, () => queueController({ action: "SET_EXECUTION_MODE", mode: requestedMode }), pending || currentMode === requestedMode, tone);
}

function activeWorkersView(workers) {
    return el("div", null,
        ...workers.slice(0, 10).map((worker) => {
            const timing = workerTiming(worker);
            return el("div", { key: `${worker.hostname}-${worker.pid}`, style: styles.workerRow },
                el("span", null, `${worker.action ?? "?"} · ${worker.target ?? "?"}`),
                el("span", { style: styles.dimText }, worker.hostname ?? "?"),
                el("span", { style: styles.right }, `${worker.threads ?? 0}t`),
                el("span", { style: timing.late ? styles.warnText : styles.goodText }, timing.label),
            );
        }),
        workers.length > 10 ? note(`${workers.length - 10} more allocation(s) hidden.`) : null,
    );
}

function workerTiming(worker) {
    const finish = Number(worker?.expectedFinishAt ?? 0);
    const durationMs = Number(worker?.expectedDurationMs ?? 0);
    if (!(finish > 0)) return { late: false, label: "ETA ?" };
    const remaining = finish - Date.now();
    if (remaining >= 0) return { late: false, label: `${compactMs(remaining)} left` };
    const lateBy = -remaining;
    const grace = Math.max(WORKER_LATE_MIN_MS, durationMs * WORKER_LATE_RATIO);
    return lateBy > grace ? { late: true, label: `LATE +${compactMs(lateBy)}` } : { late: false, label: "finishing" };
}

function executionSubtext(controller) {
    const mode = String(controller.executionMode?.mode ?? "STANDBY").toUpperCase();
    if (controller.executionMode?.pending) return `switching → ${controller.executionMode.pending}`;
    if (mode === "MULTI") return controller.executionMode?.multiRunning ? `${controller.executionMode?.multiConfig?.globalDepth ?? "?"} targets active` : controller.executionMode?.multiSafetyStopped ? "safety stop" : "wave scheduler active";
    if (mode === "PIPELINE") return controller.executionMode?.pipelineRunning ? "depth 2 active" : controller.executionMode?.pipelineSafetyStopped ? "safety stop" : "preparing / ready";
    if (mode === "STANDBY") return "production parked";
    const finish = Number(controller.execution?.currentAction?.expectedFinishAt ?? 0);
    return finish > 0 ? `${controller.execution.currentAction.action ?? "WORK"} · ${compactMs(Math.max(0, finish - Date.now()))}` : "idle";
}

export function modeLabel(mode) {
    const m = String(mode ?? "STANDBY").toUpperCase();
    return m === "MULTI" ? "MULTI HWGW" : m === "PIPELINE" ? "PIPELINE HWGW" : m === "BATCH" ? "BATCH HWGW" : m === "HGW" ? "NORMAL HGW" : "STANDBY";
}
