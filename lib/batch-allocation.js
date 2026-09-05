import { WORKER_SCRIPTS } from "/lib/execution.js";

export const DEFAULT_DISPATCH_LEAD_MS = 100;
export const DEFAULT_START_LEAD_MS = 250;

export function buildPreparedBatchTemplate(ns, entry, requestedHackFraction, stageGapMs, options = {}) {
    const dispatchLeadMs = Math.max(0, Number(options.dispatchLeadMs ?? DEFAULT_DISPATCH_LEAD_MS));
    const startLeadMs = Math.max(0, Number(options.startLeadMs ?? DEFAULT_START_LEAD_MS));
    const hostname = String(entry?.hostname ?? "");
    if (!hostname) return { ok: false, reason: "missing hostname" };

    const maxMoney = Math.max(0, Number(ns.getServerMaxMoney(hostname)));
    const hackPerThread = Math.max(0, Number(ns.hackAnalyze(hostname)));
    const weakenPerThread = Math.max(0, Number(ns.weakenAnalyze(1, 1)));
    if (!(maxMoney > 0 && hackPerThread > 0 && weakenPerThread > 0)) {
        return { ok: false, hostname, reason: "invalid analysis" };
    }

    const hackChance = clamp(Number(ns.hackAnalyzeChance(hostname)), 0, 1);
    const hackThreads = Math.max(1, Math.floor(requestedHackFraction / hackPerThread));
    const actualHackFraction = Math.min(0.90, hackThreads * hackPerThread);
    const growThreads = finiteCeil(ns.growthAnalyze(hostname, 1 / Math.max(0.01, 1 - actualHackFraction), 1));
    const weakenHackThreads = Math.max(1, Math.ceil(ns.hackAnalyzeSecurity(hackThreads, hostname) / weakenPerThread));
    const weakenGrowThreads = Math.max(1, Math.ceil(ns.growthAnalyzeSecurity(growThreads) / weakenPerThread));
    const times = {
        hack: ns.getHackTime(hostname),
        grow: ns.getGrowTime(hostname),
        weaken: ns.getWeakenTime(hostname),
    };
    const scriptRam = {
        HACK: ns.getScriptRam(WORKER_SCRIPTS.HACK, "home"),
        GROW: ns.getScriptRam(WORKER_SCRIPTS.GROW, "home"),
        WEAKEN: ns.getScriptRam(WORKER_SCRIPTS.WEAKEN, "home"),
    };
    if (!(scriptRam.HACK > 0 && scriptRam.GROW > 0 && scriptRam.WEAKEN > 0)) {
        return { ok: false, hostname, reason: "worker RAM unavailable" };
    }

    const stages = [
        { name: "HACK", threads: hackThreads, durationMs: times.hack, scriptRam: scriptRam.HACK, ram: hackThreads * scriptRam.HACK, offsetMs: 0 },
        { name: "WEAKEN_HACK", threads: weakenHackThreads, durationMs: times.weaken, scriptRam: scriptRam.WEAKEN, ram: weakenHackThreads * scriptRam.WEAKEN, offsetMs: stageGapMs },
        { name: "GROW", threads: growThreads, durationMs: times.grow, scriptRam: scriptRam.GROW, ram: growThreads * scriptRam.GROW, offsetMs: 2 * stageGapMs },
        { name: "WEAKEN_GROW", threads: weakenGrowThreads, durationMs: times.weaken, scriptRam: scriptRam.WEAKEN, ram: weakenGrowThreads * scriptRam.WEAKEN, offsetMs: 3 * stageGapMs },
    ];
    const ramTimeGbSec = stages.reduce((sum, stage) => sum + stage.ram * ((stage.durationMs + dispatchLeadMs) / 1000), 0);
    const batchRam = stages.reduce((sum, stage) => sum + stage.ram, 0);
    const expectedCash = maxMoney * actualHackFraction * hackChance;
    const difficulty = Math.max(1, Number(ns.getServerBaseSecurityLevel(hostname) ?? ns.getServerMinSecurityLevel(hostname) ?? 1));
    const actionThreadProxy = (hackThreads + growThreads + weakenHackThreads + weakenGrowThreads) * difficulty;
    const moneyEfficiency = ramTimeGbSec > 0 ? expectedCash / ramTimeGbSec : 0;
    const xpProxyEfficiency = ramTimeGbSec > 0 ? actionThreadProxy / ramTimeGbSec : 0;
    const firstLandingDelayMs = Math.max(
        times.hack,
        times.weaken - stageGapMs,
        times.grow - 2 * stageGapMs,
        times.weaken - 3 * stageGapMs,
    ) + startLeadMs;
    const money = ns.getServerMoneyAvailable(hostname);
    const security = ns.getServerSecurityLevel(hostname);
    const minSecurity = ns.getServerMinSecurityLevel(hostname);

    return {
        ok: true,
        hostname,
        baselineRank: Number(entry?.baselineRank ?? entry?.rank ?? 0),
        economicRank: Number(entry?.economicRank ?? 0),
        maxMoney,
        hackChance,
        actualHackFraction,
        stages,
        threads: { hack: hackThreads, weakenHack: weakenHackThreads, grow: growThreads, weakenGrow: weakenGrowThreads },
        batchRam,
        ramTimeGbSec,
        expectedCash,
        moneyEfficiency,
        xpProxyEfficiency,
        firstLandingDelayMs,
        localBatchIntervalMs: stageGapMs * 4,
        preparedNow: maxMoney > 0 && money / maxMoney >= 0.995 && security - minSecurity <= 0.05,
        moneyRatio: maxMoney > 0 ? money / maxMoney : 1,
        securityDelta: security - minSecurity,
        dispatchLeadMs,
    };
}

