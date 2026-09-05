import { isControllerStateStale } from "/lib/runtime-state.js";
import { diagnosticActivity, queueDiagnostic, queueTest, status } from "/ui/actions.js";
import { button, card, el, grid, healthRow, kv, note } from "/ui/components/layout.js";
import { age } from "/ui/components/format.js";
import { styles } from "/ui/styles.js";

const FRESH_MS = 5_000;
const WARN_MS = 15_000;
const STALE_MS = 30_000;

export function diagnosticsView(s) {
    const scheduler = freshPipelineState(s) ?? {};
    const verdict = healthVerdict(s);
    const activity = diagnosticActivity();
    return el("div", null,
        verdictBanner(verdict),
        grid(
            card("Health", el("div", null,
                healthRow("Controller", Boolean(s.controller) && !isControllerStateStale(s.controller)),
                healthRow("Planner", Boolean(s.planner?.selectedTarget)),
                healthRow("Economy", Boolean(s.economic?.selectedTarget)),
                healthRow("Telemetry", fresh(s.telemetry?.updatedAt)),
                healthRow("Prepper", fresh(s.prepper?.updatedAt)),
                kv("Scheduler", scheduler.model ?? "none"),
                kv("Multi-target", s.multiScheduler?.model ?? "none"),
            )),
            card("Tests + diagnostics", el("div", null,
                el("div", { style: styles.controlActions },
                    button("Smoke tests", () => queueTest("all", "Smoke tests")),
                    button("Progression test", () => queueTest("progression-advisor", "Progression test"), false, "clear"),
                    button("Memory audit", () => queueDiagnostic("/diagnostics/mem-audit.js", [], "Memory audit")),
                    button("Income", () => queueDiagnostic("/diagnostics/income.js", [], "Income diagnostic")),
                    button("Economy targets", () => queueDiagnostic("/diagnostics/economy-targets.js", [], "Economy target diagnostic")),
                    button("Progression", () => queueDiagnostic("/diagnostics/progression.js", [], "Progression diagnostic")),
                    button("Target ranking", () => queueDiagnostic("/hacking/targets.js", [], "Target ranking diagnostic")),
                ),
                el("div", { style: styles.goalStatus }, status("actionStatus")),
                diagnosticActivityPanel(activity),
            )),
            card("State ages", el("div", null,
                ageRow("Planner", s.planner?.updatedAt),
                ageRow("Economy", s.economic?.updatedAt),
                ageRow("Telemetry", s.telemetry?.updatedAt),
                ageRow("Batch", s.batch?.updatedAt),
                ageRow("Pipeline", s.scheduler?.updatedAt),
                ageRow("Multi-target", s.multiScheduler?.updatedAt),
                ageRow("Prepper", s.prepper?.updatedAt),
                ageRow("Last complete", s.lastCompletedBatch?.finishedAt, true),
            )),
            card("Safety", el("div", null,
                note("Read-only diagnostics can run in any controller mode. Production-affecting MULTI/stress tests remain gated elsewhere and should only run from STANDBY."),
                note("Any multi-wave SAFETY_STOP halts future admissions until Resume. Per-target overlap remains depth 1."),
            )),
        ),
    );
}

function healthVerdict(s) {
    const controllerBad = !s.controller || isControllerStateStale(s.controller);
    const safetyStopped = Boolean(s.multiScheduler?.safetyStopped || s.controller?.executionMode?.multiSafetyStopped);
    const stale = [s.planner, s.economic, s.telemetry, s.prepper]
        .some((state) => state?.updatedAt && Date.now() - Number(state.updatedAt) >= STALE_MS);
    if (safetyStopped) return { label: "SAFETY STOP", tone: "bad", detail: "MULTI admissions are halted until Resume." };
    if (controllerBad) return { label: "DEGRADED", tone: "warn", detail: "Controller state is unavailable or stale." };
    if (stale) return { label: "STALE TELEMETRY", tone: "warn", detail: "One or more core runtime snapshots are older than 30 seconds." };
    return { label: "HEALTHY", tone: "good", detail: "Core control-plane state is fresh and no safety stop is active." };
}

function verdictBanner(verdict) {
    const toneStyle = verdict.tone === "good" ? styles.goodText : verdict.tone === "bad" ? styles.badText : styles.warnText;
    return el("div", { style: styles.verdict },
        el("div", { style: { ...styles.verdictTitle, ...toneStyle, fontSize: styles.verdictTitle.fontSize } }, verdict.label),
        el("div", { style: styles.verdictSub }, verdict.detail),
    );
}

function diagnosticActivityPanel(activity) {
    if (!activity?.label) return note("No tracked diagnostic launched from this dashboard session yet.");
    const stateStyle = activity.state === "RUNNING" ? styles.warnText : activity.state === "FAILED" ? styles.badText : styles.goodText;
    return el("div", { style: { marginTop: "8px" } },
        kv("Diagnostic", activity.label),
        el("div", { style: styles.kv },
            el("span", { style: styles.key }, "State"),
            el("span", { style: stateStyle }, activity.state),
        ),
        activity.pid ? kv("PID", activity.pid) : null,
        activity.startedAt ? kv("Started", age(activity.startedAt)) : null,
        activity.finishedAt ? kv("Finished", age(activity.finishedAt)) : null,
    );
}

function ageRow(label, timestamp, historical = false) {
    const value = Number(timestamp ?? 0);
    const ms = value > 0 ? Math.max(0, Date.now() - value) : Number.POSITIVE_INFINITY;
    let style = styles.value;
    let suffix = "";
    if (!historical) {
        if (ms >= STALE_MS) { style = styles.badText; suffix = " · STALE"; }
        else if (ms >= WARN_MS) { style = styles.warnText; suffix = " · AGING"; }
        else if (ms < FRESH_MS) style = styles.goodText;
    }
    return el("div", { style: styles.kv },
        el("span", { style: styles.key }, label),
        el("span", { style }, `${age(timestamp)}${suffix}`),
    );
}

function fresh(timestamp) {
    return Date.now() - Number(timestamp ?? 0) < FRESH_MS;
}

function freshPipelineState(s) {
    const state = s.scheduler ?? null;
    if (!state) return null;
    if (s.controller?.executionMode?.pipelineRunning) return state;
    return fresh(state.updatedAt) ? state : null;
}
