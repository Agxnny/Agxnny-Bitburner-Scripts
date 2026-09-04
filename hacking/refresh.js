import {
    readCloudPurchaseState,
    readManualMoneyGoalState,
    readPlannerState,
    readRootState,
} from "/lib/runtime-state.js";
import { readTelemetryState } from "/lib/telemetry.js";
import { isQuiet, quietArgs } from "/lib/output.js";

const ROOT_CHECK_MS = 30_000;
const ROOT_SCRIPT = "/network/root.js";
const PLANNER_SCRIPT = "/hacking/planner.js";
const SYNC_SCRIPT = "/network/sync.js";
const ECONOMY_SCRIPT = "/hacking/economy-planner.js";
const CLOUD_BUY_SCRIPT = "/network/cloud-buy.js";
const ECONOMIC_TARGET_SCRIPT = "/hacking/economy-targets.js";

/**
 * Persistent remote refresh coordinator.
 *
 * Heavy target/RAM analysis is event-driven. The coordinator performs lightweight
 * rooting checks every 30 seconds and runs the full strategic chain after a HACK
 * or execution-pool expansion. Manual money-goal changes trigger only the economy
 * / purchase-lock / target portion, so setting a savings target takes effect
 * quickly without forcing an unnecessary network planner pass.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");

    const initialTelemetry = readTelemetryState(ns);
    let lastReviewedHackAt = Number(initialTelemetry?.lastHack?.finishedAt ?? 0);
    let lastManualGoalUpdatedAt = Number(readManualMoneyGoalState(ns)?.updatedAt ?? 0);
    let lastRootCheckAt = 0;
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
                        if (result.purchased) reasons.push(`cloud purchase ${result.hostname}`);
                        ns.print(`Target/RAM review complete after ${reasons.join(" + ")}.`);
                    }
                }
            }
        }

        await ns.sleep(250);
    }
}

/**
 * Refresh progression state, optionally buy exactly one advisor-selected cloud
 * server, then publish the final economic target decision. The cloud buyer has a
 * direct manual-goal spending lock, so an active manual goal can never authorize
 * an automatic purchase even if Port 7 contains stale automatic advice.
 */
async function runEconomyPurchaseTargetChain(ns) {
    const economyOk = await launchAndWait(ns, ECONOMY_SCRIPT);
    if (!economyOk) return { ok: false, purchased: false, hostname: "" };

    const previousPurchaseAt = Number(readCloudPurchaseState(ns)?.updatedAt ?? 0);
    const buyerOk = await launchAndWait(ns, CLOUD_BUY_SCRIPT, true);
    let purchased = false;
    let hostname = "";

    if (buyerOk) {
        const purchase = readCloudPurchaseState(ns);
        purchased = Boolean(purchase?.purchased) && Number(purchase?.updatedAt ?? 0) > previousPurchaseAt;
        hostname = purchased ? String(purchase?.hostname ?? "") : "";
    }

    if (purchased) {
        const plannerOk = await launchAndWait(ns, PLANNER_SCRIPT, true);
        if (!plannerOk) return { ok: false, purchased, hostname };
        await launchAndWait(ns, SYNC_SCRIPT, true);

        // Recalculate progression once after the purchase so Port 7 reflects the
        // reduced cash/new server count. Do not invoke the buyer a second time in
        // this same strategic pass.
        const refreshedEconomyOk = await launchAndWait(ns, ECONOMY_SCRIPT);
        if (!refreshedEconomyOk) return { ok: false, purchased, hostname };
    }

    const targetOk = await launchAndWait(ns, ECONOMIC_TARGET_SCRIPT);
    return { ok: targetOk, purchased, hostname };
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
