import {
    readCloudPurchaseState,
    readEconomyState,
    readManualMoneyGoalState,
    readPlannerState,
    readRootState,
} from "/lib/runtime-state.js";
import { readTelemetryState } from "/lib/telemetry.js";
import { isQuiet, quietArgs } from "/lib/output.js";

const ROOT_CHECK_MS = 30_000;
const CLOUD_RETRY_MS = 5_000;
const CLOUD_GOAL_TYPES = Object.freeze(new Set([
    "PURCHASED_SERVER",
    "CLOUD_SERVER_UPGRADE",
]));
const ROOT_SCRIPT = "/network/root.js";
const PLANNER_SCRIPT = "/hacking/planner.js";
const SYNC_SCRIPT = "/network/sync.js";
const ECONOMY_SCRIPT = "/hacking/economy-planner.js";
const CLOUD_BUY_SCRIPT = "/network/cloud-buy.js";
const ECONOMIC_TARGET_SCRIPT = "/hacking/economy-targets.js";

/**
 * Persistent remote refresh coordinator.
 *
 * Heavy target/RAM analysis remains event-driven. Root checks are lightweight,
 * strategic planner refreshes occur after meaningful target/pool events, and
 * advisor-selected cloud purchases/upgrades are retried independently once they
 * are affordable. This prevents a long GROW/WEAKEN prep phase from blocking an
 * already-approved capacity purchase just because no HACK completion occurs.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");

    const initialTelemetry = readTelemetryState(ns);
    let lastReviewedHackAt = Number(initialTelemetry?.lastHack?.finishedAt ?? 0);
    let lastManualGoalUpdatedAt = Number(readManualMoneyGoalState(ns)?.updatedAt ?? 0);
    let lastRootCheckAt = 0;
    let lastCloudRetryAt = 0;
    let startupEconomyDone = false;

    while (true) {
        if (!startupEconomyDone) {
            const result = await runEconomyPurchaseTargetChain(ns);
            if (result.ok) startupEconomyDone = true;
        }

        const now = Date.now();
        let rootExpansion = false;

        if (now - lastRootCheckAt >= ROOT_CHECK_MS) {
            const rootOk = await launchAndWait(ns, ROOT_SCRIPT, true);
            lastRootCheckAt = Date.now();
            if (rootOk) {
                const root = readRootState(ns);
                rootExpansion = Number(root?.newlyRooted ?? 0) > 0;
                if (rootExpansion && !isQuiet(ns)) {
                    ns.print(`Root expansion: ${root.newlyRootedHosts?.join(", ") || `${root.newlyRooted} server(s)`}.`);
                }
            }
        }

        const telemetry = readTelemetryState(ns);
        const hackCompletedAt = Number(telemetry?.lastHack?.finishedAt ?? 0);
        const hackNeedsReview = hackCompletedAt > lastReviewedHackAt;

        const manualGoalUpdatedAt = Number(readManualMoneyGoalState(ns)?.updatedAt ?? 0);
        const manualGoalChanged = manualGoalUpdatedAt > lastManualGoalUpdatedAt;

        if (now - lastCloudRetryAt >= CLOUD_RETRY_MS) {
            lastCloudRetryAt = now;
            const cloudResult = await retryPendingCloudCapacity(ns);
            if (cloudResult.capacityChanged) {
                if (hackNeedsReview) lastReviewedHackAt = hackCompletedAt;
                if (manualGoalChanged) lastManualGoalUpdatedAt = manualGoalUpdatedAt;
                if (!isQuiet(ns)) {
                    ns.print(`Cloud capacity changed independently: ${cloudResult.action.toLowerCase()} ${cloudResult.hostname}.`);
                }
                await ns.sleep(250);
                continue;
            }
        }

        if (manualGoalChanged && !hackNeedsReview && !rootExpansion) {
            const result = await runEconomyPurchaseTargetChain(ns);
            if (result.ok) {
                lastManualGoalUpdatedAt = manualGoalUpdatedAt;
                if (!isQuiet(ns)) ns.print("Economy/target review complete after manual money-goal change.");
            }
        }

        if (hackNeedsReview || rootExpansion) {
            const plannerOk = await launchAndWait(ns, PLANNER_SCRIPT, true);
            if (plannerOk) {
                await launchAndWait(ns, SYNC_SCRIPT, true);
                const result = await runEconomyPurchaseTargetChain(ns);
                if (result.ok) {
                    if (hackNeedsReview) lastReviewedHackAt = hackCompletedAt;
                    if (manualGoalChanged) lastManualGoalUpdatedAt = manualGoalUpdatedAt;
                    if (!isQuiet(ns)) {
                        const reasons = [];
                        if (hackNeedsReview) reasons.push("HACK completion");
                        if (rootExpansion) reasons.push("new root access");
                        if (manualGoalChanged) reasons.push("manual money-goal change");
                        if (result.capacityChanged) reasons.push(`${result.action.toLowerCase()} ${result.hostname}`);
                        ns.print(`Target/RAM review complete after ${reasons.join(" + ")}.`);
                    }
                }
            }
        }

        await ns.sleep(250);
    }
}

/**
 * Retry only an already-selected cloud capacity goal. No expensive economy or
 * target analysis is performed unless the purchase/upgrade actually succeeds.
 * Affordability is checked from the cached goal cost against live home cash so a
 * stale `ready: false` flag cannot block spending after cash crosses the goal.
 */
