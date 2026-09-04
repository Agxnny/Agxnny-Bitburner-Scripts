import { publishCloudPurchaseState, readEconomyState } from "/lib/runtime-state.js";
import { isQuiet } from "/lib/output.js";

const NAME_PREFIX = "hgw-";
const NAME_WIDTH = 3;
const PURCHASED_SERVER_GOAL = "PURCHASED_SERVER";

/**
 * Short-lived cloud-server purchaser.
 *
 * This script only buys when the progression advisor has selected an affordable
 * PURCHASED_SERVER goal. Automated servers use deterministic names such as
 * hgw-001, hgw-002, ... Existing manually named servers are left unchanged.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const economy = readEconomyState(ns);
    const goal = economy?.goal ?? null;
    const existing = ns.cloud.getServerNames();
    const serverLimit = Math.max(0, Number(ns.cloud.getServerLimit()) || 0);
    const baseState = {
        version: 1,
        updatedAt: Date.now(),
        naming: {
            prefix: NAME_PREFIX,
            width: NAME_WIDTH,
            example: `${NAME_PREFIX}${String(1).padStart(NAME_WIDTH, "0")}`,
        },
        owned: existing.length,
        serverLimit,
        purchased: false,
        hostname: "",
        ram: 0,
        cost: 0,
    };

    if (!goal || String(goal.type ?? "") !== PURCHASED_SERVER_GOAL) {
        publishCloudPurchaseState(ns, { ...baseState, status: "NO_PURCHASE_GOAL", reason: "Progression advisor did not select a new cloud server." });
        return;
    }

    if (!goal.ready) {
        publishCloudPurchaseState(ns, { ...baseState, status: "WAITING_FOR_CASH", reason: `Selected cloud-server goal still needs $${formatCompact(goal.remaining)}.` });
        return;
    }

    if (existing.length >= serverLimit) {
        publishCloudPurchaseState(ns, { ...baseState, status: "SERVER_LIMIT", reason: `Cloud-server limit reached (${existing.length}/${serverLimit}).` });
        return;
    }

    const ram = Math.max(1, Math.floor(Number(goal.metadata?.serverRam ?? 8)));
    const cost = Math.max(0, Number(ns.cloud.getServerCost(ram)) || 0);
    const cash = Math.max(0, Number(ns.getServerMoneyAvailable("home")) || 0);
    const hostname = nextManagedHostname(existing);

    if (!(cost > 0) || cash < cost) {
        publishCloudPurchaseState(ns, {
            ...baseState,
            status: "WAITING_FOR_CASH",
            hostname,
            ram,
            cost,
            reason: `Need $${formatCompact(Math.max(0, cost - cash))} more for ${ram}GB.`,
        });
        return;
    }

    const purchasedHost = ns.cloud.purchaseServer(hostname, ram);
    if (!purchasedHost) {
        publishCloudPurchaseState(ns, {
            ...baseState,
            status: "PURCHASE_FAILED",
            hostname,
            ram,
            cost,
            reason: "Cloud purchase API returned an empty hostname.",
        });
        return;
    }

    const state = {
        ...baseState,
        updatedAt: Date.now(),
        status: "PURCHASED",
        purchased: true,
        hostname: String(purchasedHost),
        ram,
        cost,
        owned: existing.length + 1,
        reason: `Purchased ${ram}GB as ${purchasedHost}.`,
    };
    publishCloudPurchaseState(ns, state);

    if (!isQuiet(ns)) ns.tprint(`CLOUD PURCHASE: ${purchasedHost} | ${ram}GB | $${formatCompact(cost)}`);
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
