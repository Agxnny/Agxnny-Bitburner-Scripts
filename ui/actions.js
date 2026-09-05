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

const model = {
    pendingTest: null,
    pendingGoal: null,
    pendingController: null,
    pendingMultiRun: null,
    actionStatus: "Ready",
    goalStatus: "Ready",
    controllerStatus: "Ready",
    multiStatus: "Ready · finite tests require STANDBY",
    fields: {
        goal: "",
        goalLabel: "",
        manualTarget: "",
        multiProfile: "money",
        multiTargetCount: "6",
        multiDepth: "3",
        multiHackPercent: "10",
        multiStageGap: "200",
    },
};

export function field(name) { return String(model.fields[name] ?? ""); }
export function setField(name, value) { model.fields[name] = String(value ?? ""); touchState(); }
export function status(name) { return String(model[name] ?? ""); }
export function queueTest(id, label) { model.pendingTest = { id, label }; touchState(); }
export function queueGoal(action) { model.pendingGoal = action; touchState(); }
export function queueController(action) { model.pendingController = action; touchState(); }
export function queueMultiRun() { model.pendingMultiRun = currentMultiRequest(); touchState(); }
export function currentMultiRequest() {
    return {
        profile: field("multiProfile"),
        targetCount: field("multiTargetCount"),
        globalDepth: field("multiDepth"),
        hackPercent: field("multiHackPercent"),
        stageGapMs: field("multiStageGap"),
    };
}

/** Async Netscript side of the request bridge. React callbacks never call this. */
export async function processPendingActions(ns, now) {
    let refresh = false;
    if (model.pendingTest) {
        const test = model.pendingTest;
        model.pendingTest = null;
        ns.writePort(TEST_REQUEST_PORT, JSON.stringify({ test: test.id, requestedAt: now }));
        model.actionStatus = `${test.label} queued`;
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

    if (model.pendingGoal) {
        const action = model.pendingGoal;
        model.pendingGoal = null;
        await applyGoalAction(ns, action, now);
        touchState();
        refresh = true;
    }
    if (refresh) refreshSnapshot(ns);
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
