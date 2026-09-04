/**
 * Stock-trading GUI placeholder.
 *
 * Kept separate from the main HGW dashboard so stock trading can evolve into its
 * own terminal, state model, controls, charts, and risk settings later.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.ui.openTail();
    ns.ui.setTailTitle("Agxnny Stocks");
    ns.ui.resizeTail(900, 560);

    while (true) {
        ns.clearLog();
        ns.printRaw(view());
        await ns.sleep(1500);
    }
}

function view() {
    return React.createElement("div", { style: styles.app },
        React.createElement("div", { style: styles.eyebrow }, "AGXNNY AUTOMATION"),
        React.createElement("div", { style: styles.title }, "Stock Trading"),
        React.createElement("div", { style: styles.sub }, "Independent trading workspace · currently disabled"),
        React.createElement("div", { style: styles.grid },
            card("ENGINE", "Not configured", "No stock orders will be placed."),
            card("PORTFOLIO", "—", "Portfolio state will live here."),
            card("SIGNALS", "—", "Forecast and position signals will live here."),
            card("RISK", "Disabled", "Position sizing and loss limits will live here."),
        ),
        React.createElement("div", { style: styles.note },
            "This GUI is intentionally separate from the HGW control plane. Future stock work can add its own runtime state and trading controls without bloating the main dashboard.",
        ),
    );
}

function card(label, value, sub) {
    return React.createElement("div", { style: styles.card },
        React.createElement("div", { style: styles.label }, label),
        React.createElement("div", { style: styles.value }, value),
        React.createElement("div", { style: styles.cardSub }, sub),
    );
}

const styles = {
    app: { fontFamily: "monospace", background: "#0b0f14", color: "#d7e0ea", minHeight: "100%", padding: "20px", boxSizing: "border-box" },
    eyebrow: { fontSize: "10px", letterSpacing: "2px", color: "#6c7f92" },
    title: { fontSize: "24px", fontWeight: 700, color: "#f3f7fb", marginTop: "4px" },
    sub: { color: "#8796a5", fontSize: "11px", marginTop: "5px", marginBottom: "18px" },
    grid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: "10px" },
    card: { background: "#10161d", border: "1px solid #242f3a", borderRadius: "8px", padding: "14px" },
    label: { fontSize: "10px", letterSpacing: "1px", color: "#708090" },
    value: { fontSize: "18px", color: "#edf3f8", marginTop: "6px" },
    cardSub: { fontSize: "10px", color: "#7f8d9a", marginTop: "5px" },
    note: { marginTop: "12px", padding: "10px", background: "#0d1319", borderLeft: "2px solid #35566f", color: "#81909d", fontSize: "10px", lineHeight: 1.5 },
};
