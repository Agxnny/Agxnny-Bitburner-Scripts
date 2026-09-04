import {
    RuntimePort,
    isControllerStateStale,
    publishManualMoneyGoalState,
    readBatchState,
    readCloudPurchaseState,
    readControllerState,
    readEconomyState,
    readEconomyTargetState,
    readManualMoneyGoalState,
    readPlannerState,
    readRootState,
    readTacticalPlanState,
} from "/lib/runtime-state.js";
import { readTelemetryState } from "/lib/telemetry.js";

const TEST_REQUEST_PORT = 6;
const MANUAL_GOAL_CONFIG = "/data/manual-money-goal.txt";
const TABS = Object.freeze(["Overview", "Targets", "Economy", "Network", "Diagnostics"]);
const UI_TICK_MS = 100;
const DATA_REFRESH_MS = 1000;

let activeTab = "Overview";
let requestedTab = "Overview";
let requestedTest = null;
let requestedGoalAction = null;
let requestedControllerAction = null;
let actionStatus = "Ready";
let goalStatus = "Ready";
let controllerActionStatus = "Ready";
let goalInput = "";
let goalLabelInput = "";
let manualTargetInput = "";
let cachedState = null;
let lastDataRefresh = 0;
let dirty = true;

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.ui.openTail();
    ns.ui.setTailTitle("Agxnny Control Plane");
    ns.ui.resizeTail(1120, 780);

    while (true) {
        const now = Date.now();

        if (!cachedState || now - lastDataRefresh >= DATA_REFRESH_MS) {
            cachedState = snapshot(ns);
            lastDataRefresh = now;
            dirty = true;
        }

        if (requestedTab !== activeTab) {
            activeTab = requestedTab;
            dirty = true;
        }

        if (requestedTest) {
            const test = requestedTest;
            requestedTest = null;
            ns.writePort(TEST_REQUEST_PORT, JSON.stringify({ test: test.id, requestedAt: now }));
            actionStatus = `${test.label} queued`;
            dirty = true;
        }

        if (requestedControllerAction) {
            const action = requestedControllerAction;
            requestedControllerAction = null;
            ns.writePort(RuntimePort.CONTROL_REQUESTS, JSON.stringify({ ...action, requestedAt: now }));
            controllerActionStatus = controllerStatusText(action);
            dirty = true;
        }

        if (requestedGoalAction) {
            const action = requestedGoalAction;
            requestedGoalAction = null;
            await applyGoalAction(ns, action, now);
            cachedState = snapshot(ns);
            lastDataRefresh = now;
            dirty = true;
        }

        if (dirty) {
            ns.clearLog();
            ns.printRaw(renderApp(cachedState));
            dirty = false;
        }

        await ns.sleep(UI_TICK_MS);
    }
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
    };
}

