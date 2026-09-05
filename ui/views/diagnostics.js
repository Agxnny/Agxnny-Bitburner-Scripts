import { isControllerStateStale } from "/lib/runtime-state.js";
import { queueTest, status } from "/ui/actions.js";
import { button, card, command, el, grid, healthRow, kv, note } from "/ui/components/layout.js";
import { age } from "/ui/components/format.js";
import { styles } from "/ui/styles.js";

export function diagnosticsView(s) {
    const scheduler = freshPipelineState(s) ?? {};
    return grid(
        card("Health", el("div", null,
            healthRow("Controller", Boolean(s.controller) && !isControllerStateStale(s.controller)),
            healthRow("Planner", Boolean(s.planner?.selectedTarget)),
            healthRow("Economy", Boolean(s.economic?.selectedTarget)),
            healthRow("Telemetry", Date.now() - Number(s.telemetry?.updatedAt ?? 0) < 5000),
            healthRow("Prepper", Date.now() - Number(s.prepper?.updatedAt ?? 0) < 5000),
            kv("Scheduler", scheduler.model ?? "none"),
            kv("Multi-target", s.multiScheduler?.model ?? "none"),
        )),
        card("Tests + commands", el("div", null,
            button("Smoke tests", () => queueTest("all", "Smoke tests"), false, "primary"),
            button("Progression test", () => queueTest("progression-advisor", "Progression test"), false, "clear"),
            el("div", { style: styles.goalStatus }, status("actionStatus")),
            command("RAM audit", "run diagnostics/mem-audit.js"),
            command("Finite multi test", "run hacking/multi-target-runner.js money 6 0.10 200 3"),
        )),
        card("State ages", el("div", null,
            kv("Planner", age(s.planner?.updatedAt)),
            kv("Economy", age(s.economic?.updatedAt)),
            kv("Batch", age(s.batch?.updatedAt)),
            kv("Pipeline", age(s.scheduler?.updatedAt)),
            kv("Multi-target", age(s.multiScheduler?.updatedAt)),
            kv("Prepper", age(s.prepper?.updatedAt)),
            kv("Last complete", age(s.lastCompletedBatch?.finishedAt)),
        )),
        card("Safety", el("div", null,
            note("MULTI is controller-managed repeated finite waves. Mode switching waits for the current multi-target wave to finish before changing modes."),
            note("Any multi-wave SAFETY_STOP halts future admissions until Resume. Per-target overlap remains depth 1."),
        )),
    );
}

function freshPipelineState(s) {
    const state = s.scheduler ?? null;
    if (!state) return null;
    if (s.controller?.executionMode?.pipelineRunning) return state;
    return Date.now() - Number(state.updatedAt ?? 0) < 5000 ? state : null;
}
