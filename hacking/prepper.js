import { WORKER_SCRIPTS } from "/lib/execution.js";
import { publishPrepperState, readPlannerState } from "/lib/runtime-state.js";
import { isQuiet, positionalArgs } from "/lib/output.js";

const DEFAULT_MIN_RESERVED_RAM_GB = 32;
const MONEY_READY_RATIO = 0.995;
const SECURITY_READY_DELTA = 0.05;
const LOOP_DELAY_MS = 500;
const IDLE_DELAY_MS = 2_000;
const HOST_DRAIN_POLL_MS = 250;
const STATE_HEARTBEAT_MS = 1_000;

/**
 * Dedicated background prepper.
 *
 * Exactly one remote execution host is reserved while this service is alive.
 * Production execution automatically excludes that host through lib/execution.js.
 * The prepper then round-robins all currently eligible money targets and spends
 * one grow/weaken wave at a time bringing them toward full money + minimum sec.
 *
 * It never hacks and it never writes batch timing events.
 *
 * Usage:
 *   run hacking/prepper.js
 *   run hacking/prepper.js n00dles 32
 *   run hacking/prepper.js "" 64
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    const args = positionalArgs(ns);
    const requestedHost = String(args[0] ?? "").trim();
    const minRamGb = Math.max(2, Number(args[1] ?? DEFAULT_MIN_RESERVED_RAM_GB));
    const quiet = isQuiet(ns);

    if (ns.getHostname() !== "home") {
        if (!quiet) ns.tprint("ERROR: Run hacking/prepper.js from home.");
        return;
    }

    let planner = readPlannerState(ns);
    let reservedHost = chooseReservedHost(ns, planner, requestedHost, minRamGb);
    if (!reservedHost) {
        publishPrepperState(ns, makeState({
            enabled: false,
            status: "BLOCKED",
            reason: requestedHost ? `Requested prep host ${requestedHost} is unavailable` : "No remote RAM host is available for prep reservation",
            minRamGb,
        }));
        if (!quiet) ns.tprint("[PREPPER] BLOCKED: no eligible remote host found.");
        return;
    }

    if (!quiet) {
        ns.tprint(`[PREPPER] Reserved ${reservedHost} (${ns.format.ram(ns.getServerMaxRam(reservedHost))}) for background target prep.`);
    }

    let sequence = 0;
    let cursor = 0;
    let lastHeartbeat = 0;
    let completedWaves = 0;

    while (true) {
        planner = readPlannerState(ns);
        if (!hostStillEligible(ns, planner, reservedHost)) {
            const replacement = chooseReservedHost(ns, planner, "", minRamGb);
            if (!replacement) {
                publishPrepperState(ns, makeState({
                    enabled: true,
                    reservedHost,
                    status: "WAITING_HOST",
                    reason: "Reserved host disappeared from the execution pool; waiting for replacement",
                    minRamGb,
                    completedWaves,
                }));
                await ns.sleep(IDLE_DELAY_MS);
                continue;
            }
            reservedHost = replacement;
            cursor = 0;
        }

        const targets = eligibleTargets(planner);
        if (targets.length === 0) {
            publishPrepperState(ns, makeState({
                enabled: true,
                reservedHost,
                status: "IDLE",
                reason: "No currently eligible money targets",
                minRamGb,
                completedWaves,
                targetCount: 0,
            }));
            await ns.sleep(IDLE_DELAY_MS);
            continue;
        }

        const preparedCount = targets.filter((target) => targetPrepared(ns, target)).length;
        const needsPrep = targets.filter((target) => !targetPrepared(ns, target));
        if (needsPrep.length === 0) {
            publishPrepperState(ns, makeState({
                enabled: true,
                reservedHost,
                status: "IDLE_PREPARED",
                reason: `All ${targets.length} eligible money target(s) are prepared`,
                minRamGb,
                completedWaves,
                targetCount: targets.length,
                preparedCount,
            }));
            await ns.sleep(IDLE_DELAY_MS);
            continue;
        }

        cursor %= needsPrep.length;
        const target = needsPrep[cursor];
        cursor = (cursor + 1) % Math.max(1, needsPrep.length);

        const wave = choosePrepWave(ns, reservedHost, target, ++sequence);
        if (!wave.ok) {
            publishPrepperState(ns, makeState({
                enabled: true,
                reservedHost,
                status: "BLOCKED_WAVE",
                reason: wave.reason,
                minRamGb,
                completedWaves,
                targetCount: targets.length,
                preparedCount,
                currentTarget: target,
            }));
            await ns.sleep(LOOP_DELAY_MS);
            continue;
        }

        // Reservation publication happens before we wait for the host to drain.
        // Existing production work is allowed to finish naturally; new work will
        // stop using this host once lib/execution.js observes the heartbeat.
        publishPrepperState(ns, makeState({
            enabled: true,
            reservedHost,
            status: "WAITING_RESERVED_HOST",
            reason: `Waiting for ${reservedHost} to become available for ${wave.action.toLowerCase()} ${target}`,
            minRamGb,
            completedWaves,
            targetCount: targets.length,
            preparedCount,
            currentTarget: target,
            currentAction: wave.action,
            requestedThreads: wave.requestedThreads,
        }));

        while (foreignProcessesOnHost(ns, reservedHost)) {
            await ns.sleep(HOST_DRAIN_POLL_MS);
            if (Date.now() - lastHeartbeat >= STATE_HEARTBEAT_MS) {
                lastHeartbeat = Date.now();
                publishPrepperState(ns, makeState({
                    enabled: true,
                    reservedHost,
                    status: "WAITING_RESERVED_HOST",
                    reason: `Reserved host ${reservedHost} is draining previous production work`,
                    minRamGb,
                    completedWaves,
                    targetCount: targets.length,
                    preparedCount,
                    currentTarget: target,
                    currentAction: wave.action,
                    requestedThreads: wave.requestedThreads,
                }));
            }
        }

        const scriptRam = ns.getScriptRam(wave.script, "home");
        const freeRam = Math.max(0, ns.getServerMaxRam(reservedHost) - ns.getServerUsedRam(reservedHost));
        const capacity = Math.floor(freeRam / Math.max(0.001, scriptRam));
        const threads = Math.min(wave.requestedThreads, capacity);
        if (threads < 1) {
            await ns.sleep(LOOP_DELAY_MS);
            continue;
        }

        const jobId = `prepper-${reservedHost}-${sequence}`;
        const pid = ns.exec(wave.script, reservedHost, threads, target, jobId, threads);
        if (pid <= 0) {
            publishPrepperState(ns, makeState({
                enabled: true,
                reservedHost,
                status: "LAUNCH_FAILED",
                reason: `Could not launch ${wave.action} on reserved host ${reservedHost}`,
                minRamGb,
                completedWaves,
                targetCount: targets.length,
                preparedCount,
                currentTarget: target,
                currentAction: wave.action,
                requestedThreads: wave.requestedThreads,
                launchedThreads: 0,
            }));
            await ns.sleep(LOOP_DELAY_MS);
            continue;
        }

        const startedAt = Date.now();
        while (ns.isRunning(pid, reservedHost)) {
            if (Date.now() - lastHeartbeat >= STATE_HEARTBEAT_MS) {
                lastHeartbeat = Date.now();
                publishPrepperState(ns, makeState({
                    enabled: true,
                    reservedHost,
                    status: "RUNNING",
                    reason: `${wave.action} ${target} on dedicated prep host`,
                    minRamGb,
                    completedWaves,
                    targetCount: targets.length,
                    preparedCount,
                    currentTarget: target,
                    currentAction: wave.action,
                    requestedThreads: wave.requestedThreads,
                    launchedThreads: threads,
                    pid,
                    startedAt,
                }));
            }
            await ns.sleep(HOST_DRAIN_POLL_MS);
        }

        completedWaves += 1;
        publishPrepperState(ns, makeState({
            enabled: true,
            reservedHost,
            status: "WAVE_COMPLETE",
            reason: `${wave.action} wave completed on ${target}`,
            minRamGb,
            completedWaves,
            targetCount: targets.length,
            preparedCount: targets.filter((hostname) => targetPrepared(ns, hostname)).length,
            currentTarget: target,
            currentAction: wave.action,
            launchedThreads: threads,
        }));

        await ns.sleep(LOOP_DELAY_MS);
    }
}

function chooseReservedHost(ns, planner, requestedHost, minRamGb) {
    const hosts = Array.isArray(planner?.executionHosts) ? planner.executionHosts : [];
    const candidates = hosts
        .map((entry) => String(entry?.hostname ?? ""))
        .filter((hostname) => hostname && hostname !== "home")
        .filter((hostname) => ns.hasRootAccess(hostname) && ns.getServerMaxRam(hostname) > 0);

    if (requestedHost) return candidates.includes(requestedHost) ? requestedHost : "";
    if (candidates.length === 0) return "";

    const preferred = candidates
        .filter((hostname) => ns.getServerMaxRam(hostname) >= minRamGb)
        .sort((a, b) => ns.getServerMaxRam(a) - ns.getServerMaxRam(b)
            || ns.getServerUsedRam(a) - ns.getServerUsedRam(b)
            || a.localeCompare(b));
    if (preferred.length > 0) return preferred[0];

    return [...candidates].sort((a, b) => ns.getServerMaxRam(b) - ns.getServerMaxRam(a) || a.localeCompare(b))[0];
}

function hostStillEligible(ns, planner, hostname) {
    return Boolean(hostname)
        && ns.hasRootAccess(hostname)
        && ns.getServerMaxRam(hostname) > 0
        && Array.isArray(planner?.executionHosts)
        && planner.executionHosts.some((entry) => String(entry?.hostname ?? "") === hostname);
}

function eligibleTargets(planner) {
    const rankings = Array.isArray(planner?.rankings) ? planner.rankings : [];
    return rankings
        .map((entry) => String(entry?.hostname ?? ""))
        .filter(Boolean);
}

function targetPrepared(ns, hostname) {
    const maxMoney = Math.max(0, ns.getServerMaxMoney(hostname));
    if (!(maxMoney > 0)) return true;
    const moneyRatio = ns.getServerMoneyAvailable(hostname) / maxMoney;
    const securityDelta = ns.getServerSecurityLevel(hostname) - ns.getServerMinSecurityLevel(hostname);
    return moneyRatio >= MONEY_READY_RATIO && securityDelta <= SECURITY_READY_DELTA;
}

function choosePrepWave(ns, host, target, sequence) {
    const weakenPerThread = Math.max(0.000001, ns.weakenAnalyze(1, 1));
    const securityDelta = Math.max(0, ns.getServerSecurityLevel(target) - ns.getServerMinSecurityLevel(target));
    if (securityDelta > SECURITY_READY_DELTA) {
        return {
            ok: true,
            action: "WEAKEN",
            script: WORKER_SCRIPTS.WEAKEN,
            requestedThreads: Math.max(1, Math.ceil((securityDelta - SECURITY_READY_DELTA) / weakenPerThread)),
            sequence,
        };
    }

    const maxMoney = Math.max(0, ns.getServerMaxMoney(target));
    const money = Math.max(0, ns.getServerMoneyAvailable(target));
    if (!(maxMoney > 0)) return { ok: false, reason: `${target} has no money` };
    if (money / maxMoney >= MONEY_READY_RATIO) return { ok: false, reason: `${target} already prepared` };

    const multiplier = maxMoney / Math.max(1, money);
    let growThreads;
    try {
        growThreads = Math.max(1, Math.ceil(ns.growthAnalyze(target, multiplier, 1)));
    } catch {
        growThreads = 1;
    }

    const scriptRam = Math.max(0.001, ns.getScriptRam(WORKER_SCRIPTS.GROW, "home"));
    const maxHostThreads = Math.max(1, Math.floor(ns.getServerMaxRam(host) / scriptRam));
    return {
        ok: true,
        action: "GROW",
        script: WORKER_SCRIPTS.GROW,
        requestedThreads: Math.min(growThreads, maxHostThreads),
        sequence,
    };
}

function foreignProcessesOnHost(ns, hostname) {
    return ns.ps(hostname).length > 0;
}

function makeState(overrides) {
    return {
        version: 1,
        model: "DEDICATED_TARGET_PREPPER_V1",
        enabled: true,
        reservedHost: "",
        status: "STARTING",
        reason: "",
        targetCount: 0,
        preparedCount: 0,
        completedWaves: 0,
        currentTarget: "",
        currentAction: "",
        requestedThreads: 0,
        launchedThreads: 0,
        pid: 0,
        startedAt: 0,
        updatedAt: Date.now(),
        ...overrides,
    };
}
