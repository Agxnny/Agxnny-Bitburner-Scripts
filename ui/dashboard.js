import { isControllerStateStale } from "/lib/runtime-state.js";
import { processPendingActions } from "/ui/actions.js";
import { age } from "/ui/components/format.js";
import { badge, el } from "/ui/components/layout.js";
import { getCachedState, getStateVersion, refreshSnapshot } from "/ui/state.js";
import { styles } from "/ui/styles.js";
import { overviewView, modeLabel } from "/ui/views/overview.js";
import { targetsView } from "/ui/views/targets.js";
import { economyView } from "/ui/views/economy.js";
import { batchView } from "/ui/views/batch.js";
import { networkView } from "/ui/views/network.js";
import { diagnosticsView } from "/ui/views/diagnostics.js";

const TABS = Object.freeze(["Overview", "Targets", "Economy", "Batch", "Network", "Diagnostics"]);
const UI_SYNC_MS = 100;
const MAIN_TICK_MS = 25;
const DATA_REFRESH_MS = 1000;

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.ui.openTail();
    ns.ui.setTailTitle("Agxnny Control Plane");
    ns.ui.resizeTail(1080, 720);

    refreshSnapshot(ns);
    let lastDataRefresh = Date.now();
    ns.clearLog();
    ns.printRaw(el(DashboardRoot));

    while (true) {
        const now = Date.now();
        if (now - lastDataRefresh >= DATA_REFRESH_MS) {
            refreshSnapshot(ns);
            lastDataRefresh = now;
        }
        await processPendingActions(ns, now);
        await ns.sleep(MAIN_TICK_MS);
    }
}

function DashboardRoot() {
    const [activeTab, setActiveTab] = React.useState("Overview");
    const [, setRenderVersion] = React.useState(getStateVersion());
    React.useEffect(() => {
        const timer = setInterval(() => {
            const version = getStateVersion();
            setRenderVersion((current) => current === version ? current : version);
        }, UI_SYNC_MS);
        return () => clearInterval(timer);
    }, []);

    const s = getCachedState();
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

function header(s) {
    const c = s.controller ?? {};
    const live = Boolean(s.controller) && !isControllerStateStale(s.controller);
    const mode = c.executionMode?.mode ?? "STANDBY";
    const pending = c.executionMode?.pending;
    const pipeline = freshPipelineState(s);
    const multi = isFreshMultiExecution(s.multiScheduler) ? s.multiScheduler : null;
    return el("div", { style: styles.header },
        el("div", null,
            el("div", { style: styles.eyebrow }, "AGXNNY AUTOMATION"),
            el("div", { style: styles.title }, "Control Plane"),
            el("div", { style: styles.subtitle }, c.hostname ? `${c.hostname} · ${c.phase ?? "waiting"}` : "Waiting for controller"),
        ),
        el("div", { style: styles.badges },
            badge(live ? "ONLINE" : "WAITING", live ? "good" : "dim"),
            badge(pending ? `SWITCH → ${pending}` : modeBadge(mode), pending ? "warn" : mode === "STANDBY" ? "dim" : "accent"),
            pipeline ? badge(`PIPE ${pipeline.status ?? "RUN"}`, pipeline.safetyStopped ? "warn" : "good") : null,
            multi ? badge(`MULTI ${multi.status ?? "RUN"}`, multi.status === "SAFETY_STOP" || multi.status === "BLOCKED" ? "warn" : "good") : null,
            c.prep?.hold ? badge("PREP HOLD", "good") : null,
            c.executionMode?.pipelineSafetyStopped ? badge("PIPE STOP", "warn") : null,
            c.executionMode?.multiSafetyStopped ? badge("MULTI STOP", "warn") : null,
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

function modeBadge(mode) {
    const label = modeLabel(mode);
    return label === "NORMAL HGW" ? "HGW" : label.replace(" HWGW", "");
}

function freshPipelineState(s) {
    const state = s.scheduler ?? null;
    if (!state) return null;
    if (s.controller?.executionMode?.pipelineRunning) return state;
    return Date.now() - Number(state.updatedAt ?? 0) < 5000 ? state : null;
}

function isFreshMultiExecution(state) {
    return Boolean(state?.model?.startsWith("MULTI_TARGET_EXECUTOR")) && Date.now() - Number(state?.updatedAt ?? 0) < 5000;
}
