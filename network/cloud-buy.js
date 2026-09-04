import {
    publishCloudPurchaseState,
    readEconomyState,
    readManualMoneyGoalState,
} from "/lib/runtime-state.js";
import { isQuiet } from "/lib/output.js";

const NAME_PREFIX = "hgw-";
const NAME_WIDTH = 3;
const PURCHASED_SERVER_GOAL = "PURCHASED_SERVER";
const CLOUD_SERVER_UPGRADE_GOAL = "CLOUD_SERVER_UPGRADE";

/**
 * Short-lived cloud-capacity spender.
 *
 * The progression advisor remains the authority over whether money should be
 * spent. This script executes the selected cloud action when it is actually
 * affordable: either purchasing one new cloud server or upgrading one existing
 * cloud server. A manual money goal is a hard spending lock.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const economy = readEconomyState(ns);
    const goal = economy?.goal ?? null;
    const manual = readManualMoneyGoalState(ns);
    const existing = ns.cloud.getServerNames();
    const serverLimit = Math.max(0, Number(ns.cloud.getServerLimit()) || 0);
    const goalType = String(goal?.type ?? "");
    const baseState = {
        version: 3,
        updatedAt: Date.now(),
        naming: {
            prefix: NAME_PREFIX,
            width: NAME_WIDTH,
            example: `${NAME_PREFIX}${String(1).padStart(NAME_WIDTH, "0")}`,
        },
        action: "NONE",
        owned: existing.length,
        serverLimit,
        purchased: false,
        upgraded: false,
        capacityChanged: false,
        hostname: "",
        ram: 0,
        previousRam: 0,
        targetRam: 0,
        cost: 0,
        goalType,
        goalTitle: String(goal?.title ?? ""),
    };

    if (manual?.active && Number(manual?.targetCash ?? 0) > 0) {
        publishCloudPurchaseState(ns, {
            ...baseState,
            status: "BLOCKED_MANUAL_GOAL",
            reason: `Manual money goal is active at $${formatCompact(manual.targetCash)}; automated cloud spending is locked.`,
            manualMoneyGoal: {
                active: true,
                targetCash: Number(manual.targetCash),
                title: String(manual.title ?? "Manual cash goal"),
            },
        });
        return;
    }

    if (!goal) {
        publishCloudPurchaseState(ns, {
            ...baseState,
            status: "NO_PROGRESSION_GOAL",
            reason: "No progression goal is currently available.",
        });
        return;
    }

    if (goalType === PURCHASED_SERVER_GOAL) {
        await purchaseNewServer(ns, goal, existing, serverLimit, baseState);
        return;
    }

    if (goalType === CLOUD_SERVER_UPGRADE_GOAL) {
        await upgradeCloudServer(ns, goal, existing, baseState);
        return;
    }

    publishCloudPurchaseState(ns, {
        ...baseState,
        status: "NO_CLOUD_CAPACITY_GOAL",
        reason: `Progression advisor currently prefers ${String(goal.title ?? goalType || "another goal")}; no automatic cloud spend is authorized.`,
    });
}

async function purchaseNewServer(ns, goal, existing, serverLimit, baseState) {
    if (existing.length >= serverLimit) {
        publishCloudPurchaseState(ns, {
            ...baseState,
            action: "PURCHASE_SERVER",
            status: "SERVER_LIMIT",
            reason: `Cloud-server limit reached (${existing.length}/${serverLimit}).`,
        });
        return;
    }

    const ram = Math.max(1, Math.floor(Number(goal.metadata?.serverRam ?? 8)));
    const cost = Math.max(0, Number(ns.cloud.getServerCost(ram)) || 0);
    const cash = Math.max(0, Number(ns.getServerMoneyAvailable("home")) || 0);
    const hostname = nextManagedHostname(existing);

    if (!(cost > 0)) {
        publishCloudPurchaseState(ns, {
            ...baseState,
            action: "PURCHASE_SERVER",
            status: "INVALID_PURCHASE_COST",
            hostname,
            ram,
            targetRam: ram,
            reason: `Could not determine a valid purchase cost for ${ram}GB.`,
        });
        return;
    }

    if (cash < cost) {
        publishCloudPurchaseState(ns, {
            ...baseState,
            action: "PURCHASE_SERVER",
            status: "WAITING_FOR_CASH",
            hostname,
            ram,
            targetRam: ram,
            cost,
            reason: `Need $${formatCompact(cost - cash)} more for new ${ram}GB server ${hostname}.`,
        });
        return;
    }

    const purchasedHost = ns.cloud.purchaseServer(hostname, ram);
    if (!purchasedHost) {
        publishCloudPurchaseState(ns, {
            ...baseState,
            action: "PURCHASE_SERVER",
            status: "PURCHASE_FAILED",
            hostname,
            ram,
            targetRam: ram,
            cost,
            reason: "Cloud purchase API returned an empty hostname.",
        });
        return;
    }

    const state = {
        ...baseState,
        updatedAt: Date.now(),
        action: "PURCHASE_SERVER",
        status: "PURCHASED",
        purchased: true,
        capacityChanged: true,
        hostname: String(purchasedHost),
        ram,
        targetRam: ram,
        cost,
        owned: existing.length + 1,
        reason: `Purchased ${ram}GB as ${purchasedHost}.`,
    };
    publishCloudPurchaseState(ns, state);
    if (!isQuiet(ns)) ns.tprint(`CLOUD PURCHASE: ${purchasedHost} | ${ram}GB | $${formatCompact(cost)}`);
}

async function upgradeCloudServer(ns, goal, existing, baseState) {
    const hostname = String(goal.metadata?.hostname ?? "").trim();
    const targetRam = Math.max(1, Math.floor(Number(goal.metadata?.targetRam ?? 0)));

    if (!hostname || !existing.includes(hostname) || !(targetRam > 0)) {
        publishCloudPurchaseState(ns, {
            ...baseState,
            action: "UPGRADE_SERVER",
            status: "INVALID_UPGRADE_GOAL",
            hostname,
            targetRam,
            reason: "The selected cloud upgrade no longer points to a valid owned server/target RAM tier.",
        });
        return;
    }

    const currentRam = Math.max(0, Number(ns.getServerMaxRam(hostname)) || 0);
    if (currentRam >= targetRam) {
        publishCloudPurchaseState(ns, {
            ...baseState,
            action: "UPGRADE_SERVER",
            status: "ALREADY_UPGRADED",
            hostname,
            ram: currentRam,
            previousRam: currentRam,
            targetRam,
            reason: `${hostname} is already at or above ${targetRam}GB.`,
        });
        return;
    }

    const cost = Math.max(0, Number(ns.cloud.getServerUpgradeCost(hostname, targetRam)) || 0);
    const cash = Math.max(0, Number(ns.getServerMoneyAvailable("home")) || 0);

    if (!(cost > 0)) {
        publishCloudPurchaseState(ns, {
            ...baseState,
            action: "UPGRADE_SERVER",
            status: "INVALID_UPGRADE_COST",
            hostname,
            ram: currentRam,
            previousRam: currentRam,
            targetRam,
            reason: `Could not determine a valid upgrade cost for ${hostname} ${currentRam}GB -> ${targetRam}GB.`,
        });
        return;
    }

    if (cash < cost) {
        publishCloudPurchaseState(ns, {
            ...baseState,
            action: "UPGRADE_SERVER",
            status: "WAITING_FOR_CASH",
            hostname,
            ram: currentRam,
            previousRam: currentRam,
            targetRam,
            cost,
            reason: `Need $${formatCompact(cost - cash)} more to upgrade ${hostname} ${currentRam}GB -> ${targetRam}GB.`,
        });
        return;
    }

    const upgraded = ns.cloud.upgradeServer(hostname, targetRam);
    if (!upgraded) {
        publishCloudPurchaseState(ns, {
            ...baseState,
            action: "UPGRADE_SERVER",
            status: "UPGRADE_FAILED",
            hostname,
            ram: currentRam,
            previousRam: currentRam,
            targetRam,
            cost,
            reason: `Cloud upgrade API returned false for ${hostname}.`,
        });
        return;
    }

    const state = {
        ...baseState,
        updatedAt: Date.now(),
        action: "UPGRADE_SERVER",
        status: "UPGRADED",
        upgraded: true,
        capacityChanged: true,
        hostname,
        ram: targetRam,
        previousRam: currentRam,
        targetRam,
        cost,
        reason: `Upgraded ${hostname} from ${currentRam}GB to ${targetRam}GB.`,
    };
    publishCloudPurchaseState(ns, state);
    if (!isQuiet(ns)) ns.tprint(`CLOUD UPGRADE: ${hostname} | ${currentRam}GB -> ${targetRam}GB | $${formatCompact(cost)}`);
}

function nextManagedHostname(existing) {
    const used = new Set(existing.map((hostname) => String(hostname)));
    for (let index = 1; index < 1_000_000; index += 1) {
        const candidate = `${NAME_PREFIX}${String(index).padStart(NAME_WIDTH, "0")}`;
        if (!used.has(candidate)) return candidate;
    }
    return `${NAME_PREFIX}${Date.now()}`;
}

function formatCompact(value) {
    const number = Math.max(0, Number(value) || 0);
    if (number >= 1e9) return `${(number / 1e9).toFixed(2)}b`;
    if (number >= 1e6) return `${(number / 1e6).toFixed(2)}m`;
    if (number >= 1e3) return `${(number / 1e3).toFixed(2)}k`;
    return number.toFixed(0);
}
