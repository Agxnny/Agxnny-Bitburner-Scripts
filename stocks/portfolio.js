import { stockStyles as s } from "/stocks/styles.js";

export function TraderPortfolio({ market, traderState, onClose }) {
    const rows = Array.isArray(market?.positions) ? market.positions : [];
    const pnl = portfolioPnl(rows);
    const action = traderState?.manualAction ?? null;
    return el("div", { style: s.card },
        el("div", { style: s.titleRow },
            el("span", { style: s.cardTitle }, "Portfolio"),
            badge(rows.length ? `${rows.length} OPEN` : "FLAT", rows.length ? "accent" : "good"),
        ),
        rows.length ? el("div", { style: s.table },
            el("div", { style: rowStyle(true) },
                el("span", null, "Symbol"), el("span", { style: s.right }, "Side"),
                el("span", { style: s.right }, "Shares"), el("span", { style: s.right }, "Value"),
                el("span", { style: s.right }, "P&L"), el("span", { style: s.right }, "Action")),
            ...rows.map((row) => positionRow(row, onClose, action)),
        ) : el("div", { style: s.note }, "No stock positions are open."),
        actionNote(action),
        el("div", { style: s.stats },
            stat("Long P&L", signedMoney(pnl.long)), stat("Short P&L", signedMoney(pnl.short)),
            stat("Gross exposure", money(market?.portfolio?.grossExposure)), stat("Open positions", rows.length)),
    );
}

export function portfolioPnl(rows) {
    let long = 0, short = 0;
    for (const row of rows ?? []) {
        long += (Number(row.price ?? 0) - Number(row.longAverage ?? 0)) * Number(row.longShares ?? 0);
        short += (Number(row.shortAverage ?? 0) - Number(row.price ?? 0)) * Number(row.shortShares ?? 0);
    }
    return { long, short, total: long + short };
}

function positionRow(row, onClose, action) {
    const long = Number(row.longShares ?? 0) > 0;
    const side = long ? "LONG" : "SHORT";
    const shares = long ? Number(row.longShares) : Number(row.shortShares ?? 0);
    const average = long ? Number(row.longAverage ?? 0) : Number(row.shortAverage ?? 0);
    const price = Number(row.price ?? 0), value = shares * price;
    const pnl = long ? (price - average) * shares : (average - price) * shares;
    const pending = action?.status === "PENDING" && action?.symbol === row.symbol && action?.side === side;
    return el("div", { key: `${row.symbol}-${side}`, style: rowStyle(false) },
        el("span", { style: s.symbol }, row.symbol), el("span", { style: s.right }, side),
        el("span", { style: s.right }, integer(shares)), el("span", { style: s.right }, money(value)),
        el("span", { style: pnl >= 0 ? s.goodText : s.badText }, signedMoney(pnl)),
        el("button", {
            disabled: pending,
            onClick: () => onClose(row.symbol, side),
            style: { ...s.badge, borderColor: "#6f3131", background: "#291515", color: "#ffaaaa", cursor: pending ? "default" : "pointer", fontFamily: "monospace", opacity: pending ? .55 : 1 },
        }, pending ? "CLOSING" : "CLOSE"),
    );
}

function actionNote(action) {
    if (!action?.status || action.status === "PENDING") return null;
    const tone = action.status === "COMPLETE" ? s.goodText : action.status === "FAILED" ? s.badText : s.dim;
    const pnl = Number(action?.result?.pnl);
    return el("div", { style: s.note }, el("span", { style: tone },
        `${action.status} · ${action.reason || "manual close"}${Number.isFinite(pnl) ? ` · ${signedMoney(pnl)}` : ""}`));
}

function rowStyle(head) {
    return { ...s.row, ...(head ? s.rowHead : {}), gridTemplateColumns: "58px .7fr 1fr 1fr 1fr 70px" };
}
function stat(label, value) { return el("div", { style: s.stat }, el("div", { style: s.statLabel }, label), el("div", { style: s.statValue }, String(value))); }
function badge(text, tone) { return el("span", { style: { ...s.badge, ...(s[tone] ?? {}) } }, text); }
function el(type, props, ...children) { return React.createElement(type, props, ...children); }
function money(value) { const n=Number(value)||0; if(Math.abs(n)>=1e12)return`$${(n/1e12).toFixed(2)}t`; if(Math.abs(n)>=1e9)return`$${(n/1e9).toFixed(2)}b`; if(Math.abs(n)>=1e6)return`$${(n/1e6).toFixed(2)}m`; if(Math.abs(n)>=1e3)return`$${(n/1e3).toFixed(2)}k`; return`$${n.toFixed(2)}`; }
function signedMoney(value) { const n=Number(value)||0; return `${n>=0?"+":"-"}${money(Math.abs(n))}`; }
function integer(value) { return Math.floor(Number(value)||0).toLocaleString(); }
