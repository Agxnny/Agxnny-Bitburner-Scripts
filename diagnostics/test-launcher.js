const TEST_REQUEST_PORT = 6;
const EMPTY_PORT = "NULL PORT DATA";
const TEST_SCRIPT = "/diagnostics/test.js";

/**
 * Persistent low-frequency command listener intended to run on a remote host.
 * The dashboard writes explicit user-clicked test requests to Port 6; this
 * launcher consumes them and starts diagnostics/test.js off home.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");

    while (true) {
        const raw = ns.getPortHandle(TEST_REQUEST_PORT).read();
        if (raw === EMPTY_PORT) {
            await ns.sleep(200);
            continue;
        }

        const request = parseRequest(raw);
        if (!request) continue;

        const pid = ns.run(TEST_SCRIPT, 1, request.test);
        if (pid <= 0) {
            ns.print(`Could not launch ${TEST_SCRIPT} ${request.test}`);
        }
    }
}

function parseRequest(raw) {
    try {
        const request = JSON.parse(String(raw));
        const test = String(request?.test ?? "").trim();
        if (!test) return null;
        return { test };
    } catch {
        return null;
    }
}
