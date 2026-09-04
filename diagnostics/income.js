import { readTelemetryState } from "/lib/telemetry.js";

/** @param {NS} ns */
export async function main(ns) {
    const telemetry = readTelemetryState(ns);

    if (!telemetry) {
        ns.tprint("No HGW telemetry snapshot found.");
        ns.tprint("Run kickstart.js and allow the telemetry collector to start.");
        return;
    }

    ns.tprint("=== HGW INCOME ===");
    ns.tprint(`Total earned:  $${ns.format.number(telemetry.totalMoney ?? 0, 2)}`);
    ns.tprint(`Lifetime rate: $${ns.format.number(telemetry.incomePerSecond ?? 0, 2)}/s`);
    ns.tprint(`Last 1 min:    $${ns.format.number(telemetry.incomePerSecond1m ?? 0, 2)}/s`);
    ns.tprint(`Last 5 min:    $${ns.format.number(telemetry.incomePerSecond5m ?? 0, 2)}/s`);
    ns.tprint(`Hack events:   ${telemetry.hackEvents ?? 0}`);
    ns.tprint(`Successful:    ${telemetry.successfulEvents ?? 0}`);
    ns.tprint(`Zero-return:   ${telemetry.failedEvents ?? 0}`);
    ns.tprint(`RAM usage:     ${(Number(telemetry.execution?.utilization ?? 0) * 100).toFixed(1)}%`);

    const lastHack = telemetry.lastHack;
    if (lastHack) {
        ns.tprint("");
        ns.tprint("--- LAST HACK ---");
        ns.tprint(`Target:        ${lastHack.target}`);
        ns.tprint(`Money:         $${ns.format.number(lastHack.money ?? 0, 2)}`);
        ns.tprint(`Threads:       ${lastHack.threads ?? 0}`);
        ns.tprint(`Worker host:   ${lastHack.hostname || "unknown"}`);
        ns.tprint(`Duration:      ${(Number(lastHack.durationMs ?? 0) / 1000).toFixed(1)}s`);
    }
}
