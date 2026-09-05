import {
    RuntimePort,
    isControllerStateStale,
    publishManualMoneyGoalState,
    readBatchSchedulerState,
    readBatchState,
    readCloudPurchaseState,
    readControllerState,
    readEconomyState,
    readEconomyTargetState,
    readLastCompletedBatchState,
    readManualMoneyGoalState,
    readMultiTargetSchedulerState,
    readPlannerState,
    readRootState,
    readTacticalPlanState,
} from "/lib/runtime-state.js";
import { readTelemetryState } from "/lib/telemetry.js";

const TEST_REQUEST_PORT = 6;
const MANUAL_GOAL_CONFIG = "/data/manual-money-goal.txt";
const MULTI_TARGET_RUNNER = "/hacking/multi-target-runner.js";
const TABS = Object.freeze(["Overview", "Targets", "Economy", "Batch", "Network", "Diagnostics"]);
const UI_SYNC_MS = 100;
const MAIN_TICK_MS = 25;
const DATA_REFRESH_MS = 1000;
const WORKER_LATE_RATIO = 0.15;
const WORKER_LATE_MIN_MS = 5_000;

let requestedTest = null;
let requestedGoalAction = null;
let requestedControllerAction = null;
let requestedMultiTargetRun = null;
let actionStatus = "Ready";
let goalStatus = "Ready";
let controllerActionStatus = "Ready";
let multiTargetStatus = "Ready · park controller in STANDBY before launch";
let goalInput = "";
let goalLabelInput = "";
let manualTargetInput = "";
let multiProfileInput = "money";
let multiTargetCountInput = "4";
let multiDepthInput = "2";
let multiHackPercentInput = "10";
let multiStageGapInput = "200";
let cachedState = null;
let stateVersion = 0;
let lastDataRefresh = 0;

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.ui.openTail();
    ns.ui.setTailTitle("Agxnny Control Plane");
    ns.ui.resizeTail(1080, 720);

    cachedState = snapshot(ns);
    stateVersion += 1;
    lastDataRefresh = Date.now();
    ns.clearLog();
    ns.printRaw(el(DashboardRoot));

    while (true) {
        const now = Date.now();
        if (now - lastDataRefresh >= DATA_REFRESH_MS) {
            cachedState = snapshot(ns);
            stateVersion += 1;
            lastDataRefresh = now;
        }

        if (requestedTest) {
            const test = requestedTest;
            requestedTest = null;
            ns.writePort(TEST_REQUEST_PORT, JSON.stringify({ test: test.id, requestedAt: now }));
            actionStatus = `${test.label} queued`;
            stateVersion += 1;
        }

        if (requestedControllerAction) {
            const action = requestedControllerAction;
            requestedControllerAction = null;
            ns.writePort(RuntimePort.CONTROL_REQUESTS, JSON.stringify({ ...action, requestedAt: now }));
            controllerActionStatus = controllerStatusText(action);
            stateVersion += 1;
        }

        if (requestedMultiTargetRun) {
            const request = requestedMultiTargetRun;
            requestedMultiTargetRun = null;
            const result = launchMultiTargetRun(ns, request);
            multiTargetStatus = result.message;
            cachedState = snapshot(ns);
            stateVersion += 1;
            lastDataRefresh = now;
        }

        if (requestedGoalAction) {
            const action = requestedGoalAction;
            requestedGoalAction = null;
            await applyGoalAction(ns, action, now);
            cachedState = snapshot(ns);
            stateVersion += 1;
            lastDataRefresh = now;
        }
        await ns.sleep(MAIN_TICK_MS);
    }
}

function DashboardRoot() {
    const [activeTab, setActiveTab] = React.useState("Overview");
    const [, setRenderVersion] = React.useState(stateVersion);
    React.useEffect(() => {
        const timer = setInterval(() => setRenderVersion((current) => current === stateVersion ? current : stateVersion), UI_SYNC_MS);
        return () => clearInterval(timer);
    }, []);

    const s = cachedState ?? {};
    return el("div", { style: styles.app },
        header(s),
        nav(activeTab, setActiveTab),
        el("div", { style: styles.content }, activeView(s, activeTab)),
        el("div", { style: styles.footer },
            el("span", null, "CONTROL PLANE · remote workers"),
            el("span", null, `Planner ${age(s.planner?.updatedAt)}`),
        ),
    );
}

function snapshot(ns) {
    return {
        controller: readControllerState(ns),
        planner: readPlannerState(ns),
        tactical: readTacticalPlanState(ns),
        economy: readEconomyState(ns),
        economic: readEconomyTargetState(ns),
        telemetry: readTelemetryState(ns),
        root: readRootState(ns),
        purchase: readCloudPurchaseState(ns),
        manualGoal: readManualMoneyGoalState(ns),
        batch: readBatchState(ns),
        lastCompletedBatch: readLastCompletedBatchState(ns),
        scheduler: readBatchSchedulerState(ns),
        multiScheduler: readMultiTargetSchedulerState(ns),
    };
}

