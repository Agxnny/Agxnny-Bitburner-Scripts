import { buildLiveAutoMultiDecision } from "/lib/automulti-live.js";
import { RuntimePort, readControllerState, readMultiTargetSchedulerState } from "/lib/runtime-state.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const STRESS_SCRIPT = "/diagnostics/multi-target-stress.js";
const STATE_FILE = "/data/automulti-controller-state.txt";
const LOOP_MS = 1_000;
const ASSESS_MS = 5_000;
const CLEAN_WAVES_BEFORE_VALIDATION = 3;
const VALIDATION_WAVES = 2;
const VALIDATION_TARGET_COUNT = 12;
const VALIDATION_HACK_FRACTION = 0.10;
const VALIDATION_GAP_MS = 200;
const VALIDATION_PREP_WAIT_MINUTES = 20;

/**
 * AUTOMULTI supervisory coordinator.
 *
 * It does not own worker timing ports. The normal controller and finite MULTI
 * runner remain the execution plane. This script owns the adaptive policy:
 * ASSESS -> RUN -> OBSERVE -> ADAPT, and can temporarily park production to
 * VALIDATE the next unproven global depth with the existing stress tester.
 *
 * Usage: run hacking/automulti-controller.js [money|balanced|xp] [validate|no-validate]
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    const quiet = isQuiet(ns);
    const args = positionalArgs(ns);
    const objective = String(args[0] ?? "money").trim().toLowerCase();
    const validationEnabled = String(args[1] ?? "validate").trim().toLowerCase() !== "no-validate";
    if (!["money", "balanced", "xp"].includes(objective)) {
        ns.tprint("[AUTOMULTI] Usage: run hacking/automulti-controller.js [money|balanced|xp] [validate|no-validate]");
        return;
    }
    if (ns.getHostname() !== "home") {
        ns.tprint("[AUTOMULTI] BLOCKED: run from home");
        return;
    }
    const duplicate = ns.ps("home").some((proc) => proc.filename === ns.getScriptName() && proc.pid !== ns.pid);
    if (duplicate) {
        ns.tprint("[AUTOMULTI] BLOCKED: another AUTOMULTI coordinator is already running");
        return;
    }

    const state = createState(objective, validationEnabled);
    let lastAssessAt = 0;
    let lastConfigSignature = "";
    let lastObservedRunId = "";
    let stressPid = 0;

    while (true) {
        const now = Date.now();
        const controller = readControllerState(ns);
        const multi = readMultiTargetSchedulerState(ns);
        observeCompletedWave(state, multi, (runId) => { lastObservedRunId = runId; }, lastObservedRunId);

        if (!controller) {
            updateState(state, "BLOCKED", "Controller state unavailable");
            await publish(ns, state);
            await ns.sleep(LOOP_MS);
            continue;
        }

        if (stressPid > 0) {
            if (ns.isRunning(stressPid, "home")) {
                updateState(state, "VALIDATING", `Stress validation running · PID ${stressPid}`);
                await publish(ns, state);
                await ns.sleep(LOOP_MS);
                continue;
            }
            stressPid = 0;
            state.cleanWavesSinceValidation = 0;
            lastAssessAt = 0;
            updateState(state, "ASSESS", "Validation finished; reassessing durable evidence");
        }

        const mode = String(controller.executionMode?.mode ?? "STANDBY").toUpperCase();
        const pending = String(controller.executionMode?.pending ?? "");
        const multiRunning = Boolean(controller.executionMode?.multiRunning);
        const safetyStopped = Boolean(controller.executionMode?.multiSafetyStopped);

        if (safetyStopped) {
            updateState(state, "SAFETY_STOP", String(controller.executionMode?.lastMessage ?? "MULTI safety stop"));
            await publish(ns, state);
            await ns.sleep(LOOP_MS);
            continue;
        }
        if (!["STANDBY", "MULTI"].includes(mode) || (pending && pending !== "STANDBY" && pending !== "MULTI")) {
            updateState(state, "BLOCKED", `Controller is ${pending ? `${mode} -> ${pending}` : mode}; AUTOMULTI only owns STANDBY/MULTI`);
            await publish(ns, state);
            await ns.sleep(LOOP_MS);
            continue;
        }

        if (now - lastAssessAt >= ASSESS_MS) {
            lastAssessAt = now;
            const live = buildLiveAutoMultiDecision(ns, objective);
            state.lastAssessmentAt = now;
            if (!live.ok || !live.decision?.config) {
                state.decision = live.decision ?? null;
                updateState(state, "BLOCKED", live.reason || live.decision?.reason || "No safe AUTOMULTI configuration");
                if (mode === "MULTI" && !pending) requestMode(ns, "STANDBY");
                await publish(ns, state);
                await ns.sleep(LOOP_MS);
                continue;
            }

            state.decision = live.decision;
            state.rankingSource = live.rankingSource;
            state.pool = { usableRam: live.pool.usableRam, hostCount: live.pool.hostCount };
            const config = live.decision.config;
            const signature = configSignature(config);
            const validationDue = validationEnabled
                && live.decision.shouldValidate
                && state.cleanWavesSinceValidation >= CLEAN_WAVES_BEFORE_VALIDATION;

            if (validationDue) {
                state.validationDepth = live.decision.validationDepth;
                if (mode === "MULTI" && !pending) {
                    requestMode(ns, "STANDBY");
                    updateState(state, "VALIDATE_PENDING", `Parking MULTI after ${state.cleanWavesSinceValidation} clean AUTO wave(s) to validate depth ${state.validationDepth}`);
                } else if (mode === "STANDBY" && !pending && !multiRunning) {
                    stressPid = launchValidation(ns, state.validationDepth);
                    if (stressPid > 0) updateState(state, "VALIDATING", `Validating depth ${state.validationDepth} · PID ${stressPid}`);
                    else updateState(state, "BLOCKED", `Could not launch depth ${state.validationDepth} stress validation`);
                }
            } else if (mode === "STANDBY" && !pending) {
                requestMulti(ns, config);
                lastConfigSignature = signature;
                updateState(state, "RUN", describeConfig(live.decision));
            } else if (mode === "MULTI") {
                if (signature !== lastConfigSignature) {
                    requestMulti(ns, config);
                    lastConfigSignature = signature;
                    updateState(state, multiRunning ? "ADAPT" : "RUN", `Queued next-wave AUTO config · ${describeConfig(live.decision)}`);
                } else {
                    updateState(state, multiRunning ? "OBSERVE" : "RUN", describeConfig(live.decision));
                }
            }
        }

        await publish(ns, state);
        if (!quiet) printState(ns, state);
        await ns.sleep(LOOP_MS);
    }
}

function observeCompletedWave(state, multi, setRunId, previousRunId) {
    const runId = String(multi?.runId ?? "");
    if (!runId || runId === previousRunId || String(multi?.status ?? "") !== "COMPLETE") return;
    const completed = Array.isArray(multi?.completed) ? multi.completed : [];
    const clean = completed.length > 0 && completed.every((entry) => entry?.healthy === true);
    state.observedWaves += 1;
    if (clean) state.cleanWavesSinceValidation += 1;
    else state.cleanWavesSinceValidation = 0;
    state.lastObservedRunId = runId;
    state.lastWaveClean = clean;
    state.lastWaveCompleted = completed.length;
    setRunId(runId);
}

function requestMulti(ns, config) {
    ns.writePort(RuntimePort.CONTROL_REQUESTS, JSON.stringify({
        action: "START_MULTI",
        profile: config.profile,
        targetCount: config.targetCount,
        globalDepth: config.globalDepth,
        hackPercent: config.hackPercent,
        stageGapMs: config.stageGapMs,
        requestedAt: Date.now(),
        source: "AUTOMULTI",
    }));
}
function requestMode(ns, mode) {
    ns.writePort(RuntimePort.CONTROL_REQUESTS, JSON.stringify({ action: "SET_EXECUTION_MODE", mode, requestedAt: Date.now(), source: "AUTOMULTI" }));
}
function launchValidation(ns, depth) {
    if (!(depth >= 2 && depth <= 12)) return 0;
    return ns.run(
        STRESS_SCRIPT,
        1,
        "mixed",
        depth,
        VALIDATION_WAVES,
        VALIDATION_TARGET_COUNT,
        VALIDATION_HACK_FRACTION,
        VALIDATION_GAP_MS,
        VALIDATION_PREP_WAIT_MINUTES,
        depth,
        "--quiet",
    );
}

function createState(objective, validationEnabled) {
    return {
        version: 1,
        model: "AUTOMULTI_CONTROLLER_V1",
        objective,
        validationEnabled,
        phase: "ASSESS",
        reason: "Starting AUTOMULTI assessment",
        decision: null,
        rankingSource: "",
        pool: null,
        validationDepth: 0,
        observedWaves: 0,
        cleanWavesSinceValidation: 0,
        lastObservedRunId: "",
        lastWaveClean: false,
        lastWaveCompleted: 0,
        lastAssessmentAt: 0,
        startedAt: Date.now(),
        updatedAt: Date.now(),
    };
}
function updateState(state, phase, reason) { state.phase = phase; state.reason = reason; state.updatedAt = Date.now(); }
async function publish(ns, state) { state.updatedAt = Date.now(); await ns.write(STATE_FILE, JSON.stringify(state), "w"); }
function configSignature(config) { return [config.profile, config.targetCount, config.globalDepth, Number(config.hackPercent).toFixed(3), config.stageGapMs].join("|"); }
function describeConfig(decision) {
    const c = decision.config;
    return `${c.profile.toUpperCase()} · effective ${decision.effectiveDepth}/${decision.possibleDepth} possible · top ${c.targetCount} · hack ${Number(c.hackPercent).toFixed(1)}% · gap ${c.stageGapMs}ms`;
}
function printState(ns, state) {
    ns.clearLog();
    ns.print("=== AUTOMULTI CONTROLLER ===");
    ns.print(`Phase: ${state.phase} · ${state.objective.toUpperCase()}`);
    if (state.decision) ns.print(`Depth: possible ${state.decision.possibleDepth} · proven ${state.decision.provenDepth} · effective ${state.decision.effectiveDepth}`);
    ns.print(`Waves: ${state.observedWaves} observed · ${state.cleanWavesSinceValidation} clean since validation`);
    ns.print(`Reason: ${state.reason}`);
}
