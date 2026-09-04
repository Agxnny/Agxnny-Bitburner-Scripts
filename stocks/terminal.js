/**
 * Stock-trading terminal placeholder.
 *
 * This subsystem is intentionally separate from the main HGW control plane.
 * Later it will own stock-specific logs, trade decisions, and execution state.
 * For now it only provides a dedicated terminal surface and clear extension point.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.ui.openTail();
    ns.ui.setTailTitle("Agxnny Stocks - Terminal");
    ns.ui.resizeTail(760, 420);

    while (true) {
        ns.clearLog();
        ns.print("=== STOCK TRADING TERMINAL ===");
        ns.print("");
        ns.print("Status:     NOT CONFIGURED");
        ns.print("Execution:  DISABLED");
        ns.print("Trading:    No orders will be placed.");
        ns.print("");
        ns.print("This terminal is reserved for the future stock engine.");
        ns.print("The stock system is intentionally isolated from HGW automation.");
        await ns.sleep(2000);
    }
}