function launchMultiTargetRun(ns, request) {
    const controller = readControllerState(ns);
    const mode = String(controller?.executionMode?.mode ?? "STANDBY").toUpperCase();
    const pending = String(controller?.executionMode?.pending ?? "").trim();
    if (!controller || isControllerStateStale(controller)) return { ok: false, message: "Blocked · controller state unavailable/stale" };
    if (mode !== "STANDBY" || pending) return { ok: false, message: `Blocked · switch to STANDBY first (${pending ? `${mode} → ${pending}` : mode})` };
    if (Number(controller.execution?.activeJobs ?? 0) > 0) return { ok: false, message: "Blocked · controller workers are still draining" };
    if (ns.scriptRunning(MULTI_TARGET_RUNNER, "home")) return { ok: false, message: "Blocked · multi-target test already running" };

    const profile = String(request.profile ?? "money").toLowerCase();
    const targetCount = Math.floor(Number(request.targetCount));
    const globalDepth = Math.floor(Number(request.globalDepth));
    const hackPercent = Number(request.hackPercent);
    const stageGapMs = Math.floor(Number(request.stageGapMs));
    if (!["money", "balanced", "xp"].includes(profile)) return { ok: false, message: "Blocked · invalid profile" };
    if (!Number.isInteger(targetCount) || targetCount < 2 || targetCount > 12) return { ok: false, message: "Blocked · targets must be 2–12" };
    if (!Number.isInteger(globalDepth) || globalDepth < 2 || globalDepth > 12) return { ok: false, message: "Blocked · live depth must be 2–12" };
    if (globalDepth > targetCount) return { ok: false, message: "Blocked · live depth cannot exceed target count" };
    if (!Number.isFinite(hackPercent) || hackPercent < 0.1 || hackPercent > 90) return { ok: false, message: "Blocked · hack % must be 0.1–90" };
    if (!Number.isInteger(stageGapMs) || stageGapMs < 75 || stageGapMs > 5000) return { ok: false, message: "Blocked · stage gap must be 75–5000 ms" };

    const pid = ns.run(MULTI_TARGET_RUNNER, 1, profile, targetCount, hackPercent / 100, stageGapMs, globalDepth, "--quiet");
    if (pid <= 0) return { ok: false, message: "Launch failed · not enough home RAM or runner unavailable" };
    return { ok: true, message: `Running ${profile.toUpperCase()} · ${globalDepth} batches across top ${targetCount} targets · PID ${pid}` };
}

async function applyGoalAction(ns, action, now) {
    if (action.type === "clear") {
        const state = { version: 1, active: false, targetCash: 0, title: "", updatedAt: now, clearedAt: now };
        await ns.write(MANUAL_GOAL_CONFIG, JSON.stringify(state), "w");
        publishManualMoneyGoalState(ns, state);
        goalStatus = "Goal cleared · automatic spending enabled";
        return;
    }
    const targetCash = parseMoney(action.value);
    if (!(targetCash > 0) || !Number.isFinite(targetCash)) {
        goalStatus = "Invalid goal · try 50m, 1.5b, or 25000000";
        return;
    }
    const title = String(action.label ?? "").trim() || "Manual cash goal";
    const state = { version: 1, active: true, targetCash, title, updatedAt: now, setAt: now };
    await ns.write(MANUAL_GOAL_CONFIG, JSON.stringify(state), "w");
    publishManualMoneyGoalState(ns, state);
    goalStatus = `Goal ${moneyFmt(targetCash)} · automatic spending locked`;
}

function controllerStatusText(action) {
    if (action.action === "PREP_TARGET") return `Prep queued for ${action.target || "current target"}`;
    if (action.action === "RESUME_AUTO") return "Resume selected execution mode queued";
    if (action.action === "SET_MANUAL_TARGET") return `Manual target queued: ${action.target}`;
    if (action.action === "CLEAR_MANUAL_TARGET") return "Automatic target selection queued";
    if (action.action === "SET_EXECUTION_MODE") return `${modeLabel(action.mode)} queued`;
    return "Controller request queued";
}

function header(s) {
    const c = s.controller ?? {};
    const live = Boolean(s.controller) && !isControllerStateStale(s.controller);
    const mode = c.executionMode?.mode ?? "STANDBY";
    const pending = c.executionMode?.pending;
    const pipeline = s.scheduler?.execution && (Date.now() - Number(s.scheduler?.updatedAt ?? 0) < 5000 || c.executionMode?.pipelineRunning)
        ? s.scheduler
        : null;
    const multi = isFreshMultiExecution(s.multiScheduler) ? s.multiScheduler : null;
    return el("div", { style: styles.header },
        el("div", null,
            el("div", { style: styles.eyebrow }, "AGXNNY AUTOMATION"),
            el("div", { style: styles.title }, "Control Plane"),
            el("div", { style: styles.subtitle }, c.hostname ? `${c.hostname} · ${c.phase ?? "waiting"}` : "Waiting for controller"),
        ),
        el("div", { style: styles.badges },
            badge(live ? "ONLINE" : "WAITING", live ? "good" : "dim"),
            badge(pending ? `SWITCH → ${pending}` : modeBadge(mode), pending ? "warn" : mode === "PIPELINE" ? "accent" : mode === "STANDBY" ? "dim" : "accent"),
            pipeline ? badge(`PIPE ${pipeline.status ?? "RUN"}`, pipeline.safetyStopped ? "warn" : "good") : null,
            multi ? badge(`MULTI ${multi.status ?? "RUN"}`, multi.status === "SAFETY_STOP" || multi.status === "BLOCKED" ? "warn" : "good") : null,
            c.prep?.hold ? badge("PREP HOLD", "good") : null,
            c.executionMode?.pipelineSafetyStopped ? badge("PIPE STOP", "warn") : null,
            s.manualGoal?.active ? badge("SPEND LOCK", "warn") : null,
        ),
    );
}

function nav(activeTab, setActiveTab) {
    return el("div", { style: styles.nav }, ...TABS.map((tab) => el("button", {
        key: tab,
        onClick: () => setActiveTab(tab),
        style: { ...styles.navButton, ...(activeTab === tab ? styles.navActive : {}) },
    }, tab)));
}

function activeView(s, tab) {
    if (tab === "Targets") return targetsView(s);
    if (tab === "Economy") return economyView(s);
    if (tab === "Batch") return batchView(s);
    if (tab === "Network") return networkView(s);
    if (tab === "Diagnostics") return diagnosticsView(s);
    return overviewView(s);
}

