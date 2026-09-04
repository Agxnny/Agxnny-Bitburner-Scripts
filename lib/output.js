// Shared output/argument helpers.
//
// Every runnable script can opt into --quiet without changing its core logic.
// Quiet mode suppresses explicit print/tprint output; state publication and work
// continue normally. Launchers can propagate the flag to child scripts.

const QUIET_FLAGS = Object.freeze(new Set(["--quiet", "--silent"]));

/** @param {NS} ns */
export function isQuiet(ns) {
    return ns.args.some((arg) => QUIET_FLAGS.has(String(arg).toLowerCase()));
}

/** Return positional arguments with shared output-control flags removed. */
export function positionalArgs(ns) {
    return ns.args.filter((arg) => !QUIET_FLAGS.has(String(arg).toLowerCase()));
}

/** Return args that propagate the caller's output mode to a child script. */
export function quietArgs(ns) {
    return isQuiet(ns) ? ["--quiet"] : [];
}

/** @param {NS} ns */
export function tprint(ns, ...values) {
    if (!isQuiet(ns)) ns.tprint(...values);
}

/** @param {NS} ns */
export function print(ns, ...values) {
    if (!isQuiet(ns)) ns.print(...values);
}