async function retryPendingCloudCapacity(ns) {
    const manual = readManualMoneyGoalState(ns);
    if (manual?.active && Number(manual?.targetCash ?? 0) > 0) {
        return { attempted: false, capacityChanged: false, hostname: "", action: "NONE" };
    }

    const economy = readEconomyState(ns);
    const goal = economy?.goal ?? null;
    const goalType = String(goal?.type ?? "");
    if (!CLOUD_GOAL_TYPES.has(goalType)) {
        return { attempted: false, capacityChanged: false, hostname: "", action: "NONE" };
    }

    const goalCost = Math.max(0, Number(goal?.cost ?? 0));
    const cash = Math.max(0, Number(ns.getServerMoneyAvailable("home")) || 0);
    if (!(goalCost > 0) || cash < goalCost) {
        return { attempted: false, capacityChanged: false, hostname: "", action: "NONE" };
    }

    const previousCapacityAt = Number(readCloudPurchaseState(ns)?.updatedAt ?? 0);
    const spenderOk = await launchAndWait(ns, CLOUD_BUY_SCRIPT, true);
    if (!spenderOk) {
        return { attempted: true, capacityChanged: false, hostname: "", action: "NONE" };
    }

    const cloud = readCloudPurchaseState(ns);
    const capacityChanged = Boolean(cloud?.capacityChanged)
        && Number(cloud?.updatedAt ?? 0) > previousCapacityAt;
    if (!capacityChanged) {
        return {
            attempted: true,
            capacityChanged: false,
            hostname: String(cloud?.hostname ?? ""),
            action: String(cloud?.action ?? "NONE"),
        };
    }

    const hostname = String(cloud?.hostname ?? "");
    const action = String(cloud?.action ?? "CLOUD_CAPACITY");
    const plannerOk = await launchAndWait(ns, PLANNER_SCRIPT, true);
    if (!plannerOk) return { attempted: true, capacityChanged, hostname, action, ok: false };

    await launchAndWait(ns, SYNC_SCRIPT, true);
    const economyOk = await launchAndWait(ns, ECONOMY_SCRIPT);
    if (!economyOk) return { attempted: true, capacityChanged, hostname, action, ok: false };

    const targetOk = await launchAndWait(ns, ECONOMIC_TARGET_SCRIPT);
    return { attempted: true, capacityChanged, hostname, action, ok: targetOk };
}

/**
 * Refresh progression state, optionally execute exactly one advisor-selected
 * cloud capacity action, then publish the final economic target decision.
 * The cloud spender has a direct manual-goal lock, so stale economy state cannot
 * authorize spending after the user enables a savings target.
 */
async function runEconomyPurchaseTargetChain(ns) {
    const economyOk = await launchAndWait(ns, ECONOMY_SCRIPT);
    if (!economyOk) return { ok: false, capacityChanged: false, hostname: "", action: "NONE" };

    const previousCapacityAt = Number(readCloudPurchaseState(ns)?.updatedAt ?? 0);
    const buyerOk = await launchAndWait(ns, CLOUD_BUY_SCRIPT, true);
    let capacityChanged = false;
    let hostname = "";
    let action = "NONE";

    if (buyerOk) {
        const purchase = readCloudPurchaseState(ns);
        capacityChanged = Boolean(purchase?.capacityChanged)
            && Number(purchase?.updatedAt ?? 0) > previousCapacityAt;
        hostname = capacityChanged ? String(purchase?.hostname ?? "") : "";
        action = capacityChanged ? String(purchase?.action ?? "CLOUD_CAPACITY") : "NONE";
    }

    if (capacityChanged) {
        const plannerOk = await launchAndWait(ns, PLANNER_SCRIPT, true);
        if (!plannerOk) return { ok: false, capacityChanged, hostname, action };
        await launchAndWait(ns, SYNC_SCRIPT, true);

        const refreshedEconomyOk = await launchAndWait(ns, ECONOMY_SCRIPT);
        if (!refreshedEconomyOk) return { ok: false, capacityChanged, hostname, action };
    }

    const targetOk = await launchAndWait(ns, ECONOMIC_TARGET_SCRIPT);
    return { ok: targetOk, capacityChanged, hostname, action };
}

async function launchAndWait(ns, script, forceQuiet = false) {
    const scriptRam = ns.getScriptRam(script, "home");
    if (!(scriptRam > 0)) {
        if (!isQuiet(ns)) ns.print(`Refresh skipped: could not determine RAM for ${script}`);
        return false;
    }

    const planner = readPlannerState(ns);
    const hosts = Array.isArray(planner?.executionHosts) ? planner.executionHosts : [];
    const candidates = hosts
        .map((entry) => String(entry.hostname ?? ""))
        .filter((hostname) => hostname && hostname !== "home")
        .map((hostname) => ({
            hostname,
            freeRam: Math.max(0, ns.getServerMaxRam(hostname) - ns.getServerUsedRam(hostname)),
        }))
        .filter((host) => host.freeRam >= scriptRam)
        .sort((a, b) => b.freeRam - a.freeRam || a.hostname.localeCompare(b.hostname));

    const args = forceQuiet ? ["--quiet"] : quietArgs(ns);

    for (const host of candidates) {
        const pid = ns.exec(script, host.hostname, 1, ...args);
        if (pid <= 0) continue;

        while (ns.isRunning(pid, host.hostname)) await ns.sleep(50);
        return true;
    }

    if (!isQuiet(ns)) ns.print(`Refresh delayed: no remote host has ${scriptRam.toFixed(2)}GB free for ${script}`);
    return false;
}