function overviewView(s) {
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
    const resumeUseful = Boolean(c.prep?.hold || c.executionMode?.pipelineSafetyStopped);
    return el("div", null,
        el("div", { style: styles.controlGrid },
            el("div", null,
                kv("Execution", pending ? `SWITCHING → ${c.executionMode.pending}` : modeLabel(mode)),
                kv("Prep", c.prep?.hold ? "PREPARED HOLD" : c.prep?.active ? `PREP ${c.prep.stage ?? "ACTIVE"}` : "off"),
                kv("Pipeline", c.executionMode?.pipelineSafetyStopped ? "SAFETY STOP" : c.executionMode?.pipelineRunning ? "RUNNING · depth 2" : mode === "PIPELINE" ? "ready / preparing" : "off"),
            ),
            el("div", { style: styles.controlActions },
                button("Standby", () => { requestedControllerAction = { action: "SET_EXECUTION_MODE", mode: "STANDBY" }; }, pending || mode === "STANDBY", "clear"),
                button("HGW", () => { requestedControllerAction = { action: "SET_EXECUTION_MODE", mode: "HGW" }; }, pending || mode === "HGW", "clear"),
                button("Batch", () => { requestedControllerAction = { action: "SET_EXECUTION_MODE", mode: "BATCH" }; }, pending || mode === "BATCH", "primary"),
                button("Pipeline", () => { requestedControllerAction = { action: "SET_EXECUTION_MODE", mode: "PIPELINE" }; }, pending || mode === "PIPELINE", "primary"),
                button("Prep + hold", () => { requestedControllerAction = { action: "PREP_TARGET", target }; }, !target, "primary"),
                button("Resume", () => { requestedControllerAction = { action: "RESUME_AUTO" }; }, !resumeUseful, "clear"),
            ),
        ),
        el("div", { style: styles.goalStatus }, c.executionMode?.lastMessage || c.prep?.lastMessage || controllerActionStatus),
    );
}

function targetsView(s) {
    const selected = s.economic?.selectedTarget;
    const rankings = Array.isArray(s.economic?.rankings) ? s.economic.rankings : [];
    return el("div", null,
        card("Target override", el("div", null,
            el("div", { style: styles.targetForm },
                el("input", {
                    value: manualTargetInput,
                    placeholder: "hostname",
                    onChange: (event) => { manualTargetInput = String(event.target.value ?? ""); stateVersion += 1; },
                    onKeyDown: (event) => { if (event.key === "Enter" && manualTargetInput.trim()) requestedControllerAction = { action: "SET_MANUAL_TARGET", target: manualTargetInput.trim() }; },
                    style: styles.input,
                }),
                button("Set manual", () => { if (manualTargetInput.trim()) requestedControllerAction = { action: "SET_MANUAL_TARGET", target: manualTargetInput.trim() }; }, !manualTargetInput.trim(), "primary"),
                button("Use auto", () => { requestedControllerAction = { action: "CLEAR_MANUAL_TARGET" }; }, false, "clear"),
            ),
            el("div", { style: styles.goalStatus }, s.controller?.targetControl?.lastMessage || controllerActionStatus),
        ), true),
        selected ? card("Selected strategy", el("div", null,
            el("div", { style: styles.strategyTitle }, `${selected.hostname} · ${pct(selected.moneyTargetPercent)} money`),
            el("div", { style: styles.statGrid },
                stat("Prep", duration(selected.prepSeconds)),
                stat("Income", `${moneyFmt(selected.steadyIncomePerSecond)}/s`),
                stat("ETA", duration(selected.economicEtaSeconds)),
            ),
            note(selected.reason ?? ""),
        ), true) : null,
        card("Top targets", rankings.length ? el("div", null, ...rankings.slice(0, 7).map(targetRow)) : note("No ranking available."), true),
    );
}

function economyView(s) {
    const e = s.economy ?? {};
    const manual = s.manualGoal ?? {};
    const purchase = s.purchase ?? {};
    return el("div", null,
        card("Money goal", el("div", null,
            el("div", { style: styles.goalForm },
                el("input", { value: goalInput, placeholder: "50m / 1.5b", onChange: (event) => { goalInput = String(event.target.value ?? ""); stateVersion += 1; }, style: styles.input }),
                el("input", { value: goalLabelInput, placeholder: "optional label", onChange: (event) => { goalLabelInput = String(event.target.value ?? ""); stateVersion += 1; }, style: styles.input }),
                button("Set", () => { requestedGoalAction = { type: "set", value: goalInput, label: goalLabelInput }; }, false, "primary"),
                button("Clear", () => { requestedGoalAction = { type: "clear" }; }, false, "clear"),
            ),
            el("div", { style: styles.goalStatus }, goalStatus),
        ), true),
        grid(
            card("Savings", el("div", null,
                kv("Cash", moneyFmt(e.cash)),
                kv("Goal", e.goal?.title ?? "No goal"),
                kv("Remaining", moneyFmt(e.goal?.remaining)),
                kv("Lock", manual.active ? `ACTIVE · ${moneyFmt(manual.targetCash)}` : "off"),
            )),
            card("Cloud + progression", el("div", null,
                kv("Cloud", purchase.status ?? "idle"),
                kv("Action", purchase.action ?? "NONE"),
                kv("Server", purchase.hostname || "—"),
                kv("Next goal", e.automaticGoal?.title ?? "—"),
                note(purchase.reason ?? "Automatic cloud actions respect the savings lock."),
            )),
        ),
    );
}

