// Shared runtime-state transport.
//
// Port 1 is reserved for the latest controller snapshot. The controller is the
// sole writer; dashboards and other consumers only peek at the current value.
// Keeping a single latest snapshot avoids stale queues and lets the dashboard
// remain read-only.

export const RuntimePort = Object.freeze({
    CONTROLLER_STATE: 1,
});

const EMPTY_PORT = "NULL PORT DATA";

/**
 * Replace the current controller snapshot with the latest structured state.
 *
 * @param {NS} ns
 * @param {object} state
 */
export function publishControllerState(ns, state) {
    const port = ns.getPortHandle(RuntimePort.CONTROLLER_STATE);
    port.clear();
    port.write(JSON.stringify(state));
}

/**
 * Read the latest controller snapshot without consuming it.
 * Returns null when nothing has been published or the payload is invalid.
 *
 * @param {NS} ns
 */
export function readControllerState(ns) {
    const raw = ns.getPortHandle(RuntimePort.CONTROLLER_STATE).peek();
    if (raw === EMPTY_PORT) return null;

    try {
        return JSON.parse(String(raw));
    } catch {
        return null;
    }
}

/**
 * Consider controller data stale if it has not been refreshed recently.
 *
 * @param {object|null} state
 * @param {number} maxAgeMs
 */
export function isControllerStateStale(state, maxAgeMs = 3000) {
    if (!state || !Number.isFinite(state.updatedAt)) return true;
    return Date.now() - state.updatedAt > maxAgeMs;
}
