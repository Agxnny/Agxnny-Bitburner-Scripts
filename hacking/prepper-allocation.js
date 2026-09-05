import { WORKER_SCRIPTS } from "/lib/execution.js";

/**
 * Compare concentration widths and choose the prep layout that maximizes the
 * number of selected targets completed per unit wall-clock time.
 *
 * A width of 1 concentrates every usable prep host on one target. Larger widths
 * trade concentration for parallel target completion. The simulator assigns at
 * least one host to each selected target, then gives remaining hosts to the
 * target with the largest projected completion time.
 */
export function choosePrepFocus(ns, orderedTargets, hosts, moneyReadyRatio, securityReadyDelta) {
    const candidates = orderedTargets
        .map((target) => ({ target, demand: prepDemand(ns, target.hostname, moneyReadyRatio, securityReadyDelta) }))
        .filter((entry) => entry.demand.ok);
    const usableHosts = hosts.filter((host) => Number(host.maxRam ?? 0) > 0);
    if (!candidates.length || !usableHosts.length) return emptyPlan();

    const maxWidth = Math.min(candidates.length, usableHosts.length);
    let best = null;
    for (let width = 1; width <= maxWidth; width += 1) {
        const trial = simulateWidth(ns, candidates.slice(0, width), usableHosts);
        if (!trial) continue;
        if (betterPlan(trial, best)) best = trial;
    }
    return best ?? emptyPlan();
}

export function prepDemand(ns, hostname, moneyReadyRatio, securityReadyDelta) {
    const maxMoney = Math.max(0, ns.getServerMaxMoney(hostname));
    if (!(maxMoney > 0)) return { ok: false, action: "READY", requestedThreads: 0, durationMs: 0, script: "" };
    const money = Math.max(0, ns.getServerMoneyAvailable(hostname));
    const moneyRatio = money / maxMoney;

    if (moneyRatio < moneyReadyRatio) {
        let threads = 1;
        try { threads = Math.max(1, Math.ceil(ns.growthAnalyze(hostname, maxMoney / Math.max(1, money), 1))); } catch { threads = 1; }
        return {
            ok: true,
            action: "GROW",
            script: WORKER_SCRIPTS.GROW,
            requestedThreads: threads,
            durationMs: Math.max(1, ns.getGrowTime(hostname)),
        };
    }

    const securityDelta = Math.max(0, ns.getServerSecurityLevel(hostname) - ns.getServerMinSecurityLevel(hostname));
    if (securityDelta > securityReadyDelta) {
        const weakenPerThread = Math.max(0.000001, ns.weakenAnalyze(1, 1));
        return {
            ok: true,
            action: "WEAKEN",
            script: WORKER_SCRIPTS.WEAKEN,
            requestedThreads: Math.max(1, Math.ceil((securityDelta - securityReadyDelta) / weakenPerThread)),
            durationMs: Math.max(1, ns.getWeakenTime(hostname)),
        };
    }
    return { ok: false, action: "READY", requestedThreads: 0, durationMs: 0, script: "" };
}

/** Estimate wall-clock time until a target is money-ready AND security-ready. */
export function estimateFullPrepEta(ns, hostname, hosts, activeJobs, moneyReadyRatio, securityReadyDelta) {
    const usableHosts = hosts.filter((host) => Number(host.maxRam ?? 0) > 0);
    if (!usableHosts.length) return Number.POSITIVE_INFINITY;

    const maxMoney = Math.max(0, ns.getServerMaxMoney(hostname));
    if (!(maxMoney > 0)) return 0;
    const money = Math.max(0, ns.getServerMoneyAvailable(hostname));
    const moneyRatio = money / maxMoney;
    const securityDelta = Math.max(0, ns.getServerSecurityLevel(hostname) - ns.getServerMinSecurityLevel(hostname));
    const jobs = Array.isArray(activeJobs) ? activeJobs : [];
    const action = jobs[0]?.action ?? "";
    const activeThreads = jobs.reduce((sum, job) => sum + Number(job.threads ?? 0), 0);
    const remainingActiveMs = jobs.length ? Math.max(0, Math.max(...jobs.map((job) => {
        const duration = job.action === "WEAKEN" ? ns.getWeakenTime(hostname) : ns.getGrowTime(hostname);
        return Number(job.startedAt ?? Date.now()) + duration - Date.now();
    }))) : 0;

    if (moneyRatio < moneyReadyRatio) {
        let growThreads = 1;
        try { growThreads = Math.max(1, Math.ceil(ns.growthAnalyze(hostname, maxMoney / Math.max(1, money), 1))); } catch { growThreads = 1; }
        const growCapacity = totalCapacity(ns, usableHosts, WORKER_SCRIPTS.GROW);
        const currentGrow = action === "GROW" ? activeThreads : 0;
        const futureGrowThreads = Math.max(0, growThreads - currentGrow);
        const growRounds = growCapacity > 0 ? Math.ceil(futureGrowThreads / growCapacity) : Number.POSITIVE_INFINITY;
        const growMs = remainingActiveMs + growRounds * Math.max(1, ns.getGrowTime(hostname));

        const projectedSecurity = securityDelta + ns.growthAnalyzeSecurity(growThreads);
        const weakenThreads = weakenThreadsNeeded(ns, projectedSecurity, securityReadyDelta);
        const weakenCapacity = totalCapacity(ns, usableHosts, WORKER_SCRIPTS.WEAKEN);
        const weakenRounds = weakenCapacity > 0 ? Math.ceil(weakenThreads / weakenCapacity) : Number.POSITIVE_INFINITY;
        return growMs + weakenRounds * Math.max(1, ns.getWeakenTime(hostname));
    }

    if (securityDelta > securityReadyDelta) {
        const weakenThreads = weakenThreadsNeeded(ns, securityDelta, securityReadyDelta);
        const weakenCapacity = totalCapacity(ns, usableHosts, WORKER_SCRIPTS.WEAKEN);
        const currentWeaken = action === "WEAKEN" ? activeThreads : 0;
        const futureWeakenThreads = Math.max(0, weakenThreads - currentWeaken);
        const rounds = weakenCapacity > 0 ? Math.ceil(futureWeakenThreads / weakenCapacity) : Number.POSITIVE_INFINITY;
        return remainingActiveMs + rounds * Math.max(1, ns.getWeakenTime(hostname));
    }

    return 0;
}

