import {
    publishManualMoneyGoalState,
    readManualMoneyGoalState,
} from "/lib/runtime-state.js";
import { positionalArgs } from "/lib/output.js";

/**
 * Set, inspect, or clear the user-controlled money goal.
 *
 * Examples:
 *   run economy/manual-goal.js 50m
 *   run economy/manual-goal.js 1.5b "Save for next milestone"
 *   run economy/manual-goal.js status
 *   run economy/manual-goal.js clear
 *
 * While active, automated cloud purchasing is locked out and the economic target
 * selector uses the remaining cash to this manual goal as its progression target.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const args = positionalArgs(ns);
    const command = String(args[0] ?? "status").trim();
    const normalized = command.toLowerCase();

    if (["clear", "off", "auto"].includes(normalized)) {
        const state = {
            version: 1,
            active: false,
            targetCash: 0,
            title: "",
            updatedAt: Date.now(),
            clearedAt: Date.now(),
        };
        publishManualMoneyGoalState(ns, state);
        ns.tprint("Manual money goal cleared. Automated purchasing is enabled again on the next economy refresh.");
        return;
    }

    if (["status", "show"].includes(normalized)) {
        printStatus(ns, readManualMoneyGoalState(ns));
        return;
    }

    const targetCash = parseMoney(command);
    if (!(targetCash > 0) || !Number.isFinite(targetCash)) {
        ns.tprint(`ERROR: invalid money goal: ${command}`);
        ns.tprint("Examples: run economy/manual-goal.js 50m | 1.5b | 25000000 | clear | status");
        return;
    }

    const title = args.length > 1
        ? args.slice(1).map((value) => String(value)).join(" ")
        : "Manual cash goal";

    const state = {
        version: 1,
        active: true,
        targetCash,
        title,
        updatedAt: Date.now(),
        setAt: Date.now(),
    };
    publishManualMoneyGoalState(ns, state);

    const cash = Math.max(0, Number(ns.getServerMoneyAvailable("home")) || 0);
    const remaining = Math.max(0, targetCash - cash);
    ns.tprint(`MANUAL MONEY GOAL: ${formatMoney(targetCash)} | current ${formatMoney(cash)} | remaining ${formatMoney(remaining)}`);
    ns.tprint("Automated purchasing is LOCKED while this manual goal is active.");
    ns.tprint("Clear with: run economy/manual-goal.js clear");
}

function printStatus(ns, state) {
    if (!state?.active) {
        ns.tprint("Manual money goal: OFF");
        ns.tprint("Automated purchasing: ENABLED");
        return;
    }

    const targetCash = Math.max(0, Number(state.targetCash ?? 0));
    const cash = Math.max(0, Number(ns.getServerMoneyAvailable("home")) || 0);
    const remaining = Math.max(0, targetCash - cash);
    ns.tprint(`Manual money goal: ${formatMoney(targetCash)}${state.title ? ` | ${state.title}` : ""}`);
    ns.tprint(`Current cash:      ${formatMoney(cash)}`);
    ns.tprint(`Remaining:         ${formatMoney(remaining)}${remaining <= 0 ? " | GOAL REACHED" : ""}`);
    ns.tprint("Automated purchase: LOCKED");
}

function parseMoney(value) {
    const text = String(value ?? "").trim().toLowerCase().replaceAll(",", "").replaceAll("$", "");
    const match = text.match(/^([0-9]+(?:\.[0-9]+)?)([kmbt]?)$/);
    if (!match) return NaN;

    const number = Number(match[1]);
    const suffix = match[2];
    const multiplier = suffix === "k" ? 1e3
        : suffix === "m" ? 1e6
            : suffix === "b" ? 1e9
                : suffix === "t" ? 1e12
                    : 1;
    return number * multiplier;
}

function formatMoney(value) {
    const number = Math.max(0, Number(value) || 0);
    if (number >= 1e12) return `$${(number / 1e12).toFixed(2)}t`;
    if (number >= 1e9) return `$${(number / 1e9).toFixed(2)}b`;
    if (number >= 1e6) return `$${(number / 1e6).toFixed(2)}m`;
    if (number >= 1e3) return `$${(number / 1e3).toFixed(2)}k`;
    return `$${number.toFixed(0)}`;
}
