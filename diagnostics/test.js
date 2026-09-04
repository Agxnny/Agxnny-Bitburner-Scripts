import {
    isControllerStateStale,
    readControllerState,
} from "/lib/runtime-state.js";
import { readTelemetryState } from "/lib/telemetry.js";
import { buildProgressionAdvice, GoalType } from "/lib/progression.js";

const TESTS = Object.freeze({
    "controller-state": testControllerState,
    "telemetry-state": testTelemetryState,
    "progression-advisor": testProgressionAdvisor,
});

export async function main(ns) {
    const requested = String(ns.args[0] ?? "all").toLowerCase();
    if (["--list", "list", "help", "--help"].includes(requested)) {
        printTestList(ns);
        return;
    }

    const names = requested === "all" ? Object.keys(TESTS) : [requested];
    const unknown = names.filter((name) => !TESTS[name]);
    if (unknown.length > 0) {
        ns.tprint(`ERROR: Unknown test '${unknown[0]}'.`);
        printTestList(ns);
        return;
    }

    ns.tprint("=== AUTOMATION TESTER ===");
    let passed = 0;
    let failed = 0;
    for (const name of names) {
        ns.tprint("");
        ns.tprint(`--- ${name} ---`);
        const result = TESTS[name](ns);
        if (result.ok) passed += 1;
        else failed += 1;
        for (const line of result.lines) ns.tprint(line);
        ns.tprint(`${result.ok ? "PASS" : "FAIL"}: ${name}`);
    }
    ns.tprint("");
    ns.tprint(`RESULT: ${passed} passed / ${failed} failed`);
}

function testControllerState(ns) {
    const state = readControllerState(ns);
    const lines = [];
    if (!state) return fail("No controller snapshot is available on Port 1.");

    const moneyCurrent = Number(state.money?.current);
    const moneyMax = Number(state.money?.max);
    const securityCurrent = Number(state.security?.current);
    const securityMinimum = Number(state.security?.minimum);
    const updatedAt = Number(state.updatedAt);
    const ageMs = Number.isFinite(updatedAt) ? Math.max(0, Date.now() - updatedAt) : Infinity;
    const checks = [
        [Boolean(state.hostname), "target hostname"],
        [Number.isFinite(moneyCurrent), "current money"],
        [Number.isFinite(moneyMax) && moneyMax >= 0, "maximum money"],
        [Number.isFinite(securityCurrent), "current security"],
        [Number.isFinite(securityMinimum), "minimum security"],
        [Number.isFinite(updatedAt), "updatedAt timestamp"],
        [!isControllerStateStale(state, 5000), "fresh controller snapshot (<5s)"],
    ];

    const moneyPercent = moneyMax > 0 ? (moneyCurrent / moneyMax) * 100 : 0;
    const securityDelta = Math.max(0, securityCurrent - securityMinimum);
    lines.push(`Target:    ${state.hostname} | ${state.phase} | ${state.action}`);
    lines.push(`Money:     $${ns.format.number(moneyCurrent, 2)} / $${ns.format.number(moneyMax, 2)} (${moneyPercent.toFixed(1)}%)`);
    lines.push(`Security:  ${securityCurrent.toFixed(2)} / ${securityMinimum.toFixed(2)} (+${securityDelta.toFixed(2)})`);
    lines.push(`Snapshot:  ${formatAge(ageMs)} old`);
    lines.push(`[STATE] ${state.hostname} | money $${formatCompactNumber(moneyCurrent)}/$${formatCompactNumber(moneyMax)} (${moneyPercent.toFixed(1)}%) | security ${securityCurrent.toFixed(2)}/${securityMinimum.toFixed(2)} (+${securityDelta.toFixed(2)})`);

    const failures = checks.filter(([ok]) => !ok).map(([, label]) => label);
    if (failures.length > 0) {
        lines.push(`Missing/invalid: ${failures.join(", ")}`);
        return { ok: false, lines };
    }
    lines.push("Controller state contains the fields needed by the live target-state printout.");
    return { ok: true, lines };
}

function testTelemetryState(ns) {
    const state = readTelemetryState(ns);
    const lines = [];
    if (!state) return fail("No telemetry snapshot is available on Port 5. The telemetry collector may not be running yet.");

    const updatedAt = Number(state.updatedAt);
    const ageMs = Number.isFinite(updatedAt) ? Math.max(0, Date.now() - updatedAt) : Infinity;
    const totalMoney = Number(state.totalMoney);
    const lifetime = Number(state.incomePerSecond);
    const oneMinute = Number(state.incomePerSecond1m);
    const fiveMinutes = Number(state.incomePerSecond5m);
    const checks = [
        [Number.isFinite(updatedAt), "updatedAt timestamp"],
        [ageMs <= 5000, "fresh telemetry snapshot (<5s)"],
        [Number.isFinite(totalMoney) && totalMoney >= 0, "totalMoney"],
        [Number.isFinite(lifetime) && lifetime >= 0, "lifetime income rate"],
        [Number.isFinite(oneMinute) && oneMinute >= 0, "1-minute income rate"],
        [Number.isFinite(fiveMinutes) && fiveMinutes >= 0, "5-minute income rate"],
        [Array.isArray(state.recentHacks), "recentHacks array"],
    ];

    lines.push(`Snapshot:   ${formatAge(ageMs)} old`);
    lines.push(`Total:      $${ns.format.number(totalMoney, 2)}`);
    lines.push(`Lifetime:   $${ns.format.number(lifetime, 2)}/s`);
    lines.push(`Last 1 min: $${ns.format.number(oneMinute, 2)}/s`);
    lines.push(`Last 5 min: $${ns.format.number(fiveMinutes, 2)}/s`);
    lines.push(`Hack events:${Number(state.hackEvents ?? 0)}`);

    const failures = checks.filter(([ok]) => !ok).map(([, label]) => label);
    if (failures.length > 0) {
        lines.push(`Missing/invalid: ${failures.join(", ")}`);
        return { ok: false, lines };
    }
    lines.push(Number(state.hackEvents ?? 0) === 0
        ? "Telemetry transport is healthy; no real hack event has been recorded yet."
        : "Telemetry snapshot is healthy and contains hack-event data.");
    return { ok: true, lines };
}