function simulateWidth(ns, selected, hosts) {
    const states = selected.map((entry) => ({ ...entry, capacity: 0, hostnames: [] }));
    const sortedHosts = [...hosts].sort((a, b) => Number(b.maxRam ?? 0) - Number(a.maxRam ?? 0));
    if (sortedHosts.length < states.length) return null;

    for (let i = 0; i < states.length; i += 1) assignHost(ns, states[i], sortedHosts[i]);
    for (let i = states.length; i < sortedHosts.length; i += 1) {
        const state = [...states].sort((a, b) => projectedMs(b) - projectedMs(a))[0];
        assignHost(ns, state, sortedHosts[i]);
    }

    const makespanMs = Math.max(...states.map(projectedMs));
    const targetsPerHour = makespanMs > 0 ? states.length * 3_600_000 / makespanMs : 0;
    const hostPlan = [];
    for (const state of states) {
        let remaining = state.demand.requestedThreads;
        for (const host of state.hostnames) {
            if (remaining <= 0) break;
            const capacity = threadCapacity(ns, host, state.demand.script);
            const threads = Math.min(remaining, capacity);
            if (threads > 0) hostPlan.push({ hostname: host.hostname, target: state.target.hostname, action: state.demand.action, script: state.demand.script, threads });
            remaining -= threads;
        }
    }

    return {
        focusWidth: states.length,
        focusTargets: states.map((state) => state.target.hostname),
        mode: states.length <= Math.max(2, Math.floor(hosts.length / 4)) ? "FOCUS" : "SPREAD",
        estimatedMakespanMs: makespanMs,
        estimatedTargetsPerHour: targetsPerHour,
        hostPlan,
    };
}

function assignHost(ns, state, host) {
    state.hostnames.push(host);
    state.capacity += threadCapacity(ns, host, state.demand.script);
}

function projectedMs(state) {
    if (state.capacity <= 0) return Number.POSITIVE_INFINITY;
    const rounds = Math.max(1, Math.ceil(state.demand.requestedThreads / state.capacity));
    return rounds * state.demand.durationMs;
}

function threadCapacity(ns, host, script) {
    const ram = Math.max(0.001, ns.getScriptRam(script, "home"));
    return Math.max(0, Math.floor(Number(host.maxRam ?? 0) / ram));
}

function totalCapacity(ns, hosts, script) {
    return hosts.reduce((sum, host) => sum + threadCapacity(ns, host, script), 0);
}

function weakenThreadsNeeded(ns, securityDelta, securityReadyDelta) {
    if (securityDelta <= securityReadyDelta) return 0;
    const perThread = Math.max(0.000001, ns.weakenAnalyze(1, 1));
    return Math.max(0, Math.ceil((securityDelta - securityReadyDelta) / perThread));
}

function betterPlan(candidate, current) {
    if (!current) return true;
    const throughputGain = candidate.estimatedTargetsPerHour / Math.max(0.000001, current.estimatedTargetsPerHour);
    if (throughputGain > 1.02) return true;
    if (throughputGain < 0.98) return false;
    if (candidate.estimatedMakespanMs < current.estimatedMakespanMs * 0.98) return true;
    if (candidate.estimatedMakespanMs > current.estimatedMakespanMs * 1.02) return false;
    return candidate.focusWidth < current.focusWidth;
}

function emptyPlan() {
    return { focusWidth: 0, focusTargets: [], mode: "IDLE", estimatedMakespanMs: 0, estimatedTargetsPerHour: 0, hostPlan: [] };
}