function batchView(s) {
    const current = liveBatchState(s);
    const last = s.lastCompletedBatch ?? null;
    const scheduler = s.scheduler ?? null;
    const multi = s.multiScheduler ?? null;
    return el("div", null,
        el("div", { style: styles.heroGrid },
            heroMetric("SERIAL BATCH", current?.status ?? "IDLE", current?.target ?? "no active serialized batch"),
            heroMetric("PIPELINE", schedulerMode(scheduler), scheduler ? `${scheduler.status ?? "—"} · ${age(scheduler.updatedAt)}` : "no scheduler state"),
            heroMetric("MULTI-TARGET", multiExecutionMode(multi), multi ? `${multi.status ?? "—"} · ${age(multi.updatedAt)}` : "no multi-target state"),
            heroMetric("LAST COMPLETE", last ? age(last.finishedAt) : "none", last?.target ?? "waiting"),
        ),
        card("Multi-target finite wave", multiTargetControls(s, multi), true),
        scheduler ? card("Pipeline", pipelineSummary(scheduler), true) : null,
        current ? card("Current serialized batch", el("div", null,
            el("div", { style: styles.compactGrid },
                kv("Target", current.target ?? "—"),
                kv("Threads", batchThreadsText(current.threads ?? {})),
                kv("W2", countdownTo(current.timing?.lastLandingAt)),
                kv("RAM", ramFmt(current.totalRam)),
            ),
            batchPlannedSchedule(current),
        ), true) : null,
        last ? card("Last completed batch", el("div", null,
            el("div", { style: styles.compactGrid },
                kv("Model", last.multiTarget ? "MULTI-TARGET" : last.pipeline ? "PIPELINE" : "SERIAL"),
                kv("Target", last.target ?? "—"),
                kv("Money", pctFine(last.final?.moneyPercent)),
                kv("Security Δ", signedNum(last.final?.securityDelta, 3)),
                kv("Order", last.landing?.orderCorrect ? "H → W1 → G → W2 ✓" : "CHECK"),
                kv("Min spacing", msFmt(last.landing?.minimumSpacingMs)),
                kv("Max drift", msFmt(last.landing?.maxAbsLandingErrorMs)),
                kv("Events", `${Number(last.landing?.reportedJobs ?? 0)}/${Number(last.landing?.expectedJobs ?? 0)}`),
            ),
            batchTimingGraph(last),
            details("Stage diagnostics", batchStageDetails(last)),
        ), true) : null,
    );
}

function multiTargetControls(s, state) {
    const c = s.controller ?? {};
    const mode = String(c.executionMode?.mode ?? "STANDBY").toUpperCase();
    const pending = Boolean(c.executionMode?.pending);
    const running = state?.model === "MULTI_TARGET_EXECUTOR_V2_CONFIGURABLE_FINITE" && state?.status === "RUNNING" && Date.now() - Number(state?.updatedAt ?? 0) < 5000;
    const canRun = mode === "STANDBY" && !pending && !running && Number(c.execution?.activeJobs ?? 0) === 0;
    const completed = Array.isArray(state?.completed) ? state.completed : [];
    const inFlight = Array.isArray(state?.inFlight) ? state.inFlight : [];
    const admitted = Array.isArray(state?.admittedTargets) ? state.admittedTargets : [];

    return el("div", null,
        el("div", { style: styles.multiControlGrid },
            labeledControl("Profile", el("select", {
                value: multiProfileInput,
                onChange: (event) => { multiProfileInput = String(event.target.value ?? "money"); stateVersion += 1; },
                style: styles.input,
            },
            el("option", { value: "money" }, "MONEY"),
            el("option", { value: "balanced" }, "BALANCED"),
            el("option", { value: "xp" }, "XP"))),
            labeledControl("Top targets", el("input", { value: multiTargetCountInput, type: "number", min: 2, max: 12, onChange: (event) => { multiTargetCountInput = String(event.target.value ?? ""); stateVersion += 1; }, style: styles.input })),
            labeledControl("Live batches", el("input", { value: multiDepthInput, type: "number", min: 2, max: 12, onChange: (event) => { multiDepthInput = String(event.target.value ?? ""); stateVersion += 1; }, style: styles.input })),
            labeledControl("Hack %", el("input", { value: multiHackPercentInput, type: "number", min: 0.1, max: 90, step: 0.1, onChange: (event) => { multiHackPercentInput = String(event.target.value ?? ""); stateVersion += 1; }, style: styles.input })),
            labeledControl("Stage gap ms", el("input", { value: multiStageGapInput, type: "number", min: 75, max: 5000, step: 25, onChange: (event) => { multiStageGapInput = String(event.target.value ?? ""); stateVersion += 1; }, style: styles.input })),
            el("div", { style: styles.multiLaunch }, button(running ? "Running…" : "Run finite wave", () => {
                requestedMultiTargetRun = {
                    profile: multiProfileInput,
                    targetCount: multiTargetCountInput,
                    globalDepth: multiDepthInput,
                    hackPercent: multiHackPercentInput,
                    stageGapMs: multiStageGapInput,
                };
            }, !canRun, "primary")),
        ),
        el("div", { style: styles.compactGrid },
            kv("Controller", pending ? `SWITCHING → ${c.executionMode.pending}` : mode),
            kv("Per-target cap", "1 batch · no same-target overlap yet"),
            kv("Status", state?.model?.startsWith("MULTI_TARGET_EXECUTOR") ? state.status ?? "—" : "idle"),
            kv("Progress", state?.model?.startsWith("MULTI_TARGET_EXECUTOR") ? `${completed.length} complete · ${inFlight.length} in flight` : "—"),
        ),
        admitted.length ? el("div", { style: styles.pipelineRows }, ...admitted.slice(0, 12).map((target, i) => kv(`#${i + 1}`, target))) : null,
        note(state?.model?.startsWith("MULTI_TARGET_EXECUTOR") ? state.reason ?? multiTargetStatus : multiTargetStatus),
        note("Finite safety test only: increasing Live batches adds distinct prepared targets. Per-target live depth remains 1 until same-target overlap is separately proven."),
    );
}

function labeledControl(label, control) {
    return el("label", { style: styles.controlField }, el("span", { style: styles.controlLabel }, label), control);
}

