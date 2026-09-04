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

    ns.tprint(`Pulling ${owner}/${repo}@${branch}...`);
    ns.tprint("Clean pull: existing managed files will be removed and replaced.");
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
    const selfPath = "gitpull.js";
    const orderedFiles = [
        ...files.filter((file) => file !== selfPath),
        ...files.filter((file) => file === selfPath),
    ];

    let succeeded = 0;
    let replaced = 0;
    let added = 0;
    const failed = [];

    for (const file of orderedFiles) {
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
    ns.tprint("========== CLEAN PULL COMPLETE ==========");
    ns.tprint(`Successful : ${succeeded}/${files.length}`);
    ns.tprint(`Replaced   : ${replaced}`);
    ns.tprint(`Added      : ${added}`);
    ns.tprint(`Failed     : ${failed.length}`);

    if (failed.length === 0) {
        ns.tprint("CONFIRMED: All managed files were freshly installed.");
    } else {
        ns.tprint(`Failed files: ${failed.join(", ")}`);
        ns.tprint("WARNING: Failed files may be missing because clean pull removes the old copy first.");
    }
}

/** @param {NS} ns */
function printHelp(ns) {
    ns.tprint("gitpull.js - clean-update Bitburner scripts from GitHub");
    ns.tprint("Usage: run gitpull.js [--branch main]");
    ns.tprint("Existing managed files are deleted before fresh copies are downloaded.");
}
