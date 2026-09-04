/**
 * Pull the Bitburner script set from the GitHub repository.
 *
 * Usage:
 *   run gitpull.js
 *   run gitpull.js --branch dev
 *
 * Important: GitHub raw URLs for private repositories require authentication,
 * and Netscript's wget does not provide a safe way to attach GitHub auth
 * headers. This script therefore works directly when the repository/files are
 * publicly reachable, or when BASE_URL is changed to another reachable mirror.
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

    const owner = "Agxnny";
    const repo = "Agxnny-Bitburner-Scripts";
    const branch = String(flags.branch);
    const baseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;
    const manifestPath = "/data/repo-manifest.json";

    ns.tprint(`Pulling ${owner}/${repo}@${branch}...`);

    const manifestOk = await ns.wget(`${baseUrl}/manifest.json`, manifestPath, "home");
    if (!manifestOk) {
        ns.tprint("ERROR: Could not download manifest.json.");
        ns.tprint("If the GitHub repository is private, raw.githubusercontent.com will reject the request.");
        ns.tprint("Do not embed a GitHub token in this script. Use a public/mirrored source instead.");
        return;
    }

    let manifest;
    try {
        manifest = JSON.parse(ns.read(manifestPath));
    } catch (error) {
        ns.tprint(`ERROR: Downloaded manifest is invalid JSON: ${String(error)}`);
        return;
    }

    if (!Array.isArray(manifest.files)) {
        ns.tprint("ERROR: manifest.json does not contain a files array.");
        return;
    }

    const files = manifest.files.map(String);
    const selfPath = "gitpull.js";
    const normalFiles = files.filter((file) => file !== selfPath);
    const selfFiles = files.filter((file) => file === selfPath);

    let succeeded = 0;
    const failed = [];

    // Pull the updater itself last so the currently running source is not
    // replaced until every other repository script has been attempted.
    for (const file of [...normalFiles, ...selfFiles]) {
        const url = `${baseUrl}/${file}`;
        const ok = await ns.wget(url, file, "home");

        if (ok) {
            succeeded++;
            ns.tprint(`OK   ${file}`);
        } else {
            failed.push(file);
            ns.tprint(`FAIL ${file}`);
        }
    }

    ns.rm(manifestPath, "home");

    ns.tprint("");
    ns.tprint(`Pull complete: ${succeeded}/${files.length} file(s) updated.`);

    if (failed.length > 0) {
        ns.tprint(`Failed: ${failed.join(", ")}`);
    }
}

/** @param {NS} ns */
function printHelp(ns) {
    ns.tprint("gitpull.js - update Bitburner scripts from GitHub");
    ns.tprint("Usage: run gitpull.js [--branch main]");
}
