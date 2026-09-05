import {
    RuntimePort,
    isControllerStateStale,
    publishManualMoneyGoalState,
    readControllerState,
} from "/lib/runtime-state.js";
import { parseMoney, moneyFmt } from "/ui/components/format.js";
import { refreshSnapshot, touchState } from "/ui/state.js";

const TEST_REQUEST_PORT = 6;
const MANUAL_GOAL_CONFIG = "/data/manual-money-goal.txt";
const MULTI_TARGET_RUNNER = "/hacking/multi-target-runner.js";
const OVERLAP_VALIDATOR = "/diagnostics/multi-overlap-validate.js";
const OVERLAP_MIXED = "/diagnostics/multi-overlap-mixed.js";

const model = {
    pendingTest: null,
    pendingDiagnostic: null,
    pendingGoal: null,
    pendingController: null,
    pendingMultiRun: null,
    pendingValidationRun: null,
    diagnosticActivity: { state: "IDLE", label: "", script: "", pid: 0, startedAt: 0, finishedAt: 0 },
    actionStatus: "Ready",
    goalStatus: "Ready",
    controllerStatus: "Ready",
    multiStatus: "Ready · finite tests require STANDBY",
    validationStatus: "Ready · overlap validation requires STANDBY",
    fields: {
        goal: "",
        goalLabel: "",
        manualTarget: "",
        multiProfile: "money",
        multiTargetCount: "6",
        multiDepth: "3",
        multiHackPercent: "10",
        multiStageGap: "200",
        validationTarget: "mixed",
        validationWaves: "2",
        validationHackPercent: "10",
        validationStageGap: "200",
    },
};

export function field(name) { return String(model.fields[name] ?? ""); }
export function setField(name, value) { model.fields[name] = String(value ?? ""); touchState(); }
export function status(name) { return String(model[name] ?? ""); }
export function diagnosticActivity() { return { ...model.diagnosticActivity }; }
export function queueTest(id, label) { model.pendingTest = { id, label }; touchState(); }
export function queueDiagnostic(script, args = [], label = "Diagnostic") {
    if (model.diagnosticActivity.state === "RUNNING") {
        model.actionStatus = `Busy · ${model.diagnosticActivity.label} still running`;
        touchState();
        return;
    }
    model.pendingDiagnostic = { script, args, label };
    model.actionStatus = `${label} queued`;
    touchState();
}
export function queueGoal(action) { model.pendingGoal = action; touchState(); }
export function queueController(action) { model.pendingController = action; touchState(); }
export function queueMultiRun() { model.pendingMultiRun = currentMultiRequest(); touchState(); }
export function queueValidationRun() { model.pendingValidationRun = currentValidationRequest(); touchState(); }
export function currentMultiRequest() {
    return {
        profile: field("multiProfile"),
        targetCount: field("multiTargetCount"),
        globalDepth: field("multiDepth"),
        hackPercent: field("multiHackPercent"),
        stageGapMs: field("multiStageGap"),
    };
}
export function currentValidationRequest() {
    return {
        target: field("validationTarget"),
        waves: field("validationWaves"),
        hackPercent: field("validationHackPercent"),
        stageGapMs: field("validationStageGap"),
    };
}

/** Async Netscript side of the request bridge. React callbacks never call this. */
export async function processPendingActions(ns, now) {
    let refresh = false;
    updateDiagnosticActivity(ns, now);

    if (model.pendingTest) {
        const test = model.pendingTest;
        model.pendingTest = null;
        ns.writePort(TEST_REQUEST_PORT, JSON.stringify({ test: test.id, requestedAt: now }));
        model.actionStatus = `${test.label} queued`;
        touchState();
    }

    if (model.pendingDiagnostic) {
        const request = model.pendingDiagnostic;
        model.pendingDiagnostic = null;
        const pid = ns.run(request.script, 1, ...request.args);
        if (pid > 0) {
            model.diagnosticActivity = { state: "RUNNING", label: request.label, script: request.script, pid, startedAt: now, finishedAt: 0 };
            model.actionStatus = `${request.label} running · PID ${pid}`;
        } else {
            model.diagnosticActivity = { state: "FAILED", label: request.label, script: request.script, pid: 0, startedAt: now, finishedAt: now };
            model.actionStatus = `${request.label} failed to start`;
        }
        touchState();
    }

    if (model.pendingController) {
        const action = model.pendingController;
        model.pendingController = null;
        ns.writePort(RuntimePort.CONTROL_REQUESTS, JSON.stringify({ ...action, requestedAt: now }));
        model.controllerStatus = controllerStatusText(action);
        touchState();
    }

    if (model.pendingMultiRun) {
        const request = model.pendingMultiRun;
        model.pendingMultiRun = null;
        model.multiStatus = launchMultiTargetRun(ns, request).message;
        touchState();
        refresh = true;
    }

    if (model.pendingValidationRun) {
        const request = model.pendingValidationRun;
        model.pendingValidationRun = null;
        model.validationStatus = launchValidationRun(ns, request).message;
        touchState();
        refresh = true;
    }

    if (model.pendingGoal) {
        const action = model.pendingGoal;
        model.pendingGoal = null;
        await applyGoalAction(ns, action, now);
        touchState();
        refresh = true;
    }
    if (refresh) refreshSnapshot(ns);
}

