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

    if (ns.fileExists(selfPath, "home")) {
        const removed = ns.rm(selfPath, "home");
        if (!removed) {
            ns.tprint(`FAILED    ${selfPath}`);
            ns.tprint("          Could not remove old updater after handoff.");
            return;
        }
        ns.tprint(`REMOVED   ${selfPath}`);
    }

    const ok = await ns.wget(url, selfPath, "home");
    if (!ok) {
        ns.tprint(`FAILED    ${selfPath}`);
        ns.tprint(`          ${url}`);
        return;
    }

    ns.tprint(`REPLACED  ${selfPath}`);
    ns.tprint("CONFIRMED: gitpull.js was freshly installed after handoff.");
}
