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

    const manifestUrl = `${baseUrl}/manifest.json?ts=${cacheBust}`;
    const manifestOk = await ns.wget(manifestUrl, manifestPath, "home");

    if (!manifestOk) {
        ns.tprint("ERROR: Could not download manifest.json.");
        ns.tprint(`Tried: ${manifestUrl}`);
        ns.tprint("Test the raw URL directly with Bitburner's terminal wget command.");
        return;
    }

    let manifest;
    try {
        manifest = JSON.parse(ns.read(manifestPath));
    } catch (error) {
        ns.tprint(`ERROR: Downloaded manifest is invalid JSON: ${String(error)}`);
        ns.tprint(`Contents: ${ns.read(manifestPath)}`);
        return;
    }

    if (!Array.isArray(manifest.files)) {
        ns.tprint("ERROR: manifest.json does not contain a files array.");
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
        const url = `${baseUrl}/${file}?ts=${Date.now()}`;
        const ok = await ns.wget(url, file, "home");

        if (ok) {
            succeeded++;
            ns.tprint(`OK   ${file}`);
        } else {
            failed.push(file);
            ns.tprint(`FAIL ${file}`);
            ns.tprint(`     ${url}`);
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
