/**
 * Pull the Bitburner script set from the GitHub repository.
 *
 * Clean-pull behavior is intentionally destructive for repo-managed automation:
 *   1. stop every other running script on every discovered host,
 *   2. remove deployed execution/tactical/telemetry files from remote hosts,
 *   3. remove stale repo-managed files on home,
 *   4. freshly download every manifest file,
 *   5. hand off to a helper so gitpull.js itself can be replaced.
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
        "/hacking/workers/hack.js",
        "/hacking/workers/grow.js",
        "/hacking/workers/weaken.js",
        "/hacking/tactical-planner.js",
        "/hacking/telemetry.js",
        "/lib/threads.js",
        "/lib/runtime-state.js",
        "/lib/telemetry.js",
        "/lib/state.js",
        "/lib/execution.js",
    ];

    ns.tprint(`Pulling ${owner}/${repo}@${branch}...`);
    ns.tprint("FULL CLEAN PULL: stopping active automation before replacement.");
    ns.tprint("");

    const hosts = discoverNetwork(ns);
    const shutdown = stopAllOtherScripts(ns, hosts);
    ns.tprint(`STOPPED    ${shutdown.stopped} script(s) across ${hosts.length} discovered host(s)`);
    if (shutdown.failed > 0) {
        ns.tprint(`WARNING:   ${shutdown.failed} script(s) could not be stopped.`);
    }

    const remoteCleanup = cleanRemoteFiles(ns, hosts, deployedRemoteFiles);
    ns.tprint(`CLEANED    ${remoteCleanup} deployed execution file(s) from remote hosts`);
    ns.tprint("");

    if (ns.fileExists(manifestPath, "home")) {
        const removedManifest = ns.rm(manifestPath, "home");
        if (removedManifest) ns.tprint(`REMOVED   ${manifestPath}`);
    }

    const manifestUrl = `${baseUrl}/manifest.json?ts=${Date.now()}`;
    const manifestOk = await ns.wget(manifestUrl, manifestPath, "home");

    if (!manifestOk) {
        ns.tprint("ERROR: Could not download manifest.json.");
        ns.tprint(`Tried: ${manifestUrl}`);
        return;
    }

    ns.tprint(`DOWNLOADED ${manifestPath}`);
    ns.tprint("");

    let manifest;
    try {
        manifest = JSON.parse(ns.read(manifestPath));
    } catch (error) {
        ns.tprint(`ERROR: Downloaded manifest is invalid JSON: ${String(error)}`);
        ns.tprint(`Contents: ${ns.read(manifestPath)}`);
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
    if (staleRemoved > 0) {
        ns.tprint(`STALE      removed ${staleRemoved} repo-managed file(s) no longer in manifest`);
        ns.tprint("");
    }

    let succeeded = 0;
    let replaced = 0;
    let added = 0;
    const failed = [];

    for (const file of normalFiles) {
        const existed = ns.fileExists(file, "home");

        if (existed) {
            const removed = ns.rm(file, "home");
            if (!removed) {
                failed.push(file);
                ns.tprint(`FAILED    ${file}`);
                ns.tprint("          Could not remove existing file.");
                continue;
            }

            ns.tprint(`REMOVED   ${file}`);
        }

        const url = `${baseUrl}/${file}?ts=${Date.now()}`;
        const ok = await ns.wget(url, file, "home");

        if (ok) {
            succeeded++;

            if (existed) {
                replaced++;
                ns.tprint(`REPLACED  ${file}`);
            } else {
                added++;
                ns.tprint(`ADDED     ${file}`);
            }
        } else {
            failed.push(file);
            ns.tprint(`FAILED    ${file}`);
            ns.tprint(`          ${url}`);
        }
    }

    ns.rm(manifestPath, "home");

    ns.tprint("");
    ns.tprint("========== FULL CLEAN PULL STATUS ==========");
    ns.tprint(`Stopped    : ${shutdown.stopped} script(s)`);
    ns.tprint(`Remote rm  : ${remoteCleanup} execution file(s)`);
    ns.tprint(`Stale rm   : ${staleRemoved} local file(s)`);
    ns.tprint(`Successful : ${succeeded}/${normalFiles.length} pre-handoff file(s)`);
    ns.tprint(`Replaced   : ${replaced}`);
    ns.tprint(`Added      : ${added}`);
    ns.tprint(`Failed     : ${failed.length}`);

    if (failed.length > 0) {
        ns.tprint(`Failed files: ${failed.join(", ")}`);
        ns.tprint("WARNING: Failed files may be missing because clean pull removes the old copy first.");
        ns.tprint("Self-update skipped because the main pull was not clean.");
        return;
    }

    if (!files.includes(selfPath)) {
        ns.tprint(`WARNING: ${selfPath} is not listed in manifest.json.`);
        ns.tprint("CONFIRMED: All other managed files were freshly installed.");
        return;
    }

    if (!ns.fileExists(helperPath, "home")) {
        ns.tprint(`ERROR: ${helperPath} is missing; cannot replace the running updater.`);
        return;
    }

    ns.tprint("CONFIRMED: active automation stopped and managed files freshly installed.");
    ns.tprint(`HANDOFF: Replacing ${selfPath} after this process exits...`);

    ns.spawn(helperPath, 1, owner, repo, branch);
}

/** @param {NS} ns */
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

/** @param {NS} ns @param {string[]} hosts */
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

/** @param {NS} ns @param {string[]} hosts @param {string[]} files */
function cleanRemoteFiles(ns, hosts, files) {
    let removed = 0;

    for (const host of hosts) {
        if (host === "home") continue;

        for (const file of files) {
            if (!ns.fileExists(file, host)) continue;
            if (ns.rm(file, host)) removed += 1;
        }
    }

    return removed;
}

/**
 * Remove files inside repo-owned script roots when they are no longer listed in
 * the downloaded manifest. This prevents renamed/deleted scripts from lingering.
 *
 * @param {NS} ns
 * @param {string[]} manifestFiles
 * @param {string} selfPath
 * @param {string} manifestPath
 */
function removeStaleManagedFiles(ns, manifestFiles, selfPath, manifestPath) {
    const managedRoots = ["hacking/", "lib/", "network/", "diagnostics/"];
    const keep = new Set([...manifestFiles, selfPath, manifestPath]);
    let removed = 0;

    for (const file of ns.ls("home")) {
        const managed = managedRoots.some((root) => file.startsWith(root));
        if (!managed || keep.has(file)) continue;

        if (ns.rm(file, "home")) {
            removed += 1;
            ns.tprint(`STALE RM  ${file}`);
        }
    }

    return removed;
}

/** @param {NS} ns */
function printHelp(ns) {
    ns.tprint("gitpull.js - full clean-update Bitburner automation from GitHub");
    ns.tprint("Usage: run gitpull.js [--branch main]");
    ns.tprint("WARNING: stops every other active script on discovered hosts.");
    ns.tprint("Remote workers/tactical/telemetry files are removed and must be redeployed after the pull.");
    ns.tprint("Stale files under hacking/, lib/, network/, and diagnostics/ are removed.");
    ns.tprint("gitpull.js itself is replaced by a handoff helper after the updater exits.");
}