function updateDiagnosticActivity(ns, now) {
    const activity = model.diagnosticActivity;
    if (activity.state !== "RUNNING" || !(activity.pid > 0)) return;
    if (ns.isRunning(activity.pid, "home")) return;
    model.diagnosticActivity = { ...activity, state: "COMPLETE", finishedAt: now };
    model.actionStatus = `${activity.label} complete`;
    touchState();
}

function launchValidationRun(ns, request) {
    const controller = readControllerState(ns);
    const mode = String(controller?.executionMode?.mode ?? "STANDBY").toUpperCase();
    const pending = String(controller?.executionMode?.pending ?? "").trim();
    if (!controller || isControllerStateStale(controller)) return fail("controller state unavailable/stale");
    if (mode !== "STANDBY" || pending) return fail(`validation requires STANDBY (${pending ? `${mode} → ${pending}` : mode})`);
    if (Number(controller.execution?.activeJobs ?? 0) > 0) return fail("controller workers are still draining");
    if (ns.scriptRunning(OVERLAP_VALIDATOR, "home") || ns.scriptRunning(OVERLAP_MIXED, "home")) return fail("overlap validation is already running");

    const parsed = validateValidationRequest(request);
    if (!parsed.ok) return fail(parsed.reason);
    const v = parsed.value;
    const mixed = v.target === "mixed";
    const all = v.target === "all";
    const pid = mixed || all
        ? ns.run(OVERLAP_MIXED, 1, all ? "all" : "validate2", v.waves, v.hackPercent / 100, v.stageGapMs, "--quiet")
        : ns.run(OVERLAP_VALIDATOR, 1, v.target, v.waves, v.hackPercent / 100, v.stageGapMs, "--allow-unqualified", "--quiet");
    if (pid <= 0) return { ok: false, message: "Launch failed · not enough home RAM or validator unavailable" };
    const label = mixed ? "Mixed VALIDATE2" : all ? "All prepared" : v.target;
    return { ok: true, message: `${label} overlap validation started quietly · ${v.waves} wave(s) · PID ${pid}` };
}

function validateValidationRequest(request) {
    const target = String(request.target ?? "mixed").trim();
    const waves = Math.floor(Number(request.waves));
    const hackPercent = Number(request.hackPercent);
    const stageGapMs = Math.floor(Number(request.stageGapMs));
    if (!target) return { ok: false, reason: "select a validation target" };
    if (!Number.isInteger(waves) || waves < 1 || waves > 6) return { ok: false, reason: "waves must be 1–6" };
    if (!Number.isFinite(hackPercent) || hackPercent < 0.1 || hackPercent > 50) return { ok: false, reason: "hack % must be 0.1–50" };
    if (!Number.isInteger(stageGapMs) || stageGapMs < 75 || stageGapMs > 1000) return { ok: false, reason: "stage gap must be 75–1000 ms" };
    return { ok: true, value: { target, waves, hackPercent, stageGapMs } };
}