function pipelineSummary(state) {
    const real = Boolean(state.execution);
    const admission = state.admission ?? {};
    const batches = real ? (state.inFlight ?? []) : (admission.batches ?? []);
    const interval = Number(state.batchIntervalMs ?? state.timing?.tunedBatchIntervalMs ?? 0);
    const gap = Number(state.stageGapMs ?? state.timing?.tunedStageGapMs ?? 0);
    const reason = state.reason || admission.decision?.reason || "Waiting";
    const completed = real
        ? state.continuous ? `${Number(state.completedBatches ?? 0)} total` : `${state.completedBatches ?? 0}/${state.requestedBatches ?? 0}`
        : "—";
    return el("div", null,
        el("div", { style: styles.compactGrid },
            kv("Mode", real ? state.continuous ? "CONTINUOUS DEPTH-2" : "REAL DEPTH-2 TEST" : admission.enabled ? "ADMISSION SIM" : "PLANNER"),
            kv("Status", state.status ?? admission.decision?.status ?? "—"),
            kv("Stage gap", gap ? `${gap} ms` : "—"),
            kv("Cadence", interval ? `${interval} ms` : "—"),
            kv("Completed", completed),
            kv("Safety", state.safetyStopped || admission.safetyStopped ? "STOPPED" : "OK"),
        ),
        batches.length ? el("div", { style: styles.pipelineRows }, ...batches.slice(0, 2).map((batch) => kv(batch.id ?? "batch", `H ${countdownTo(batch.firstLandingAt)} · W2 ${countdownTo(batch.finalLandingAt)}`))) : null,
        note(reason),
        (state.events ?? admission.events ?? []).length ? details("Recent pipeline events", el("div", null, ...(state.events ?? admission.events).slice(-8).map((event, i) => kv(`${event.type} ${i + 1}`, event.message)))) : null,
    );
}

function batchPlannedSchedule(batch) {
    const stages = Array.isArray(batch.stages) ? batch.stages : [];
    if (!stages.length) return null;
    return el("div", { style: styles.stageStrip }, ...stages.map((stage) => stat(stageShort(stage.name), countdownTo(stage.landingAt))));
}

function batchTimingGraph(batch) {
    const stages = Array.isArray(batch.landing?.stages) ? batch.landing.stages : [];
    const usable = stages.filter((stage) => Number(stage.plannedLandingAt) > 0 && Number(stage.actualLandingAt) > 0);
    if (!usable.length) return note("No completed landing timing available.");
    const times = usable.flatMap((stage) => [Number(stage.plannedLandingAt), Number(stage.actualLandingAt)]);
    const min = Math.min(...times);
    const max = Math.max(...times);
    const padding = Math.max(30, Number(batch.gapMs ?? 200) * 0.35);
    const start = min - padding;
    const span = Math.max(1, max + padding - start);
    const pos = (time) => `${Math.max(0, Math.min(100, ((Number(time) - start) / span) * 100)).toFixed(2)}%`;
    return el("div", { style: styles.timeline },
        ...usable.map((stage) => el("div", { key: stage.name, style: styles.timelineRow },
            el("span", { style: styles.timelineLabel }, stageShort(stage.name)),
            el("div", { style: styles.timelineTrack },
                el("div", { style: styles.timelineBaseline }),
                el("div", { style: { ...styles.timelineMarkerPlanned, left: pos(stage.plannedLandingAt) } }),
                el("div", { style: { ...styles.timelineMarkerActual, left: pos(stage.actualLandingAt) } }),
            ),
            el("span", { style: styles.timelineError }, signedMs(stage.landingErrorMs)),
        )),
    );
}