export function normalizeObjectiveScores(targets, weights) {
    const maxMoney = Math.max(...targets.map((x) => x.moneyEfficiency), 1e-9);
    const maxXp = Math.max(...targets.map((x) => x.xpProxyEfficiency), 1e-9);
    for (const target of targets) {
        target.moneyScoreNorm = target.moneyEfficiency / maxMoney;
        target.xpScoreNorm = target.xpProxyEfficiency / maxXp;
        target.baseScore = target.moneyScoreNorm * weights.money + target.xpScoreNorm * weights.xp;
    }
}

export function findLandingStart(target, existingLandings, earliest, globalLandingGapMs, now = Date.now()) {
    let first = Math.max(earliest, now + target.firstLandingDelayMs);
    for (let guard = 0; guard < 4000; guard += 1) {
        const planned = target.stages.map((stage) => first + stage.offsetMs);
        const conflict = planned.some((time) => existingLandings.some((other) => Math.abs(time - other) < globalLandingGapMs));
        if (!conflict) return first;
        first += globalLandingGapMs;
    }
    return first;
}

export function makeBatch(target, firstLandingAt, sequence) {
    const stages = target.stages.map((stage) => ({
        ...stage,
        startAt: firstLandingAt + stage.offsetMs - stage.durationMs,
        landingAt: firstLandingAt + stage.offsetMs,
    }));
    return {
        id: `multi-${target.hostname}-${sequence}`,
        target: target.hostname,
        firstLandingAt,
        finalLandingAt: Math.max(...stages.map((stage) => stage.landingAt)),
        stages,
    };
}

export function createHostCalendar(pool, previousHosts = [], now = Date.now()) {
    const previous = new Map(previousHosts.map((host) => [host.hostname, host]));
    return pool.map((host) => ({
        hostname: host.hostname,
        usableRam: Number(host.usableRam ?? 0),
        reservations: (previous.get(host.hostname)?.reservations ?? []).filter((r) => Number(r.endAt ?? 0) > now),
    }));
}

export function tryReserve(hosts, batch) {
    const tentative = hosts.map((host) => ({ ...host, reservations: [...host.reservations] }));
    const allocations = [];
    const stages = [...batch.stages].sort((a, b) => reservationStartAt(a) - reservationStartAt(b) || b.ram - a.ram);

    for (const stage of stages) {
        let remaining = stage.threads;
        const reserveStart = reservationStartAt(stage);
        const candidates = tentative.map((host) => {
            const occupied = maxReservedRam(host.reservations, reserveStart, stage.landingAt);
            const freeRam = Math.max(0, host.usableRam - occupied);
            return { host, capacity: Math.floor(freeRam / stage.scriptRam), freeRam };
        }).sort((a, b) => b.capacity - a.capacity || b.freeRam - a.freeRam || a.host.hostname.localeCompare(b.host.hostname));

        for (const candidate of candidates) {
            if (remaining <= 0) break;
            const threads = Math.min(remaining, candidate.capacity);
            if (threads < 1) continue;
            const ram = threads * stage.scriptRam;
            const reservation = {
                startAt: reserveStart,
                endAt: stage.landingAt,
                ram,
                target: batch.target,
                batchId: batch.id,
                stage: stage.name,
                threads,
            };
            candidate.host.reservations.push(reservation);
            allocations.push({ hostname: candidate.host.hostname, stage: stage.name, threads, ram });
            remaining -= threads;
        }
        if (remaining > 0) return { ok: false, allocations: [], hosts: tentative };
    }

    return { ok: true, allocations, hosts: tentative };
}

export function commitReservation(hosts, reservation) {
    for (let i = 0; i < hosts.length; i += 1) hosts[i].reservations = reservation.hosts[i].reservations;
}

export function peakRam(reservations) {
    const events = [];
    for (const r of reservations) {
        events.push({ at: r.startAt, delta: r.ram });
        events.push({ at: r.endAt, delta: -r.ram });
    }
    events.sort((a, b) => a.at - b.at || a.delta - b.delta);
    let current = 0;
    let peak = 0;
    for (const event of events) {
        current += event.delta;
        peak = Math.max(peak, current);
    }
    return peak;
}

function reservationStartAt(stage) {
    return Number(stage.startAt ?? 0) - Number(stage.dispatchLeadMs ?? DEFAULT_DISPATCH_LEAD_MS);
}

function maxReservedRam(reservations, startAt, endAt) {
    const events = [];
    for (const reservation of reservations) {
        if (reservation.endAt <= startAt || reservation.startAt >= endAt) continue;
        events.push({ at: Math.max(startAt, reservation.startAt), delta: reservation.ram });
        events.push({ at: Math.min(endAt, reservation.endAt), delta: -reservation.ram });
    }
    events.sort((a, b) => a.at - b.at || a.delta - b.delta);
    let current = 0;
    let peak = 0;
    for (const event of events) {
        current += event.delta;
        peak = Math.max(peak, current);
    }
    return peak;
}

function finiteCeil(value) {
    return Number.isFinite(value) && value > 0 ? Math.max(1, Math.ceil(value)) : 1;
}

function clamp(value, min, max) {
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}
