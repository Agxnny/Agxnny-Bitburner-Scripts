/**
 * Pull the Bitburner script set from the GitHub repository.
 *
 * Clean-pull behavior is intentionally destructive for repo-managed automation.
 * Existing file contents are captured before removal so the pull can distinguish
 * truly UPDATED files from unchanged files that were merely cleaned/replaced.
 *
 * Usage:
 *   run gitpull.js
 *   run gitpull.js --branch dev
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const flags = ns.flags([
        ["branch", "main"],
        ["help", false],
    ]);

    if (flags.help) {
        printHelp(ns);
        return;
    }
    if (ns.getHostname() !== "home") {
        ns.tprint("ERROR: Run gitpull.js from home.");
        return;
    }

    const owner = "Agxnny";
    const repo = "Agxnny-Bitburner-Scripts";
    const branch = String(flags.branch);
    const baseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;
    const manifestPath = "repo-manifest.json";
    const selfPath = "gitpull.js";
    const helperPath = "gitpull-self-update.js";
    const deployedRemoteFiles = [
        "/hacking/workers/hack.js", "/hacking/workers/grow.js", "/hacking/workers/weaken.js",
        "/hacking/tactical-planner.js", "/hacking/telemetry.js", "/lib/threads.js",
        "/lib/runtime-state.js", "/lib/telemetry.js", "/lib/state.js", "/lib/execution.js",
    ];

    ns.tprint(`Pulling ${owner}/${repo}@${branch}...`);
    ns.tprint("FULL CLEAN PULL: stopping active automation before replacement.");
    ns.tprint("");

    const hosts = discoverNetwork(ns);
    const shutdown = stopAllOtherScripts(ns, hosts);
    ns.tprint(`STOPPED    ${shutdown.stopped} script(s) across ${hosts.length} discovered host(s)`);
    if (shutdown.failed > 0) ns.tprint(`WARNING:   ${shutdown.failed} script(s) could not be stopped.`);

    const remoteCleanup = cleanRemoteFiles(ns, hosts, deployedRemoteFiles);
    ns.tprint(`CLEANED    ${remoteCleanup} deployed execution file(s) from remote hosts`);
    ns.tprint("");

    if (ns.fileExists(manifestPath, "home")) ns.rm(manifestPath, "home");
    const manifestUrl = `${baseUrl}/manifest.json?ts=${Date.now()}`;
    if (!await ns.wget(manifestUrl, manifestPath, "home")) {
        ns.tprint("ERROR: Could not download manifest.json.");
        return;
    }
    ns.tprint(`DOWNLOADED ${manifestPath}`);
    ns.tprint("");

    let manifest;
    try {
        manifest = JSON.parse(ns.read(manifestPath));
    } catch (error) {
        ns.tprint(`ERROR: Downloaded manifest is invalid JSON: ${String(error)}`);
        ns.rm(manifestPath, "home");
        return;
    }
    if (!Array.isArray(manifest.files)) {
        ns.tprint("ERROR: manifest.json does not contain a files array.");
        ns.rm(manifestPath, "home");
        return;
    }

    const files = manifest.files.map(String);
    const normalFiles = files.filter((file) => file !== selfPath);
    const staleRemoved = removeStaleManagedFiles(ns, files, selfPath, manifestPath);
    if (staleRemoved > 0) ns.tprint(`STALE      removed ${staleRemoved} repo-managed file(s) no longer in manifest`);

    let succeeded = 0;
    let replaced = 0;
    let updated = 0;
    let unchanged = 0;
    let added = 0;
    const failed = [];
    const updatedFiles = [];

    for (const file of normalFiles) {
        const existed = ns.fileExists(file, "home");
        const oldContent = existed ? String(ns.read(file)) : null;

        if (existed && !ns.rm(file, "home")) {
            failed.push(file);
            ns.tprint(`FAILED     ${file}`);
            continue;
        }

        const url = `${baseUrl}/${file}?ts=${Date.now()}`;
        const ok = await ns.wget(url, file, "home");
        if (!ok) {
            failed.push(file);
            ns.tprint(`FAILED     ${file}`);
            continue;
        }

        succeeded++;
        if (!existed) {
            added++;
            ns.tprint(`ADDED      ${file}`);
            continue;
        }

        replaced++;
        const newContent = String(ns.read(file));
        if (newContent !== oldContent) {
            updated++;
            updatedFiles.push(file);
            ns.tprint(`UPDATED    ${file}`);
        } else {
            unchanged++;
            ns.tprint(`REPLACED   ${file} (unchanged)`);
        }
    }

    ns.rm(manifestPath, "home");
    ns.tprint("");
    ns.tprint("========== FULL CLEAN PULL STATUS ==========");
    ns.tprint(`Stopped    : ${shutdown.stopped} script(s)`);
    ns.tprint(`Remote rm  : ${remoteCleanup} execution file(s)`);
    ns.tprint(`Stale rm   : ${staleRemoved} local file(s)`);
    ns.tprint(`Successful : ${succeeded}/${normalFiles.length} pre-handoff file(s)`);
    ns.tprint(`UPDATED    : ${updated}`);
    ns.tprint(`Unchanged  : ${unchanged}`);
    ns.tprint(`Replaced   : ${replaced}`);
    ns.tprint(`Added      : ${added}`);
    ns.tprint(`Failed     : ${failed.length}`);
    if (updatedFiles.length > 0) ns.tprint(`Updated files: ${updatedFiles.join(", ")}`);

    if (failed.length > 0) {
        ns.tprint(`Failed files: ${failed.join(", ")}`);
        ns.tprint("Self-update skipped because the main pull was not clean.");
        return;
    }
    if (!files.includes(selfPath)) {
        ns.tprint(`WARNING: ${selfPath} is not listed in manifest.json.`);
        return;
    }
    if (!ns.fileExists(helperPath, "home")) {
        ns.tprint(`ERROR: ${helperPath} is missing; cannot replace the running updater.`);
        return;
    }

    ns.tprint(`HANDOFF: Checking/replacing ${selfPath} after this process exits...`);
    ns.spawn(helperPath, 1, owner, repo, branch);
}

function discoverNetwork(ns) {
    const visited = new Set(["home"]);
    const queue = ["home"];
    while (queue.length > 0) {
        const host = queue.shift();
        for (const neighbor of ns.scan(host)) {
            if (visited.has(neighbor)) continue;
            visited.add(neighbor);
            queue.push(neighbor);
        }
    }
    return [...visited];
}

function stopAllOtherScripts(ns, hosts) {
    let stopped = 0;
    let failed = 0;
    for (const host of hosts) {
        for (const process of ns.ps(host)) {
            if (host === "home" && process.pid === ns.pid) continue;
            if (ns.kill(process.pid)) stopped += 1;
            else failed += 1;
        }
    }
    return { stopped, failed };
}

function cleanRemoteFiles(ns, hosts, files) {
    let removed = 0;
    for (const host of hosts) {
        if (host === "home") continue;
        for (const file of files) {
            if (ns.fileExists(file, host) && ns.rm(file, host)) removed += 1;
        }
    }
    return removed;
}

function removeStaleManagedFiles(ns, manifestFiles, selfPath, manifestPath) {
    const managedRoots = ["hacking/", "lib/", "network/", "diagnostics/"];
    const keep = new Set([...manifestFiles, selfPath, manifestPath]);
    let removed = 0;
    for (const file of ns.ls("home")) {
        if (!managedRoots.some((root) => file.startsWith(root)) || keep.has(file)) continue;
        if (ns.rm(file, "home")) {
            removed += 1;
            ns.tprint(`STALE RM   ${file}`);
        }
    }
    return removed;
}

function printHelp(ns) {
    ns.tprint("gitpull.js - full clean-update Bitburner automation from GitHub");
    ns.tprint("Usage: run gitpull.js [--branch main]");
    ns.tprint("UPDATED marks files whose contents actually changed.");
    ns.tprint("REPLACED (unchanged) marks files refreshed by the clean pull but identical to the old copy.");
    ns.tprint("WARNING: stops every other active script on discovered hosts.");
}