function batchStageDetails(batch) {
    const stages = Array.isArray(batch.landing?.stages) ? batch.landing.stages : [];
    return stages.length ? el("div", null, ...stages.map((stage) => kv(stageShort(stage.name), `error ${signedMs(stage.landingErrorMs)} · spread ${msFmt(stage.allocationSpreadMs)} · jobs ${stage.reportedJobs}/${stage.expectedJobs}`))) : note("No stage telemetry.");
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

function networkView(s) {
    const n = s.planner?.network ?? {};
    const root = s.root ?? {};
    const hosts = Array.isArray(s.planner?.executionHosts) ? s.planner.executionHosts.filter((h) => h.hostname !== "home") : [];
    return el("div", null,
        el("div", { style: styles.heroGrid },
            heroMetric("DISCOVERED", String(n.discovered ?? 0), "hosts"),
            heroMetric("ROOTED", String(n.rooted ?? 0), "access"),
            heroMetric("EXEC HOSTS", String(hosts.length), "remote pool"),
            heroMetric("PORT TOOLS", `${root.portToolCount ?? n.portToolCount ?? 0}/5`, age(root.updatedAt)),
        ),
        card("Execution hosts", hosts.length ? el("div", null, ...hosts.slice(0, 14).map(hostRow)) : note("No remote hosts."), true),
    );
}

function diagnosticsView(s) {
    const scheduler = s.scheduler ?? {};
    return grid(
        card("Health", el("div", null,
            healthRow("Controller", Boolean(s.controller) && !isControllerStateStale(s.controller)),
            healthRow("Planner", Boolean(s.planner?.selectedTarget)),
            healthRow("Economy", Boolean(s.economic?.selectedTarget)),
            healthRow("Telemetry", Date.now() - Number(s.telemetry?.updatedAt ?? 0) < 5000),
            kv("Scheduler", scheduler.model ?? "none"),
            kv("Multi-target", s.multiScheduler?.model ?? "none"),
        )),
        card("Tests + commands", el("div", null,
            button("Smoke tests", () => { requestedTest = { id: "all", label: "Smoke tests" }; }, false, "primary"),
            button("Progression test", () => { requestedTest = { id: "progression-advisor", label: "Progression test" }; }, false, "clear"),
            el("div", { style: styles.goalStatus }, actionStatus),
            command("RAM audit", "run diagnostics/mem-audit.js"),
            command("Pipeline planner", "run hacking/batch-scheduler.js phantasy 0.10 200"),
            command("Finite depth-2 test", "run hacking/pipeline-runner.js phantasy 0.10 200 2"),
        )),
        card("State ages", el("div", null,
            kv("Planner", age(s.planner?.updatedAt)),
            kv("Economy", age(s.economic?.updatedAt)),
            kv("Batch", age(s.batch?.updatedAt)),
            kv("Pipeline", age(s.scheduler?.updatedAt)),
            kv("Multi-target", age(s.multiScheduler?.updatedAt)),
            kv("Last complete", age(s.lastCompletedBatch?.finishedAt)),
        )),
        card("Safety", el("div", null,
            note("Startup defaults to STANDBY. The dedicated prepper may still maintain targets on its reserved host while production is parked."),
            note("Multi-target finite waves require STANDBY and one live batch per target. Increase distinct-target concurrency gradually; same-target overlap remains locked out."),
        )),
    );
}

function targetRow(r, i) {
    return el("div", { key: `${r.hostname}-${i}`, style: styles.targetRow },
        el("span", { style: styles.rank }, `#${r.economicRank ?? i + 1}`),
        el("span", null, String(r.hostname)),
        el("span", { style: styles.right }, pct(r.moneyTargetPercent)),
        el("span", { style: styles.right }, `${moneyFmt(r.steadyIncomePerSecond)}/s`),
        el("span", { style: styles.right }, duration(r.economicEtaSeconds)),
    );
}

function hostRow(h) {
    return el("div", { key: h.hostname, style: styles.hostRow },
        el("span", null, String(h.hostname)),
        el("span", { style: styles.right }, `${ramFmt(h.maxRam)} max`),
        el("span", { style: styles.right }, `${ramFmt(h.usedRam ?? 0)} used`),
    );
}

function executionSubtext(controller) {
    const mode = controller.executionMode?.mode ?? "STANDBY";
    if (controller.executionMode?.pending) return `switching → ${controller.executionMode.pending}`;
    if (mode === "PIPELINE") return controller.executionMode?.pipelineRunning ? "depth 2 active" : controller.executionMode?.pipelineSafetyStopped ? "safety stop" : "preparing / ready";
    if (mode === "STANDBY") return "production parked";
    return actionEtaText(controller.execution?.currentAction);
}
function modeLabel(mode) {
    const m = String(mode ?? "STANDBY").toUpperCase();
    if (m === "PIPELINE") return "PIPELINE HWGW";
    if (m === "BATCH") return "BATCH HWGW";
    if (m === "HGW") return "NORMAL HGW";
    return "STANDBY";
}
function modeBadge(mode) {
    const m = String(mode ?? "STANDBY").toUpperCase();
    return m === "PIPELINE" ? "PIPELINE" : m === "BATCH" ? "BATCH" : m === "HGW" ? "HGW" : "STANDBY";
}
function pipelineInFlight(scheduler) {
    if (!scheduler) return 0;
    if (scheduler.execution) return Array.isArray(scheduler.inFlight) ? scheduler.inFlight.length : 0;
    return Number(scheduler.admission?.inFlight ?? 0);
}
function schedulerMode(scheduler) {
    if (!scheduler) return "OFF";
    if (scheduler.execution) return scheduler.continuous ? "CONT DEPTH-2" : "REAL DEPTH-2";
    if (scheduler.admission?.enabled) return "SIM DEPTH-2";
    return "PLANNER";
}
function isFreshMultiExecution(state) {
    return Boolean(state?.model?.startsWith("MULTI_TARGET_EXECUTOR")) && Date.now() - Number(state?.updatedAt ?? 0) < 5000;
}
function multiExecutionMode(state) {
    if (!state?.model?.startsWith("MULTI_TARGET_EXECUTOR")) return "OFF";
    const depth = Number(state.globalLiveDepthCap ?? 0);
    return state.status === "RUNNING" ? `LIVE ${depth}` : state.status ?? "READY";
}

function liveBatchState(s) {
    const batch = s.batch ?? null;
    const mode = s.controller?.executionMode ?? {};
    if (!batch || String(batch.status ?? "") === "COMPLETE") return null;
    if (!mode.batchRunning && !["PLANNING", "READY", "RUNNING"].includes(String(batch.status ?? ""))) return null;
    if (batch.target && s.controller?.hostname && batch.target !== s.controller.hostname) return null;
    return batch;
}

function workerTiming(worker) {
    const now = Date.now();
    const finish = Number(worker?.expectedFinishAt ?? 0);
    const durationMs = Number(worker?.expectedDurationMs ?? 0);
    if (!(finish > 0)) return { late: false, label: "ETA ?" };
    const remaining = finish - now;
    if (remaining >= 0) return { late: false, label: `${compactMs(remaining)} left` };
    const lateBy = -remaining;
    const grace = Math.max(WORKER_LATE_MIN_MS, durationMs * WORKER_LATE_RATIO);
    return lateBy > grace ? { late: true, label: `LATE +${compactMs(lateBy)}` } : { late: false, label: "finishing" };
}

function actionEtaText(action) {
    const finish = Number(action?.expectedFinishAt ?? 0);
    if (!(finish > 0)) return "idle";
    const remaining = finish - Date.now();
    return remaining >= 0 ? `${action?.action ?? "WORK"} · ${compactMs(remaining)}` : `${action?.action ?? "WORK"} · finishing`;
}

function heroMetric(label, value, sub) { return el("div", { style: styles.heroCard }, el("div", { style: styles.heroLabel }, label), el("div", { style: styles.heroValue }, value), el("div", { style: styles.heroSub }, sub)); }
function card(title, content, wide = false) { return el("div", { style: { ...styles.card, ...(wide ? styles.wide : {}) } }, el("div", { style: styles.cardTitle }, title), content); }
function grid(...children) { return el("div", { style: styles.grid }, ...children); }
function kv(k, v) { return el("div", { style: styles.kv }, el("span", { style: styles.key }, k), el("span", { style: styles.value }, String(v))); }
function note(v) { return el("div", { style: styles.note }, String(v)); }
function badge(label, tone) { return el("span", { style: { ...styles.badge, ...styles[`badge_${tone}`] } }, label); }
function stat(label, value) { return el("div", { style: styles.stat }, el("div", { style: styles.statLabel }, label), el("div", { style: styles.statValue }, String(value))); }
function details(title, content) { return el("details", { style: styles.details }, el("summary", { style: styles.summary }, title), content); }
function el(type, props, ...children) { return React.createElement(type, props, ...children); }
function button(label, onClick, disabled = false, tone = "primary") { return el("button", { disabled, onClick, style: { ...(tone === "clear" ? styles.clearButton : styles.primaryButton), ...(disabled ? styles.disabledButton : {}) } }, label); }
function healthRow(label, ok) { return el("div", { style: styles.kv }, el("span", { style: styles.key }, label), el("span", { style: ok ? styles.goodText : styles.warnText }, ok ? "ONLINE" : "WAITING")); }
function progressBar(value) { const width = `${Math.max(0, Math.min(1, Number(value ?? 0))) * 100}%`; return el("div", { style: styles.progressTrack }, el("div", { style: { ...styles.progressFill, width } })); }
function command(label, value) { return el("div", { style: styles.command }, el("div", { style: styles.commandLabel }, label), el("div", { style: styles.code }, value)); }

function countdownTo(timestamp) { const n = Number(timestamp ?? 0); if (!(n > 0)) return "—"; const remaining = n - Date.now(); return remaining >= 0 ? `${compactMs(remaining)} left` : `${compactMs(-remaining)} ago`; }
function batchThreadsText(t) { return `${Number(t?.hack ?? 0)}H / ${Number(t?.weakenHack ?? 0)}W / ${Number(t?.grow ?? 0)}G / ${Number(t?.weakenGrow ?? 0)}W`; }
function stageShort(name) { return name === "WEAKEN_HACK" ? "W1" : name === "WEAKEN_GROW" ? "W2" : name === "HACK" ? "H" : name === "GROW" ? "G" : String(name ?? "?"); }
function compactMs(value) { const sec = Math.max(0, Number(value ?? 0)) / 1000; if (!Number.isFinite(sec)) return "—"; if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`; const min = Math.floor(sec / 60); const rem = Math.floor(sec % 60); return min < 60 ? `${min}m ${rem}s` : `${Math.floor(min / 60)}h ${min % 60}m`; }
function msFmt(v) { const n = Number(v); return Number.isFinite(n) ? `${n.toFixed(0)} ms` : "—"; }
function signedMs(v) { const n = Number(v); return Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(0)} ms` : "—"; }
function signedNum(v, d = 3) { const n = Number(v); return Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(d)}` : "—"; }
function pctFine(v) { const n = Number(v); return Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : "—"; }
function pct(v) { return `${(Math.max(0, Number(v ?? 0)) * 100).toFixed(0)}%`; }
function num(v) { return Number(v ?? 0).toFixed(2); }
function moneyFmt(v) { const n = Math.max(0, Number(v ?? 0)); if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}t`; if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}b`; if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}m`; if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}k`; return `$${n.toFixed(0)}`; }
function ramFmt(v) { return `${Math.max(0, Number(v ?? 0)).toFixed(2)} GB`; }
function age(ts) { const n = Number(ts ?? 0); if (!n) return "never"; const sec = Math.max(0, (Date.now() - n) / 1000); if (sec < 60) return `${sec.toFixed(0)}s ago`; if (sec < 3600) return `${Math.floor(sec / 60)}m ago`; return `${Math.floor(sec / 3600)}h ago`; }
function duration(sec) { const n = Math.max(0, Number(sec ?? 0)); if (!Number.isFinite(n)) return "∞"; if (n < 60) return `${n.toFixed(0)}s`; if (n < 3600) return `${Math.floor(n / 60)}m ${Math.floor(n % 60)}s`; return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`; }
function parseMoney(value) { const text = String(value ?? "").trim().toLowerCase().replaceAll(",", "").replaceAll("$", ""); const match = text.match(/^([0-9]+(?:\.[0-9]+)?)([kmbt]?)$/); if (!match) return NaN; const multiplier = match[2] === "k" ? 1e3 : match[2] === "m" ? 1e6 : match[2] === "b" ? 1e9 : match[2] === "t" ? 1e12 : 1; return Number(match[1]) * multiplier; }