function launchMultiTargetRun(ns, request) {
    const controller = readControllerState(ns);
    const mode = String(controller?.executionMode?.mode ?? "STANDBY").toUpperCase();
    const pending = String(controller?.executionMode?.pending ?? "").trim();
    if (!controller || isControllerStateStale(controller)) return fail("controller state unavailable/stale");
    if (mode !== "STANDBY" || pending) return fail(`finite wave requires STANDBY (${pending ? `${mode} → ${pending}` : mode})`);
    if (Number(controller.execution?.activeJobs ?? 0) > 0) return fail("controller workers are still draining");
    if (ns.scriptRunning(MULTI_TARGET_RUNNER, "home")) return fail("multi-target wave already running");

    const parsed = validateMultiRequest(request);
    if (!parsed.ok) return fail(parsed.reason);
    const v = parsed.value;
    const pid = ns.run(MULTI_TARGET_RUNNER, 1, v.profile, v.targetCount, v.hackPercent / 100, v.stageGapMs, v.globalDepth, "--quiet");
    if (pid <= 0) return { ok: false, message: "Launch failed · not enough home RAM or runner unavailable" };
    return { ok: true, message: `Finite ${v.profile.toUpperCase()} · ${v.globalDepth} batches across top ${v.targetCount} · PID ${pid}` };
}

function fail(reason) { return { ok: false, message: `Blocked · ${reason}` }; }

function validateMultiRequest(request) {
    const profile = String(request.profile ?? "money").toLowerCase();
    const targetCount = Math.floor(Number(request.targetCount));
    const globalDepth = Math.floor(Number(request.globalDepth));
    const hackPercent = Number(request.hackPercent);
    const stageGapMs = Math.floor(Number(request.stageGapMs));
    if (!["money", "balanced", "xp"].includes(profile)) return { ok: false, reason: "invalid profile" };
    if (!Number.isInteger(targetCount) || targetCount < 2 || targetCount > 12) return { ok: false, reason: "targets must be 2–12" };
    if (!Number.isInteger(globalDepth) || globalDepth < 2 || globalDepth > 12) return { ok: false, reason: "live batches must be 2–12" };
    if (globalDepth > targetCount) return { ok: false, reason: "live batches cannot exceed target count" };
    if (!Number.isFinite(hackPercent) || hackPercent < 0.1 || hackPercent > 90) return { ok: false, reason: "hack % must be 0.1–90" };
    if (!Number.isInteger(stageGapMs) || stageGapMs < 75 || stageGapMs > 5000) return { ok: false, reason: "stage gap must be 75–5000 ms" };
    return { ok: true, value: { profile, targetCount, globalDepth, hackPercent, stageGapMs } };
}

async function applyGoalAction(ns, action, now) {
    if (action.type === "clear") {
        const state = { version: 1, active: false, targetCash: 0, title: "", updatedAt: now, clearedAt: now };
        await ns.write(MANUAL_GOAL_CONFIG, JSON.stringify(state), "w");
        publishManualMoneyGoalState(ns, state);
        model.goalStatus = "Goal cleared · automatic spending enabled";
        return;
    }
    const targetCash = parseMoney(action.value);
    if (!(targetCash > 0) || !Number.isFinite(targetCash)) {
        model.goalStatus = "Invalid goal · try 50m, 1.5b, or 25000000";
        return;
    }
    const title = String(action.label ?? "").trim() || "Manual cash goal";
    const state = { version: 1, active: true, targetCash, title, updatedAt: now, setAt: now };
    await ns.write(MANUAL_GOAL_CONFIG, JSON.stringify(state), "w");
    publishManualMoneyGoalState(ns, state);
    model.goalStatus = `Goal ${moneyFmt(targetCash)} · automatic spending locked`;
}

function controllerStatusText(action) {
    if (action.action === "PREP_TARGET") return `Prep queued for ${action.target || "current target"}`;
    if (action.action === "RESUME_AUTO") return "Resume selected execution mode queued";
    if (action.action === "SET_MANUAL_TARGET") return `Manual target queued: ${action.target}`;
    if (action.action === "CLEAR_MANUAL_TARGET") return "Automatic target selection queued";
    if (action.action === "START_MULTI") return `Multi controller queued · ${String(action.profile ?? "money").toUpperCase()} · ${action.globalDepth} live`;
    if (action.action === "SET_EXECUTION_MODE") return `${modeLabel(action.mode)} queued`;
    return "Controller request queued";
}

function modeLabel(mode) {
    const m = String(mode ?? "STANDBY").toUpperCase();
    if (m === "MULTI") return "MULTI HWGW";
    if (m === "PIPELINE") return "PIPELINE HWGW";
    if (m === "BATCH") return "BATCH HWGW";
    if (m === "HGW") return "NORMAL HGW";
    return "STANDBY";
}
