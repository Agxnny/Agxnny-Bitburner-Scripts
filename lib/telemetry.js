// HGW income telemetry transport.
//
// Port 4 is an event queue written by hack workers.
// Port 5 stores the latest aggregated telemetry snapshot.
//
// Unlike controller/planner state ports, the event port is consumed with read().

export const TelemetryPort = Object.freeze({
    HACK_EVENTS: 4,
    TELEMETRY_STATE: 5,
});

const EMPTY_PORT = "NULL PORT DATA";

/** @param {NS} ns @param {object} event */
export function publishHackEvent(ns, event) {
    const port = ns.getPortHandle(TelemetryPort.HACK_EVENTS);
    return port.tryWrite(JSON.stringify(event));
}

/** @param {NS} ns */
export function drainHackEvents(ns) {
    const port = ns.getPortHandle(TelemetryPort.HACK_EVENTS);
    const events = [];

    while (!port.empty()) {
        const raw = port.read();
        if (raw === EMPTY_PORT) break;

        try {
            const event = JSON.parse(String(raw));
            if (event && typeof event === "object") events.push(event);
        } catch {
            // Ignore malformed events so one bad message cannot block telemetry.
        }
    }

    return events;
}

/** @param {NS} ns @param {object} state */
export function publishTelemetryState(ns, state) {
    const port = ns.getPortHandle(TelemetryPort.TELEMETRY_STATE);
    port.clear();
    port.write(JSON.stringify(state));
}

/** @param {NS} ns */
export function readTelemetryState(ns) {
    const raw = ns.getPortHandle(TelemetryPort.TELEMETRY_STATE).peek();
    if (raw === EMPTY_PORT) return null;

    try {
        return JSON.parse(String(raw));
    } catch {
        return null;
    }
}
