import {
    isControllerStateStale,
    readControllerState,
} from "/lib/runtime-state.js";
import { readTelemetryState } from "/lib/telemetry.js";

const TESTS = Object.freeze({
    "controller-state": testControllerState,
    "telemetry-state": testTelemetryState,
});

/**
 * Fast smoke-test harness for automation components.
 *
 * Usage:
 *   run diagnostics/test.js
 *   run diagnostics/test.js --list
 *   run diagnostics/test.js controller-state
 *   run diagnostics/test.js telemetry-state
 *   run diagnostics/test.js all
 *
 * Tests inspect shared runtime state and do not interrupt the live HGW loop.
 * Add new named tests here as subsystems are introduced.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const requested = String(ns.args[0] ?? "all").toLowerCase();

    if (requested === "--list" || requested === "list" || requested === "help" || requested === "--help") {
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

/** @param {NS} ns */
function testControllerState(ns) {
    const state = readControllerState(ns);
    const lines = [];

    if (!state) {
        return fail("No controller snapshot is available on Port 1.");
    }

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

/** @param {NS} ns */
function testTelemetryState(ns) {
    const state = readTelemetryState(ns);
    const lines = [];

    if (!state) {
        return fail("No telemetry snapshot is available on Port 5. The telemetry collector may not be running yet.");
    }

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

    if (Number(state.hackEvents ?? 0) === 0) {
        lines.push("Telemetry transport is healthy; no real hack event has been recorded yet.");
    } else {
        lines.push("Telemetry snapshot is healthy and contains hack-event data.");
    }

    return { ok: true, lines };
}

function fail(message) {
    return { ok: false, lines: [message] };
}

function printTestList(ns) {
    ns.tprint("diagnostics/test.js - fast automation smoke tests");
    ns.tprint("Usage: run diagnostics/test.js <test>");
    ns.tprint("Tests:");
    ns.tprint("  controller-state  Validate live controller target/money/security state");
    ns.tprint("  telemetry-state   Validate the income telemetry collector snapshot");
    ns.tprint("  all               Run every available test (default)");
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
