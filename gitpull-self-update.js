/**
 * Helper used by gitpull.js to replace gitpull.js after the parent updater exits.
 * Do not run this manually.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    if (ns.getHostname() !== "home") {
        ns.tprint("ERROR: gitpull-self-update.js must run on home.");
        return;
    }

    const owner = String(ns.args[0] ?? "Agxnny");
    const repo = String(ns.args[1] ?? "Agxnny-Bitburner-Scripts");
    const branch = String(ns.args[2] ?? "main");
    const selfPath = "gitpull.js";
    const baseUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;
    const url = `${baseUrl}/${selfPath}?ts=${Date.now()}`;

    await ns.sleep(50);

    const existed = ns.fileExists(selfPath, "home");
    const oldContent = existed ? String(ns.read(selfPath)) : null;

    if (existed && !ns.rm(selfPath, "home")) {
        ns.tprint(`FAILED     ${selfPath}`);
        ns.tprint("           Could not remove old updater after handoff.");
        return;
    }

    const ok = await ns.wget(url, selfPath, "home");
    if (!ok) {
        ns.tprint(`FAILED     ${selfPath}`);
        ns.tprint(`           ${url}`);
        return;
    }

    const newContent = String(ns.read(selfPath));
    if (!existed) ns.tprint(`ADDED      ${selfPath}`);
    else if (newContent !== oldContent) ns.tprint(`UPDATED    ${selfPath}`);
    else ns.tprint(`REPLACED   ${selfPath} (unchanged)`);
    ns.tprint("CONFIRMED: gitpull.js handoff completed.");
}
