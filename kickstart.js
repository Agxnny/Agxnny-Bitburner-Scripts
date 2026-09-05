import {
    publishManualMoneyGoalState,
    readEconomyTargetState,
    readPlannerState,
} from "/lib/runtime-state.js";
import { positionalArgs, quietArgs, tprint } from "/lib/output.js";

const ECONOMIC_TARGET_WAIT_MS = 30_000;
const MANUAL_GOAL_CONFIG = "/data/manual-money-goal.txt";
const PREPPER_SCRIPT = "/hacking/prepper.js";
const BATCH_HISTORY_SCRIPT = "/hacking/batch-history.js";
const STOCK_HISTORY_SCRIPT = "/stocks/history-keeper.js";
const STOCK_TRADER_SCRIPT = "/stocks/pre4s-trader.js";

/** Prepare the automation stack after a clean pull or before a test run. @param {NS} ns */
export async function main(ns) {
    if (ns.getHostname() !== "home") {
        tprint(ns, "ERROR: Run kickstart.js from home.");
        return;
    }

    const args = positionalArgs(ns);
    const stage = Math.max(0, Math.floor(Number(args[0] ?? 0)));
    const inheritedQuiet = quietArgs(ns);
    const spawnOptions = { threads: 1, spawnDelay: 0 };

    if (stage === 0) {
        restoreManualMoneyGoal(ns);
        tprint(ns, "=== KICKSTART ===");
        tprint(ns, "1/3 Refreshing planner state...");
        ns.spawn("/hacking/planner.js", spawnOptions, "--kickstart", 1, ...inheritedQuiet);
    }

    if (stage === 1) {
        tprint(ns, "2/3 Deploying execution files...");
        ns.spawn("/network/deploy.js", spawnOptions, "--kickstart", 2, ...inheritedQuiet);
    }

    if (stage === 2) {
        const planner = readPlannerState(ns);
        const analysisUpdatedAt = Number(planner?.analysisUpdatedAt ?? planner?.updatedAt ?? 0);
        tprint(ns, "3/3 Waiting for fresh economic target selection...");

        const deadline = Date.now() + ECONOMIC_TARGET_WAIT_MS;
        let freshEconomicTarget = false;
        while (Date.now() < deadline) {
            const economic = readEconomyTargetState(ns);
            const economicPlannerTime = Number(economic?.plannerUpdatedAt ?? 0);
            if (economic?.selectedTarget?.hostname && economicPlannerTime >= analysisUpdatedAt) {
                freshEconomicTarget = true;
                break;
            }
            await ns.sleep(100);
        }

        startBackground(ns, PREPPER_SCRIPT, inheritedQuiet,
            "Dedicated prepper started; remote reserve is available for target maintenance.",
            "WARNING: Could not start dedicated prepper; production will continue without reserved prep capacity.");
        startBackground(ns, BATCH_HISTORY_SCRIPT, inheritedQuiet,
            "Rolling real batch-history collector started on Port 19.",
            "WARNING: Could not start batch-history collector; conservative multi-target safety learning will remain unproven.");
        startBackground(ns, STOCK_HISTORY_SCRIPT, inheritedQuiet,
            "Stock history recorder started; price history will persist on home.",
            "WARNING: Could not start stock history recorder; stock baseline collection is offline.");
        startBackground(ns, STOCK_TRADER_SCRIPT, inheritedQuiet,
            "Pre-4S trader started with persisted Market Lab risk controls.",
            "WARNING: Could not start pre-4S trader; Market Lab trading is offline.");

        const selected = readPlannerState(ns)?.selectedTarget?.hostname ?? "unknown";
        tprint(ns, freshEconomicTarget
            ? `Economic target ready: ${selected}. Starting controller...`
            : `WARNING: economic target refresh timed out; starting controller with current target ${selected}.`);
        ns.spawn("/hacking/controller.js", spawnOptions, ...inheritedQuiet);
    }

    tprint(ns, `ERROR: Unknown kickstart stage ${stage}.`);
}

function startBackground(ns, script, args, ok, fail) {
    if (ns.isRunning(script, "home")) return;
    const pid = ns.run(script, 1, ...args);
    tprint(ns, pid > 0 ? ok : fail);
}

function restoreManualMoneyGoal(ns) {
    if (!ns.fileExists(MANUAL_GOAL_CONFIG, "home")) return;
    try {
        const state = JSON.parse(String(ns.read(MANUAL_GOAL_CONFIG) || "null"));
        if (!state || typeof state !== "object") return;
        publishManualMoneyGoalState(ns, state);
        if (state.active && Number(state.targetCash ?? 0) > 0) {
            tprint(ns, `Manual money goal restored: $${formatCompact(state.targetCash)}. Automated purchasing locked.`);
        }
    } catch {
        tprint(ns, `WARNING: could not restore ${MANUAL_GOAL_CONFIG}; ignoring invalid manual-goal data.`);
    }
}

function formatCompact(value) {
    const number = Math.max(0, Number(value) || 0);
    if (number >= 1e12) return `${(number / 1e12).toFixed(2)}t`;
    if (number >= 1e9) return `${(number / 1e9).toFixed(2)}b`;
    if (number >= 1e6) return `${(number / 1e6).toFixed(2)}m`;
    if (number >= 1e3) return `${(number / 1e3).toFixed(2)}k`;
    return number.toFixed(0);
}