function testProgressionAdvisor(ns) {
    const advice = buildProgressionAdvice(ns, readTelemetryState(ns));
    const goal = advice?.selected;
    const lines = [];
    if (!goal) return fail("Progression advisor did not produce a selected goal.");

    const home = advice.candidates.find((candidate) => candidate.type === GoalType.HOME_RAM);
    const cloud = advice.candidates.find((candidate) => candidate.type === GoalType.PURCHASED_SERVER);
    const cloudUpgrade = advice.candidates.find((candidate) => candidate.type === GoalType.CLOUD_SERVER_UPGRADE);
    const eligibleUpgradeExists = advice.context.cloud.servers.some((hostname) => {
        const ram = Number(ns.getServerMaxRam(hostname)) || 0;
        return ram > 0 && ram < advice.context.cloud.ramLimit;
    });

    lines.push(`Mode:       ${advice.mode}`);
    lines.push(`Goal:       ${goal.title}`);
    lines.push(`Cash:       $${ns.format.number(goal.currentCash, 2)}`);
    lines.push(`Cost:       $${ns.format.number(goal.cost, 2)}`);
    lines.push(`Remaining:  $${ns.format.number(goal.remaining, 2)}`);
    lines.push(`Income:     $${ns.format.number(goal.incomePerSecond, 2)}/s (${goal.incomeSource})`);
    lines.push(`Candidates: ${advice.candidates.length}`);
    lines.push(`Selected:   ${goal.type} | value ${Number(goal.valueScore ?? 0).toFixed(2)}`);
    lines.push(`Cloud fleet:${advice.context.cloud.owned}/${advice.context.cloud.serverLimit} | max ${advice.context.cloud.ramLimit}GB`);
    if (home) lines.push(`Home RAM:   $${ns.format.number(home.cost, 2)} | +${home.addedRam}GB | value ${home.valueScore.toFixed(2)}`);
    if (cloud) lines.push(`Cloud new:  $${ns.format.number(cloud.cost, 2)} | +${cloud.addedRam}GB | value ${cloud.valueScore.toFixed(2)}`);
    if (cloudUpgrade) lines.push(`Cloud up:   ${cloudUpgrade.metadata.hostname} ${cloudUpgrade.metadata.currentRam}GB -> ${cloudUpgrade.metadata.targetRam}GB | $${ns.format.number(cloudUpgrade.cost, 2)} | value ${cloudUpgrade.valueScore.toFixed(2)}`);
    else lines.push("Cloud up:   no eligible owned server yet");

    const checks = [
        [Number(advice.version) >= 3, "advisor schema version >= 3"],
        [Array.isArray(advice.candidates) && advice.candidates.length >= 2, "multiple progression candidates"],
        [Boolean(goal.id), "selected goal id"],
        [Number.isFinite(Number(goal.cost)) && Number(goal.cost) >= 0, "goal cost"],
        [Number.isFinite(Number(goal.remaining)) && Number(goal.remaining) >= 0, "remaining cost"],
        [Number.isFinite(Number(goal.valueScore)), "value score"],
        [Boolean(goal.recommendation), "recommendation"],
        [Boolean(home), "HOME_RAM candidate"],
        [Boolean(cloud) || advice.context.cloud.owned >= advice.context.cloud.serverLimit, "PURCHASED_SERVER candidate or fleet full"],
        [GoalType.CLOUD_SERVER_UPGRADE === "CLOUD_SERVER_UPGRADE", "CLOUD_SERVER_UPGRADE goal type"],
        [!eligibleUpgradeExists || Boolean(cloudUpgrade), "cloud upgrade candidate when an owned server is upgradeable"],
        [Boolean(goal.model?.valueModel), "value-model metadata"],
    ];

    const failures = checks.filter(([ok]) => !ok).map(([, label]) => label);
    if (failures.length > 0) {
        lines.push(`Missing/invalid: ${failures.join(", ")}`);
        return { ok: false, lines };
    }
    lines.push("Advisor can rank home RAM, new cloud capacity, and the best next cloud-server upgrade through one shared schema.");
    return { ok: true, lines };
}

function fail(message) {
    return { ok: false, lines: [message] };
}

function printTestList(ns) {
    ns.tprint("diagnostics/test.js - fast automation smoke tests");
    ns.tprint("Usage: run diagnostics/test.js <test>");
    ns.tprint("Tests:");
    ns.tprint("  controller-state     Validate live controller target/money/security state");
    ns.tprint("  telemetry-state      Validate the income telemetry collector snapshot");
    ns.tprint("  progression-advisor  Validate home/new-server/server-upgrade progression ranking");
    ns.tprint("  all                  Run every available test (default)");
}

function formatAge(milliseconds) {
    if (!Number.isFinite(milliseconds)) return "unknown";
    if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
    return `${(milliseconds / 1000).toFixed(1)}s`;
}

function formatCompactNumber(value) {
    const number = Math.max(0, Number(value) || 0);
    if (number >= 1e12) return `${(number / 1e12).toFixed(2)}t`;
    if (number >= 1e9) return `${(number / 1e9).toFixed(2)}b`;
    if (number >= 1e6) return `${(number / 1e6).toFixed(2)}m`;
    if (number >= 1e3) return `${(number / 1e3).toFixed(2)}k`;
    return number.toFixed(2);
}