const styles = {
    app: { fontFamily: "monospace", color: "#d7e0ea", background: "#0b0f14", minHeight: "100%", padding: "13px", boxSizing: "border-box" },
    header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "5px 3px 12px", borderBottom: "1px solid #26303b" },
    eyebrow: { fontSize: "9px", letterSpacing: "2px", color: "#6c7f92" },
    title: { fontSize: "21px", fontWeight: 700, color: "#f3f7fb", marginTop: "2px" },
    subtitle: { fontSize: "10px", color: "#8998a8", marginTop: "3px" },
    badges: { display: "flex", gap: "5px", flexWrap: "wrap", justifyContent: "flex-end" },
    badge: { padding: "4px 6px", borderRadius: "4px", fontSize: "9px", fontWeight: 700, border: "1px solid #34404d" },
    badge_good: { color: "#8be9b4", borderColor: "#24543c", background: "#10241b" },
    badge_warn: { color: "#ffd479", borderColor: "#5f4821", background: "#281f0e" },
    badge_accent: { color: "#8ed0ff", borderColor: "#285276", background: "#102235" },
    badge_dim: { color: "#8593a1", background: "#151a20" },
    nav: { display: "flex", gap: "2px", padding: "8px 0" },
    navButton: { fontFamily: "monospace", border: 0, borderBottom: "2px solid transparent", background: "transparent", color: "#728191", padding: "6px 9px", cursor: "pointer", fontSize: "10px" },
    navActive: { color: "#e9f2fa", borderBottom: "2px solid #4fa3dc", background: "#101821" },
    content: { paddingTop: "1px" },
    heroGrid: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: "7px", marginBottom: "7px" },
    heroCard: { background: "#10161d", border: "1px solid #242f3a", borderRadius: "6px", padding: "9px" },
    heroLabel: { fontSize: "8px", color: "#708090", letterSpacing: "1px" },
    heroValue: { fontSize: "16px", color: "#f1f5f9", marginTop: "3px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    heroSub: { fontSize: "9px", color: "#7d8b99", marginTop: "3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    grid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "7px" },
    card: { background: "#10161d", border: "1px solid #242f3a", borderRadius: "6px", padding: "10px", minWidth: 0 },
    wide: { gridColumn: "1 / -1", marginBottom: "7px" },
    cardTitle: { color: "#91a8bb", fontSize: "9px", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", marginBottom: "6px" },
    kv: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "10px", padding: "3px 0", borderBottom: "1px solid #18212a" },
    key: { color: "#758595", fontSize: "9px", flex: "0 0 105px" },
    value: { color: "#d8e1e9", fontSize: "9px", textAlign: "right", overflowWrap: "anywhere" },
    note: { color: "#8796a5", fontSize: "9px", lineHeight: 1.4, marginTop: "6px", padding: "6px", background: "#0c1218", borderLeft: "2px solid #35566f" },
    controlGrid: { display: "grid", gridTemplateColumns: "1fr auto", gap: "12px", alignItems: "center" },
    controlActions: { display: "flex", gap: "5px", flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "520px" },
    compactGrid: { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "0 14px" },
    strategyTitle: { fontSize: "15px", fontWeight: 700, color: "#f0f5fa", marginBottom: "6px" },
    statGrid: { display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "5px" },
    stageStrip: { display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "5px", marginTop: "7px" },
    stat: { background: "#0c1218", border: "1px solid #1d2730", borderRadius: "5px", padding: "6px" },
    statLabel: { color: "#69798a", fontSize: "8px", textTransform: "uppercase" },
    statValue: { color: "#e8eef4", fontSize: "10px", marginTop: "3px" },
    targetForm: { display: "grid", gridTemplateColumns: "1fr auto auto", gap: "6px" },
    goalForm: { display: "grid", gridTemplateColumns: "1.1fr 1fr auto auto", gap: "6px" },
    multiControlGrid: { display: "grid", gridTemplateColumns: "1.15fr repeat(4,minmax(90px,0.75fr)) auto", gap: "6px", alignItems: "end", marginBottom: "7px" },
    controlField: { display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 },
    controlLabel: { color: "#708090", fontSize: "8px", textTransform: "uppercase", letterSpacing: "0.4px" },
    multiLaunch: { display: "flex", alignItems: "flex-end", paddingBottom: "1px" },
    input: { minWidth: 0, fontFamily: "monospace", color: "#d8e1e9", background: "#0b1117", border: "1px solid #2b3945", borderRadius: "4px", padding: "6px 7px", fontSize: "9px" },
    primaryButton: { fontFamily: "monospace", padding: "6px 8px", borderRadius: "4px", border: "1px solid #2e5c7d", background: "#12304a", color: "#bfe4ff", cursor: "pointer", whiteSpace: "nowrap", fontSize: "9px" },
    clearButton: { fontFamily: "monospace", padding: "6px 8px", borderRadius: "4px", border: "1px solid #5b4930", background: "#271e11", color: "#f0cf91", cursor: "pointer", whiteSpace: "nowrap", fontSize: "9px" },
    disabledButton: { opacity: 0.45, cursor: "default" },
    goalStatus: { color: "#9dc7e4", fontSize: "9px", marginTop: "5px" },
    progressTrack: { height: "5px", borderRadius: "5px", background: "#1a232c", overflow: "hidden", margin: "5px 0" },
    progressFill: { height: "100%", background: "#438ab8" },
    targetRow: { display: "grid", gridTemplateColumns: "34px 1.4fr 70px 110px 100px", gap: "7px", padding: "5px 3px", borderBottom: "1px solid #1a232c", fontSize: "9px" },
    hostRow: { display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr", gap: "8px", padding: "5px 3px", borderBottom: "1px solid #1a232c", fontSize: "9px" },
    rank: { color: "#5e88a6" },
    right: { textAlign: "right", color: "#9aabba" },
    workerRow: { display: "grid", gridTemplateColumns: "1.5fr 1fr 55px 100px", gap: "8px", padding: "5px 3px", borderBottom: "1px solid #1a232c", fontSize: "9px" },
    dimText: { color: "#8495a5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    goodText: { color: "#83d8a9", fontSize: "9px", fontWeight: 700 },
    warnText: { color: "#ffd479", fontSize: "9px", fontWeight: 700 },
    pipelineRows: { marginTop: "6px" },
    timeline: { marginTop: "8px" },
    timelineRow: { display: "grid", gridTemplateColumns: "28px 1fr 62px", gap: "7px", alignItems: "center", margin: "6px 0" },
    timelineLabel: { color: "#dbe5ee", fontWeight: 700, fontSize: "9px" },
    timelineTrack: { position: "relative", height: "14px" },
    timelineBaseline: { position: "absolute", left: 0, right: 0, top: "6px", height: "2px", background: "#24303b" },
    timelineMarkerPlanned: { position: "absolute", top: "2px", width: "8px", height: "8px", marginLeft: "-5px", borderRadius: "50%", border: "2px solid #8ed0ff", background: "#10161d" },
    timelineMarkerActual: { position: "absolute", top: "4px", width: "8px", height: "8px", marginLeft: "-4px", borderRadius: "50%", background: "#ffd479" },
    timelineError: { color: "#9fb0bf", fontSize: "8px", textAlign: "right" },
    details: { marginTop: "7px", borderTop: "1px solid #1d2832", paddingTop: "5px" },
    summary: { cursor: "pointer", color: "#8ea5b8", fontSize: "9px" },
    command: { marginTop: "7px" },
    commandLabel: { color: "#708090", fontSize: "8px", marginBottom: "2px" },
    code: { color: "#b8d6e8", background: "#0b1117", border: "1px solid #1d2832", borderRadius: "4px", padding: "4px 6px", fontSize: "8px" },
    footer: { display: "flex", justifyContent: "space-between", color: "#50606f", fontSize: "8px", padding: "8px 2px 0" },
};
