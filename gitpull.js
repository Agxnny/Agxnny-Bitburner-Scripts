/**
 * Pull the Bitburner script set from the GitHub repository.
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
    const cacheBust = Date.now();

    ns.tprint(`Pulling ${owner}/${repo}@${branch}...`);

    if (ns.fileExists(manifestPath, "home")) {
        ns.rm(manifestPath, "home");
    }

    const manifestUrl = `${baseUrl}/manifest.json?ts=${cacheBust}`;
    const manifestOk = await ns.wget(manifestUrl, manifestPath, "home");

    if (!manifestOk) {
        ns.tprint("ERROR: Could not download manifest.json.");
        ns.tprint(`Tried: ${manifestUrl}`);
        return;
    }

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
    const selfPath = "gitpull.js";
    const orderedFiles = [
        ...files.filter((file) => file !== selfPath),
        ...files.filter((file) => file === selfPath),
    ];

    let succeeded = 0;
    const failed = [];

    for (const file of orderedFiles) {
        const existed = ns.fileExists(file, "home");

        if (existed) {
            const removed = ns.rm(file, "home");
            if (!removed) {
                failed.push(file);
                ns.tprint(`FAIL ${file}`);
                ns.tprint("     Could not remove existing file.");
                continue;
            }
            ns.tprint(`DEL  ${file}`);
        }

        const url = `${baseUrl}/${file}?ts=${Date.now()}`;
        const ok = await ns.wget(url, file, "home");

        if (ok) {
            succeeded++;
            ns.tprint(`${existed ? "NEW " : "ADD "} ${file}`);
        } else {
            failed.push(file);
            ns.tprint(`FAIL ${file}`);
            ns.tprint(`     ${url}`);
        }
    }

    ns.rm(manifestPath, "home");

    ns.tprint("");
    ns.tprint(`Pull complete: ${succeeded}/${files.length} file(s) installed fresh.`);

    if (failed.length > 0) {
        ns.tprint(`Failed: ${failed.join(", ")}`);
        ns.tprint("WARNING: Failed files may now be missing because clean pull removes the old copy first.");
    }
}

/** @param {NS} ns */
function printHelp(ns) {
    ns.tprint("gitpull.js - clean-update Bitburner scripts from GitHub");
    ns.tprint("Usage: run gitpull.js [--branch main]");
    ns.tprint("Existing managed files are deleted before fresh copies are downloaded.");
}
