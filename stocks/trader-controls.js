import { stockStyles as s } from "/stocks/styles.js";

export function TraderControls({ config, traderState, traderRunning, onSave }) {
    const source = config ?? { mode: "PERCENT", percent: 15, amount: 1e9, stopLossPercent: 5, cashFloor: 100e6, updatedAt: 0 };
    const [mode, setMode] = React.useState(source.mode);
    const [percent, setPercent] = React.useState(String(source.percent));
    const [amount, setAmount] = React.useState(formatInputAmount(source.amount));
    const [stopLoss, setStopLoss] = React.useState(String(source.stopLossPercent ?? 5));
    const [seenAt, setSeenAt] = React.useState(Number(source.updatedAt ?? 0));

    React.useEffect(() => {
        const updatedAt = Number(source.updatedAt ?? 0);
        if (updatedAt === seenAt) return;
        setMode(source.mode);
        setPercent(String(source.percent));
        setAmount(formatInputAmount(source.amount));
        setStopLoss(String(source.stopLossPercent ?? 5));
        setSeenAt(updatedAt);
    }, [source.updatedAt]);

    const save = () => onSave({
        ...source,
        mode,
        percent: clamp(Number(percent) || 0, 0, 30),
        amount: Math.max(0, parseCash(amount)),
        stopLossPercent: clamp(Number(stopLoss) || 0, 0, 50),
    });

    const state = traderState ?? {};
    const configured = mode === "PERCENT"
        ? `${clamp(Number(percent) || 0, 0, 30).toFixed(1)}% of player cash`
        : money(parseCash(amount));

    return el("div", { style: { ...s.card, marginBottom: "7px" } },
        el("div", { style: s.titleRow },
            el("span", { style: s.cardTitle }, "Pre-4S trader controls"),
            badge(traderRunning ? "LIVE" : "STOPPED", traderRunning ? "good" : "warn"),
        ),
        el("div", { style: { display: "flex", gap: "8px", alignItems: "end", flexWrap: "wrap" } },
            field("Capital mode", el("select", { value: mode, onChange: (event) => setMode(event.target.value), style: s.select },
                el("option", { value: "PERCENT" }, "% OF PLAYER CASH"),
                el("option", { value: "AMOUNT" }, "FIXED AMOUNT"),
            )),
            mode === "PERCENT"
                ? field("Available to trade (%)", el("input", { type: "number", min: 0, max: 30, step: 1, value: percent, onChange: (event) => setPercent(event.target.value), style: inputStyle() }))
                : field("Available to trade ($)", el("input", { type: "text", value: amount, onChange: (event) => setAmount(event.target.value), placeholder: "1b", style: inputStyle() })),
            field("Stop loss (%)", el("input", { type: "number", min: 0, max: 50, step: 0.5, value: stopLoss, onChange: (event) => setStopLoss(event.target.value), style: inputStyle() })),
            el("button", { onClick: save, style: { ...s.badge, ...s.accent, cursor: "pointer", fontFamily: "monospace", padding: "7px 12px" } }, "SAVE"),
        ),
        el("div", { style: s.stats },
            stat("Configured", configured),
            stat("Live limit", money(state.capitalLimit ?? 0)),
            stat("Exposure", money(state.exposure ?? 0)),
            stat("Stop loss", `${Number(source.stopLossPercent ?? 0).toFixed(1)}%`),
        ),
        el("div", { style: s.note },
            "Percentage mode is capped at 30%. Fixed amount mode caps total stock exposure directly. Stop loss is measured from each position's average entry price; 0% disables it. Lowering the capital limit pauses new entries if current exposure is already above the limit; it does not force-liquidate healthy positions.",
        ),
    );
}

function field(label, control) {
    return el("label", { style: { display: "flex", flexDirection: "column", gap: "4px", minWidth: "170px" } }, el("span", { style: s.statLabel }, label), control);
}
function inputStyle() { return { background: "#071018", color: "#d7e2ea", border: "1px solid #263847", borderRadius: "4px", padding: "6px 8px", fontFamily: "monospace", minWidth: "150px" }; }
function parseCash(value) {
    const text = String(value ?? "").trim().toLowerCase().replace(/[$,_ ]/g, "");
    const match = text.match(/^([+-]?\d*\.?\d+)\s*([kmbt]?)$/);
    if (!match) return 0;
    const scale = { "": 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[match[2]] ?? 1;
    return Math.max(0, Number(match[1]) * scale);
}
function formatInputAmount(value) { return String(Math.max(0, Number(value) || 0)); }
function money(value) { const n = Number(value) || 0; if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}t`; if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}b`; if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}m`; if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(2)}k`; return `$${n.toFixed(2)}`; }
function stat(label, value) { return el("div", { style: s.stat }, el("div", { style: s.statLabel }, label), el("div", { style: s.statValue }, String(value))); }
function badge(text, tone) { return el("span", { style: { ...s.badge, ...(s[tone] ?? {}) } }, text); }
function el(type, props, ...children) { return React.createElement(type, props, ...children); }
function clamp(v, min, max) { return Math.min(max, Math.max(min, Number(v) || 0)); }