async function applyGoalAction(ns, action, now) {
    if (action.type === "clear") {
        const state = { version: 1, active: false, targetCash: 0, title: "", updatedAt: now, clearedAt: now };
        await ns.write(MANUAL_GOAL_CONFIG, JSON.stringify(state), "w");
        publishManualMoneyGoalState(ns, state);
        goalStatus = "Money goal cleared · automatic spending enabled";
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
    goalStatus = `Goal set to ${moneyFmt(targetCash)} · automatic spending locked`;
}

function controllerStatusText(action) {
    if (action.action === "PREP_TARGET") return `Prep request queued for ${action.target || "current target"}`;
    if (action.action === "RESUME_AUTO") return "Resume automatic execution request queued";
    if (action.action === "SET_MANUAL_TARGET") return `Manual target request queued: ${action.target}`;
    if (action.action === "CLEAR_MANUAL_TARGET") return "Automatic target selection request queued";
    if (action.action === "SET_EXECUTION_MODE") return `${action.mode === "BATCH" ? "Synchronized HWGW batch" : "Normal HGW"} mode request queued`;
    return "Controller request queued";
}

function renderApp(s) {
    return el("div", { style: styles.app },
        header(s),
        nav(),
        el("div", { style: styles.content }, activeView(s)),
        el("div", { style: styles.footer },
            el("span", null, "CONTROL PLANE"),
            el("span", null, "Workers: remote only"),
            el("span", null, `Planner ${age(s.planner?.updatedAt)}`),
        ),
    );
}

function header(s) {
    const c = s.controller ?? {};
    const live = Boolean(s.controller) && !isControllerStateStale(s.controller);
    const locked = Boolean(s.manualGoal?.active);
    const prep = c.prep ?? {};
    const executionMode = c.executionMode?.mode ?? "HGW";
    const manualTarget = c.targetControl?.mode === "MANUAL";

    return el("div", { style: styles.header },
        el("div", null,
            el("div", { style: styles.eyebrow }, "AGXNNY AUTOMATION"),
            el("div", { style: styles.title }, "Bitburner Control Plane"),
            el("div", { style: styles.subtitle }, c.hostname
                ? `${c.hostname} • ${manualTarget ? "manual target" : "automatic target"}`
                : "Waiting for controller target"),
        ),
        el("div", { style: styles.badges },
            badge(live ? "CONTROLLER ONLINE" : "CONTROLLER WAITING", live ? "good" : "dim"),
            badge(executionMode === "BATCH" ? "BATCH HWGW" : "NORMAL HGW", executionMode === "BATCH" ? "accent" : "dim"),
            badge(String(c.phase ?? "BOOTING"), live ? "accent" : "dim"),
            manualTarget ? badge("MANUAL TARGET", "accent") : null,
            prep.active ? badge(`PREP ${prep.stage || "ACTIVE"}`, "warn") : null,
            prep.hold ? badge("PREPARED HOLD", "good") : null,
            c.executionMode?.awaitingReview ? badge("POST-BATCH REVIEW", "warn") : null,
            badge(locked ? "SPENDING LOCKED" : "AUTO SPEND", locked ? "warn" : "good"),
        ),
    );
}

function nav() {
    return el("div", { style: styles.nav }, ...TABS.map((tab) => el("button", {
        key: tab,
        onClick: () => { requestedTab = tab; },
        style: { ...styles.navButton, ...(activeTab === tab ? styles.navActive : {}) },
    }, tab)));
}

function activeView(s) {
    if (activeTab === "Targets") return targetsView(s);
    if (activeTab === "Economy") return economyView(s);
    if (activeTab === "Network") return networkView(s);
    if (activeTab === "Diagnostics") return diagnosticsView(s);
    return overviewView(s);
}

function overviewView(s) {
    const c = s.controller ?? {};
    const m = c.money ?? {};
    const sec = c.security ?? {};
    const exec = c.execution ?? {};
    const tele = s.telemetry ?? {};
    const batch = s.batch ?? {};
    const executionMode = c.executionMode?.mode ?? "HGW";
    const moneyProgress = Number(m.max ?? 0) > 0 ? Number(m.current ?? 0) / Number(m.max ?? 1) : 0;

    return el("div", null,
        el("div", { style: styles.heroGrid },
            heroMetric("TARGET", c.hostname ?? "waiting", `${c.phase ?? "—"} / ${c.action ?? "—"}`),
            heroMetric("INCOME · 5M", `${moneyFmt(tele.incomePerSecond5m)}/s`, `${Number(tele.hackEvents ?? 0)} hack events`),
            heroMetric("REMOTE RAM", ramFmt(exec.usableRam), `${Number(exec.hostCount ?? 0)} execution hosts`),
            heroMetric("EXECUTION", executionMode === "BATCH" ? "BATCH HWGW" : "NORMAL HGW", batch.status ? `${batch.status} · ${batch.target || "no target"}` : "no batch state"),
        ),
        card("Execution mode", executionModeControls(s), true),
        card("Target prep controls", prepControls(s), true),
        grid(
            card("Active target", el("div", null,
                kv("Target mode", c.targetControl?.mode ?? "AUTO"),
                kv("Desired money", pct(m.desiredPercent)),
                progressBar(moneyProgress, `${pct(moneyProgress)} of server max`),
                kv("Money", `${moneyFmt(m.current)} / ${moneyFmt(m.max)}`),
                kv("Security", `${num(sec.current)} / ${num(sec.minimum)}`),
                kv("Tactical", c.tactical?.status ?? "waiting"),
                note(c.reason ?? "Waiting for controller state"),
            )),
            card("Execution", executionSummary(s)),
            card("Economy", economySummary(s)),
            card("System health", healthSummary(s)),
        ),
    );
}

function executionModeControls(s) {
    const mode = s.controller?.executionMode?.mode ?? "HGW";
    const executionMode = s.controller?.executionMode ?? {};
    const batch = s.batch ?? {};
    const batchThreads = batch.threads ?? {};

    return el("div", null,
        el("div", { style: styles.controlGrid },
            el("div", null,
                kv("Current mode", mode === "BATCH" ? "SYNCHRONIZED HWGW" : "NORMAL SEQUENTIAL HGW"),
                kv("Batch gap", `${Number(executionMode.batchGapMs ?? 200)} ms`),
                kv("Review barrier", executionMode.awaitingReview ? "WAITING FOR STRATEGIC REVIEW" : "READY"),
            ),
            el("div", { style: styles.controlActions },
                el("button", {
                    disabled: mode === "HGW",
                    onClick: () => { requestedControllerAction = { action: "SET_EXECUTION_MODE", mode: "HGW" }; },
                    style: { ...styles.clearButton, ...(mode === "HGW" ? styles.disabledButton : {}) },
                }, "Use normal HGW"),
                el("button", {
                    disabled: mode === "BATCH",
                    onClick: () => { requestedControllerAction = { action: "SET_EXECUTION_MODE", mode: "BATCH" }; },
                    style: { ...styles.primaryButton, ...(mode === "BATCH" ? styles.disabledButton : {}) },
                }, "Use batched HWGW"),
            ),
        ),
        el("div", { style: styles.goalHint }, "Batch mode prepares the selected strategy target, launches one synchronized HWGW batch, waits for the full batch to recover, then requires a fresh planner/economy review before another batch can start."),
        el("div", { style: styles.goalStatus }, executionMode.lastMessage || controllerActionStatus),
        batch.status ? el("div", { style: styles.miniGrid },
            kv("Batch status", batch.status),
            kv("Batch target", batch.target || "—"),
            kv("Threads", `${Number(batchThreads.hack ?? 0)}H / ${Number(batchThreads.weakenHack ?? 0)}W / ${Number(batchThreads.grow ?? 0)}G / ${Number(batchThreads.weakenGrow ?? 0)}W`),
        ) : null,
    );
}

function prepControls(s) {
    const c = s.controller ?? {};
    const prep = c.prep ?? {};
    const target = String(c.hostname ?? "");
    const executionMode = c.executionMode?.mode ?? "HGW";
    const mode = prep.hold ? "PREPARED / HOLDING" : prep.active ? `PREP ${prep.stage || "ACTIVE"}` : executionMode === "BATCH" ? "AUTOMATIC BATCH MODE" : "AUTOMATIC HGW";
    const noTarget = !target;

    return el("div", null,
        el("div", { style: styles.controlGrid },
            el("div", null,
                kv("Target", target || "waiting"),
                kv("Mode", mode),
                kv("Goal", "100% money → minimum security"),
            ),
            el("div", { style: styles.controlActions },
                el("button", {
                    disabled: noTarget,
                    onClick: () => { requestedControllerAction = { action: "PREP_TARGET", target }; },
                    style: { ...styles.primaryButton, ...(noTarget ? styles.disabledButton : {}) },
                }, "Prep target to 100%"),
                el("button", {
                    onClick: () => { requestedControllerAction = { action: "RESUME_AUTO" }; },
                    style: styles.clearButton,
                }, executionMode === "BATCH" ? "Resume auto batching" : "Resume auto HGW"),
            ),
        ),
        el("div", { style: styles.goalHint }, "Manual prep keeps growing even while security rises, then weakens to minimum and holds the target. Resume returns to the currently selected execution mode."),
        el("div", { style: styles.goalStatus }, prep.lastMessage || controllerActionStatus),
    );
}

function executionSummary(s) {
    const c = s.controller ?? {};
    const exec = c.execution ?? {};
    const mode = c.executionMode ?? {};
    const batch = s.batch ?? {};
    const final = batch.final ?? {};
    return el("div", null,
        kv("Policy", "REMOTE ONLY"),
        kv("Mode", mode.mode ?? "HGW"),
        kv("Active jobs", String(exec.activeJobs ?? 0)),
        kv("Active threads", String(exec.activeThreads ?? 0)),
        kv("Usable RAM", ramFmt(exec.usableRam)),
        kv("Batch state", batch.status ?? "idle"),
        mode.awaitingReview ? kv("Review", "WAITING") : null,
        batch.status === "COMPLETE" ? kv("Recovery", `${pct(final.moneyPercent)} money / +${num(final.securityDelta)} sec`) : null,
        note(mode.lastMessage ?? "Execution controller waiting"),
    );
}

function targetsView(s) {
    const selected = s.economic?.selectedTarget;
    const rankings = Array.isArray(s.economic?.rankings) ? s.economic.rankings : [];
    const rejected = Array.isArray(s.economic?.rejectedTargets) ? s.economic.rejectedTargets : [];
    const targetControl = s.controller?.targetControl ?? {};

    return el("div", null,
        card("Manual target override", el("div", null,
            el("div", { style: styles.targetForm },
                el("input", {
                    value: manualTargetInput,
                    placeholder: "Hostname · e.g. foodnstuff",
                    onChange: (event) => { manualTargetInput = String(event.target.value ?? ""); },
                    onKeyDown: (event) => {
                        if (event.key === "Enter" && manualTargetInput.trim()) {
                            requestedControllerAction = { action: "SET_MANUAL_TARGET", target: manualTargetInput.trim() };
                        }
                    },
                    style: styles.input,
                }),
                el("button", {
                    disabled: !manualTargetInput.trim(),
                    onClick: () => {
                        const target = manualTargetInput.trim();
                        if (target) requestedControllerAction = { action: "SET_MANUAL_TARGET", target };
                    },
                    style: { ...styles.primaryButton, ...(!manualTargetInput.trim() ? styles.disabledButton : {}) },
                }, "Set manual target"),
                el("button", {
                    onClick: () => { requestedControllerAction = { action: "CLEAR_MANUAL_TARGET" }; },
                    style: styles.clearButton,
                }, "Clear / auto target"),
            ),
            el("div", { style: styles.goalHint }, "Manual targeting overrides only the controller hostname. Clear it to return to the economic selector. Target changes wait for current workers/tactical analysis/batch work to finish."),
            el("div", { style: styles.goalStatus }, targetControl.lastMessage || controllerActionStatus),
            el("div", { style: styles.miniGrid },
                kv("Controller mode", targetControl.mode ?? "AUTO"),
                kv("Active target", s.controller?.hostname ?? "waiting"),
                kv("Economic target", selected?.hostname ?? "waiting"),
            ),
        ), true),
        selected ? card("Selected economic strategy", el("div", null,
            el("div", { style: styles.strategyTitle }, `${selected.hostname} · ${pct(selected.moneyTargetPercent)} money`),
            el("div", { style: styles.strategyStats },
                stat("Prep", duration(selected.prepSeconds)),
                stat("Weighted", duration(selected.weightedPrepSeconds)),
                stat("Income", `${moneyFmt(selected.steadyIncomePerSecond)}/s`),
                stat("Economic ETA", duration(selected.economicEtaSeconds)),
            ),
            note(selected.reason ?? "No cached reason"),
        ), true) : card("Selected economic strategy", note("Waiting for economic target state."), true),
        card("Economic ranking", rankings.length
            ? el("div", null, ...rankings.slice(0, 10).map((r, i) => targetRow(r, i)))
            : note("No economic ranking available yet."), true),
        card("Filtered targets", rejected.length
            ? el("div", null, ...rejected.slice(0, 8).map((r) => kv(String(r.hostname), String(r.reason ?? "filtered"))))
            : note("No targets currently filtered by the cash-relative value rule."), true),
    );
}

function economyView(s) {
    const e = s.economy ?? {};
    const goal = e.goal ?? {};
    const manual = s.manualGoal ?? {};
    const purchase = s.purchase ?? {};
    return el("div", null,
        card("Money goal controls", el("div", null,
            el("div", { style: styles.goalForm },
                el("input", {
                    value: goalInput,
                    placeholder: "Target cash · e.g. 50m or 1.5b",
                    onChange: (event) => { goalInput = String(event.target.value ?? ""); },
                    onKeyDown: (event) => {
                        if (event.key === "Enter") requestedGoalAction = { type: "set", value: goalInput, label: goalLabelInput };
                    },
                    style: styles.input,
                }),
                el("input", {
                    value: goalLabelInput,
                    placeholder: "Optional label",
                    onChange: (event) => { goalLabelInput = String(event.target.value ?? ""); },
                    onKeyDown: (event) => {
                        if (event.key === "Enter") requestedGoalAction = { type: "set", value: goalInput, label: goalLabelInput };
                    },
                    style: styles.input,
                }),
                el("button", {
                    onClick: () => { requestedGoalAction = { type: "set", value: goalInput, label: goalLabelInput }; },
                    style: styles.primaryButton,
                }, "Set money goal"),
                el("button", {
                    onClick: () => { requestedGoalAction = { type: "clear" }; },
                    style: styles.clearButton,
                }, "Clear goal / auto spend"),
            ),
            el("div", { style: styles.goalHint }, "Accepts plain amounts or k / m / b / t suffixes. Setting a goal immediately locks automated cloud spending."),
            el("div", { style: styles.goalStatus }, goalStatus),
        ), true),
        grid(
            card("Active money goal", el("div", null,
                kv("Mode", e.mode ?? "waiting"),
                kv("Goal", goal.title ?? "No goal"),
                kv("Current cash", moneyFmt(e.cash)),
                kv("Remaining", moneyFmt(goal.remaining)),
                kv("Ready", goal.ready ? "YES" : "NO"),
            )),
            card("Savings lock", el("div", null,
                kv("Status", manual.active ? "ACTIVE" : "OFF"),
                kv("Target", manual.active ? moneyFmt(manual.targetCash) : "—"),
                kv("Label", manual.title || "—"),
                kv("Auto cloud spend", manual.active ? "BLOCKED" : "ENABLED"),
            )),
            card("Cloud capacity automation", el("div", null,
                kv("Status", purchase.status ?? "No state"),
                kv("Action", purchase.action ?? "NONE"),
                kv("Server", purchase.hostname || "—"),
                kv("RAM", purchase.targetRam ? `${ramFmt(purchase.previousRam)} → ${ramFmt(purchase.targetRam)}` : purchase.ram ? ramFmt(purchase.ram) : "—"),
                kv("Cost", purchase.cost ? moneyFmt(purchase.cost) : "—"),
                note(purchase.reason ?? "No cloud-capacity activity yet"),
            )),
            card("Automatic progression", el("div", null,
                kv("Selected type", e.automaticGoal?.type ?? "—"),
                kv("Selected goal", e.automaticGoal?.title ?? "—"),
                kv("Ready", e.automaticGoal?.ready ? "YES" : "NO"),
                note("Cloud purchases and upgrades execute only when the progression advisor selects that cloud action and no manual savings lock is active."),
            )),
        ),
    );
}

function networkView(s) {
    const n = s.planner?.network ?? {};
    const root = s.root ?? {};
    const hosts = Array.isArray(s.planner?.executionHosts) ? s.planner.executionHosts.filter((h) => h.hostname !== "home") : [];
    return el("div", null,
        el("div", { style: styles.heroGrid },
            heroMetric("DISCOVERED", String(n.discovered ?? 0), "network hosts"),
            heroMetric("ROOTED", String(n.rooted ?? 0), "available access"),
            heroMetric("HGW TARGETS", String(n.hgwTargets ?? 0), "money servers"),
            heroMetric("PORT TOOLS", `${root.portToolCount ?? n.portToolCount ?? 0}/5`, age(root.updatedAt)),
        ),
        card("Remote execution hosts", hosts.length ? el("div", null, ...hosts.slice(0, 18).map(hostRow)) : note("No remote execution hosts available."), true),
        card("Rooting status", el("div", null,
            kv("Rootable now", String(n.rootableNow ?? 0)),
            kv("Newly rooted", String(root.newlyRooted ?? 0)),
            kv("Last check", age(root.updatedAt)),
            kv("Tools", Array.isArray(root.availableTools) && root.availableTools.length ? root.availableTools.join(", ") : "none"),
        ), true),
    );
}

function diagnosticsView(s) {
    const tacticalAge = s.tactical?.updatedAt ? Date.now() - Number(s.tactical.updatedAt) : Infinity;
    const telemetryAge = s.telemetry?.updatedAt ? Date.now() - Number(s.telemetry.updatedAt) : Infinity;
    return grid(
        card("Live health", el("div", null,
            healthRow("Controller", s.controller && !isControllerStateStale(s.controller)),
            healthRow("Planner", Boolean(s.planner?.selectedTarget)),
            healthRow("Economy", Boolean(s.economic?.selectedTarget)),
            healthRow("Tactical", tacticalAge < 15000),
            healthRow("Telemetry", telemetryAge < 5000),
        )),
        card("Manual tests", el("div", null,
            actionButton("Run smoke tests", "all"),
            actionButton("Test progression", "progression-advisor"),
            el("div", { style: styles.actionStatus }, actionStatus),
        )),
        card("State ages", el("div", null,
            kv("Planner", age(s.planner?.updatedAt)),
            kv("Economy", age(s.economy?.updatedAt)),
            kv("Target strategy", age(s.economic?.updatedAt)),
            kv("Cloud capacity", age(s.purchase?.updatedAt)),
            kv("Batch", age(s.batch?.updatedAt)),
        )),
        card("Commands", el("div", null,
            command("RAM audit", "run diagnostics/mem-audit.js"),
            command("Income report", "run diagnostics/income.js"),
            command("Progression", "run diagnostics/progression.js"),
            command("Root check", "run network/root.js"),
        )),
    );
}

function economySummary(s) {
    const e = s.economy ?? {};
    const goal = e.goal ?? {};
    return el("div", null,
        kv("Mode", e.mode ?? "waiting"),
        kv("Goal", goal.title ?? "No goal"),
        kv("Cash", moneyFmt(e.cash)),
        kv("Remaining", moneyFmt(goal.remaining)),
        kv("Manual lock", s.manualGoal?.active ? "ACTIVE" : "off"),
    );
}

function healthSummary(s) {
    return el("div", null,
        healthRow("Controller", Boolean(s.controller) && !isControllerStateStale(s.controller)),
        healthRow("Planner", Boolean(s.planner?.selectedTarget)),
        healthRow("Economy", Boolean(s.economic?.selectedTarget)),
        healthRow("Root service", Boolean(s.root?.updatedAt)),
        kv("Hacking level", String(s.planner?.hackingLevel ?? "?")),
    );
}

function targetRow(r, i) {
    return el("div", { key: `${r.hostname}-${i}`, style: styles.targetRow },
        el("span", { style: styles.rank }, `#${r.economicRank ?? i + 1}`),
        el("span", { style: styles.targetHost }, String(r.hostname)),
        el("span", { style: styles.targetMetric }, pct(r.moneyTargetPercent)),
        el("span", { style: styles.targetMetric }, `${moneyFmt(r.steadyIncomePerSecond)}/s`),
        el("span", { style: styles.targetEta }, duration(r.economicEtaSeconds)),
    );
}

function hostRow(h) {
    return el("div", { key: h.hostname, style: styles.hostRow },
        el("span", { style: styles.targetHost }, String(h.hostname)),
        el("span", { style: styles.targetMetric }, `${ramFmt(h.maxRam)} max`),
        el("span", { style: styles.targetMetric }, `${ramFmt(h.usedRam ?? 0)} used`),
    );
}

function heroMetric(label, value, sub) {
    return el("div", { style: styles.heroCard },
        el("div", { style: styles.heroLabel }, label),
        el("div", { style: styles.heroValue }, value),
        el("div", { style: styles.heroSub }, sub),
    );
}

function stat(label, value) {
    return el("div", { style: styles.stat },
        el("div", { style: styles.statLabel }, label),
        el("div", { style: styles.statValue }, String(value)),
    );
}

function card(title, content, wide = false) {
    return el("div", { style: { ...styles.card, ...(wide ? styles.wide : {}) } },
        el("div", { style: styles.cardTitle }, title),
        content,
    );
}

function grid(...children) { return el("div", { style: styles.grid }, ...children); }
function kv(k, v) { return el("div", { style: styles.kv }, el("span", { style: styles.key }, k), el("span", { style: styles.value }, String(v))); }
function note(v) { return el("div", { style: styles.note }, String(v)); }
function badge(label, tone) { return el("span", { style: { ...styles.badge, ...styles[`badge_${tone}`] } }, label); }
function el(type, props, ...children) { return React.createElement(type, props, ...children); }

function healthRow(label, ok) {
    return el("div", { style: styles.kv },
        el("span", { style: styles.key }, label),
        el("span", { style: ok ? styles.healthGood : styles.healthWait }, ok ? "ONLINE" : "WAITING"),
    );
}

function progressBar(value, label) {
    const width = `${Math.max(0, Math.min(1, Number(value ?? 0))) * 100}%`;
    return el("div", { style: styles.progressWrap },
        el("div", { style: styles.progressTrack }, el("div", { style: { ...styles.progressFill, width } })),
        el("div", { style: styles.progressLabel }, label),
    );
}

function actionButton(label, id) {
    return el("button", {
        key: id,
        style: styles.actionButton,
        onClick: () => { requestedTest = { id, label }; },
    }, label);
}

function command(label, value) {
    return el("div", { style: styles.command },
        el("div", { style: styles.commandLabel }, label),
        el("div", { style: styles.code }, value),
    );
}

function parseMoney(value) {
    const text = String(value ?? "").trim().toLowerCase().replaceAll(",", "").replaceAll("$", "");
    const match = text.match(/^([0-9]+(?:\.[0-9]+)?)([kmbt]?)$/);
    if (!match) return NaN;
    const number = Number(match[1]);
    const suffix = match[2];
    const multiplier = suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : suffix === "b" ? 1e9 : suffix === "t" ? 1e12 : 1;
    return number * multiplier;
}

function pct(v) { return `${(Math.max(0, Number(v ?? 0)) * 100).toFixed(0)}%`; }
function num(v) { return Number(v ?? 0).toFixed(2); }
function moneyFmt(v) {
    const n = Math.max(0, Number(v ?? 0));
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}t`;
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}b`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}m`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}k`;
    return `$${n.toFixed(0)}`;
}
function ramFmt(v) { return `${Math.max(0, Number(v ?? 0)).toFixed(2)} GB`; }
function age(ts) {
    const n = Number(ts ?? 0);
    if (!n) return "never";
    const sec = Math.max(0, (Date.now() - n) / 1000);
    if (sec < 60) return `${sec.toFixed(0)}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    return `${Math.floor(sec / 3600)}h ago`;
}
function duration(sec) {
    const n = Math.max(0, Number(sec ?? 0));
    if (!Number.isFinite(n)) return "∞";
    if (n < 60) return `${n.toFixed(0)}s`;
    if (n < 3600) return `${Math.floor(n / 60)}m ${Math.floor(n % 60)}s`;
    return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
}

const styles = {
    app: { fontFamily: "monospace", color: "#d7e0ea", background: "#0b0f14", minHeight: "100%", padding: "16px", boxSizing: "border-box" },
    header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "8px 4px 18px", borderBottom: "1px solid #26303b" },
    eyebrow: { fontSize: "11px", letterSpacing: "2px", color: "#6c7f92", marginBottom: "4px" },
    title: { fontSize: "25px", fontWeight: 700, color: "#f3f7fb" },
    subtitle: { fontSize: "12px", color: "#8998a8", marginTop: "5px" },
    badges: { display: "flex", gap: "7px", flexWrap: "wrap", justifyContent: "flex-end" },
    badge: { padding: "5px 8px", borderRadius: "5px", fontSize: "10px", fontWeight: 700, letterSpacing: "0.5px", border: "1px solid #34404d" },
    badge_good: { color: "#8be9b4", borderColor: "#24543c", background: "#10241b" },
    badge_warn: { color: "#ffd479", borderColor: "#5f4821", background: "#281f0e" },
    badge_accent: { color: "#8ed0ff", borderColor: "#285276", background: "#102235" },
    badge_dim: { color: "#8593a1", background: "#151a20" },
    nav: { display: "flex", gap: "4px", padding: "12px 0" },
    navButton: { fontFamily: "monospace", border: "0", borderBottom: "2px solid transparent", background: "transparent", color: "#728191", padding: "8px 12px", cursor: "pointer", fontSize: "12px" },
    navActive: { color: "#e9f2fa", borderBottom: "2px solid #4fa3dc", background: "#101821" },
    content: { paddingTop: "2px" },
    heroGrid: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "10px", marginBottom: "10px" },
    heroCard: { background: "#10161d", border: "1px solid #242f3a", borderRadius: "8px", padding: "13px" },
    heroLabel: { fontSize: "10px", color: "#708090", letterSpacing: "1px" },
    heroValue: { fontSize: "20px", color: "#f1f5f9", marginTop: "5px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" },
    heroSub: { fontSize: "10px", color: "#7d8b99", marginTop: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
    grid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" },
    card: { background: "#10161d", border: "1px solid #242f3a", borderRadius: "8px", padding: "14px", minWidth: 0 },
    wide: { gridColumn: "1 / -1", marginBottom: "10px" },
    cardTitle: { color: "#91a8bb", fontSize: "11px", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", marginBottom: "10px" },
    kv: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px", padding: "4px 0", borderBottom: "1px solid #18212a" },
    key: { color: "#758595", fontSize: "11px", flex: "0 0 125px" },
    value: { color: "#d8e1e9", fontSize: "11px", textAlign: "right", overflowWrap: "anywhere" },
    note: { color: "#8796a5", fontSize: "10px", lineHeight: 1.5, marginTop: "10px", padding: "8px", background: "#0c1218", borderLeft: "2px solid #35566f" },
    strategyTitle: { fontSize: "18px", fontWeight: 700, color: "#f0f5fa", marginBottom: "10px" },
    strategyStats: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: "8px" },
    stat: { background: "#0c1218", border: "1px solid #1d2730", borderRadius: "6px", padding: "8px" },
    statLabel: { color: "#69798a", fontSize: "9px", textTransform: "uppercase" },
    statValue: { color: "#e8eef4", fontSize: "13px", marginTop: "4px" },
    targetRow: { display: "grid", gridTemplateColumns: "44px 1.5fr 90px 120px 120px", gap: "10px", padding: "7px 4px", borderBottom: "1px solid #1a232c", alignItems: "center" },
    hostRow: { display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr", gap: "10px", padding: "7px 4px", borderBottom: "1px solid #1a232c" },
    rank: { color: "#5e88a6", fontSize: "10px" },
    targetHost: { color: "#e0e8ef", fontSize: "11px" },
    targetMetric: { color: "#8fa0af", fontSize: "10px", textAlign: "right" },
    targetEta: { color: "#9dc7e4", fontSize: "10px", textAlign: "right" },
    progressWrap: { margin: "8px 0 10px" },
    progressTrack: { height: "6px", borderRadius: "6px", background: "#1a232c", overflow: "hidden" },
    progressFill: { height: "100%", background: "#438ab8" },
    progressLabel: { color: "#687888", fontSize: "9px", marginTop: "4px" },
    healthGood: { color: "#83d8a9", fontSize: "10px", fontWeight: 700 },
    healthWait: { color: "#d4ae69", fontSize: "10px", fontWeight: 700 },
    actionButton: { fontFamily: "monospace", marginRight: "8px", marginBottom: "8px", padding: "7px 10px", borderRadius: "5px", border: "1px solid #32536a", background: "#112334", color: "#b8dcf4", cursor: "pointer" },
    actionStatus: { color: "#7f8e9c", fontSize: "10px", marginTop: "4px" },
    goalForm: { display: "grid", gridTemplateColumns: "1.25fr 1fr auto auto", gap: "8px", alignItems: "center" },
    targetForm: { display: "grid", gridTemplateColumns: "1fr auto auto", gap: "8px", alignItems: "center" },
    controlGrid: { display: "grid", gridTemplateColumns: "1fr auto", gap: "16px", alignItems: "center" },
    controlActions: { display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" },
    miniGrid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "10px", marginTop: "8px" },
    input: { minWidth: 0, fontFamily: "monospace", color: "#d8e1e9", background: "#0b1117", border: "1px solid #2b3945", borderRadius: "5px", padding: "8px 9px", outline: "none", fontSize: "11px" },
    primaryButton: { fontFamily: "monospace", padding: "8px 11px", borderRadius: "5px", border: "1px solid #2e5c7d", background: "#12304a", color: "#bfe4ff", cursor: "pointer", whiteSpace: "nowrap" },
    clearButton: { fontFamily: "monospace", padding: "8px 11px", borderRadius: "5px", border: "1px solid #5b4930", background: "#271e11", color: "#f0cf91", cursor: "pointer", whiteSpace: "nowrap" },
    disabledButton: { opacity: 0.45, cursor: "default" },
    goalHint: { color: "#687888", fontSize: "9px", marginTop: "8px" },
    goalStatus: { color: "#9dc7e4", fontSize: "10px", marginTop: "7px" },
    command: { marginBottom: "9px" },
    commandLabel: { color: "#708090", fontSize: "9px", marginBottom: "3px" },
    code: { color: "#b8d6e8", background: "#0b1117", border: "1px solid #1d2832", borderRadius: "4px", padding: "5px 7px", fontSize: "10px" },
    footer: { display: "flex", justifyContent: "space-between", gap: "12px", color: "#50606f", fontSize: "9px", padding: "12px 3px 0" },
};
