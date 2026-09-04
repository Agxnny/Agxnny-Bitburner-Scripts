import { readControllerState } from "/lib/runtime-state.js";
import {
    drainHackEvents,
    publishTelemetryState,
} from "/lib/telemetry.js";

const ONE_MINUTE_MS = 60_000;
const FIVE_MINUTES_MS = 5 * ONE_MINUTE_MS;
const MAX_RECENT_HACKS = 12;

/**
 * Persistent low-RAM HGW income collector.
 *
 * Runs on a rooted remote RAM host. Hack workers publish actual ns.hack() return
 * values to Port 4; this collector consumes them and publishes an aggregate
 * snapshot on Port 5 for controllers, diagnostics, guidance, and the dashboard.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("sleep");

    const startedAt = Date.now();
    let totalMoney = 0;
    let hackEvents = 0;
    let successfulEvents = 0;
    let failedEvents = 0;
    const recentHacks = [];
    const rateEvents = [];
    const targets = {};

    while (true) {
        const incoming = drainHackEvents(ns);

        for (const event of incoming) {
            const money = Math.max(0, Number(event.money ?? 0));
            const target = String(event.target ?? "unknown");
            const finishedAt = Number(event.finishedAt ?? Date.now());
            const normalized = {
                target,
                money,
                threads: Math.max(0, Number(event.threads ?? 0)),
                hostname: String(event.hostname ?? ""),
                jobId: String(event.jobId ?? ""),
                durationMs: Math.max(0, Number(event.durationMs ?? 0)),
                finishedAt,
            };

            hackEvents += 1;
            totalMoney += money;
            if (money > 0) successfulEvents += 1;
            else failedEvents += 1;

            recentHacks.push(normalized);
            rateEvents.push(normalized);
            while (recentHacks.length > MAX_RECENT_HACKS) recentHacks.shift();

            if (!targets[target]) {
                targets[target] = {
                    money: 0,
                    events: 0,
                    successfulEvents: 0,
                    failedEvents: 0,
                    lastHackAt: 0,
                };
            }

            targets[target].money += money;
            targets[target].events += 1;
            targets[target].lastHackAt = Math.max(targets[target].lastHackAt, finishedAt);
            if (money > 0) targets[target].successfulEvents += 1;
            else targets[target].failedEvents += 1;
        }

        const now = Date.now();
        while (rateEvents.length > 0 && rateEvents[0].finishedAt < now - FIVE_MINUTES_MS) {
            rateEvents.shift();
        }

        const controller = readControllerState(ns);
        const elapsedSeconds = Math.max(1, (now - startedAt) / 1000);
        const money1m = recentMoney(rateEvents, now - ONE_MINUTE_MS);
        const money5m = recentMoney(rateEvents, now - FIVE_MINUTES_MS);
        const elapsed1mSeconds = Math.max(1, Math.min(60, elapsedSeconds));
        const elapsed5mSeconds = Math.max(1, Math.min(300, elapsedSeconds));

        const maxRam = Math.max(0, Number(controller?.execution?.maxRam ?? 0));
        const usedRam = Math.max(0, Number(controller?.execution?.usedRam ?? 0));

        const snapshot = {
            startedAt,
            updatedAt: now,
            totalMoney,
            hackEvents,
            successfulEvents,
            failedEvents,
            incomePerSecond: totalMoney / elapsedSeconds,
            incomePerSecond1m: money1m / elapsed1mSeconds,
            incomePerSecond5m: money5m / elapsed5mSeconds,
            lastHack: recentHacks.at(-1) ?? null,
            recentHacks,
            targets,
            execution: {
                maxRam,
                usedRam,
                utilization: maxRam > 0 ? usedRam / maxRam : 0,
                usableRam: Math.max(0, Number(controller?.execution?.usableRam ?? 0)),
                activeThreads: Math.max(0, Number(controller?.execution?.activeThreads ?? 0)),
            },
        };

        publishTelemetryState(ns, snapshot);

        ns.clearLog();
        ns.print("=== HGW INCOME TELEMETRY ===");
        ns.print(`Total:       $${ns.format.number(totalMoney, 2)}`);
        ns.print(`Lifetime:    $${ns.format.number(snapshot.incomePerSecond, 2)}/s`);
        ns.print(`Last 1 min:  $${ns.format.number(snapshot.incomePerSecond1m, 2)}/s`);
        ns.print(`Last 5 min:  $${ns.format.number(snapshot.incomePerSecond5m, 2)}/s`);
        ns.print(`Hack events: ${hackEvents} (${successfulEvents} successful / ${failedEvents} zero)`);
        ns.print(`RAM usage:   ${(snapshot.execution.utilization * 100).toFixed(1)}%`);

        await ns.sleep(1000);
    }
}

function recentMoney(events, cutoff) {
    return events.reduce(
        (total, event) => event.finishedAt >= cutoff ? total + event.money : total,
        0,
    );
}
