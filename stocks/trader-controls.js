import { stockStyles as s } from "/stocks/styles.js";

export function TraderControls({ config, traderState, traderRunning, onSave }) {
    const source = config ?? { mode: "PERCENT", percent: 15, amount: 1e9, stopLossPercent: 5, allowShort: true, shortCapitalPercent: 5, cashFloor: 100e6, updatedAt: 0 };
    const [mode, setMode] = React.useState(source.mode), [percent, setPercent] = React.useState(String(source.percent));
    const [amount, setAmount] = React.useState(formatInputAmount(source.amount)), [stopLoss, setStopLoss] = React.useState(String(source.stopLossPercent ?? 5));
    const [allowShort, setAllowShort] = React.useState(source.allowShort !== false), [shortPct, setShortPct] = React.useState(String(source.shortCapitalPercent ?? 5));
    const [seenAt, setSeenAt] = React.useState(Number(source.updatedAt ?? 0));

    React.useEffect(() => {
        const updatedAt = Number(source.updatedAt ?? 0); if (updatedAt === seenAt) return;
        setMode(source.mode); setPercent(String(source.percent)); setAmount(formatInputAmount(source.amount)); setStopLoss(String(source.stopLossPercent ?? 5));
        setAllowShort(source.allowShort !== false); setShortPct(String(source.shortCapitalPercent ?? 5)); setSeenAt(updatedAt);
    }, [source.updatedAt]);

    const save = () => onSave({ ...source, mode, percent: clamp(Number(percent)||0,0,30), amount: Math.max(0,parseCash(amount)), stopLossPercent: clamp(Number(stopLoss)||0,0,50), allowShort, shortCapitalPercent: clamp(Number(shortPct)||0,0,10) });
    const state = traderState ?? {}, perf = state.performance ?? {};
    const configured = mode === "PERCENT" ? `${clamp(Number(percent)||0,0,30).toFixed(1)}% of player cash` : money(parseCash(amount));

    return el("div", { style: { ...s.card, marginBottom: "7px" } },
        el("div", { style: s.titleRow }, el("span", { style: s.cardTitle }, "Pre-4S trader controls"), badge(traderRunning ? "LIVE" : "STOPPED", traderRunning ? "good" : "warn")),
        el("div", { style: { display:"flex", gap:"8px", alignItems:"end", flexWrap:"wrap" } },
            field("Capital mode", el("select", { value:mode, onChange:e=>setMode(e.target.value), style:s.select }, el("option",{value:"PERCENT"},"% OF PLAYER CASH"), el("option",{value:"AMOUNT"},"FIXED AMOUNT"))),
            mode === "PERCENT" ? field("Available to trade (%)", input("number",percent,setPercent,{min:0,max:30,step:1})) : field("Available to trade ($)", input("text",amount,setAmount,{placeholder:"1b"})),
            field("Stop loss (%)", input("number",stopLoss,setStopLoss,{min:0,max:50,step:.5})),
            field("Short budget (%)", input("number",shortPct,setShortPct,{min:0,max:10,step:.5})),
            field("Conservative shorts", el("button", { onClick:()=>setAllowShort(!allowShort), style:{...s.badge,...(allowShort?s.good:s.warn),cursor:"pointer",fontFamily:"monospace",padding:"7px 12px"} }, allowShort ? "ENABLED" : "DISABLED")),
            el("button", { onClick:save, style:{...s.badge,...s.accent,cursor:"pointer",fontFamily:"monospace",padding:"7px 12px"} }, "SAVE"),
        ),
        el("div", { style:s.stats },
            stat("Configured",configured), stat("Live limit",money(state.capitalLimit??0)), stat("Exposure",money(state.exposure??0)),
            stat("Short exposure",money(state.shortExposure??0)), stat("Short limit",money(state.shortCapitalLimit??0)), stat("Stop loss",`${Number(source.stopLossPercent??0).toFixed(1)}%`),
        ),
        performancePanel(perf),
        el("div", { style:s.note }, "Pre-4S shorts are intentionally stricter: score <= -0.72, confidence >= 72%, max 1.5% equity per short, and a separate short budget capped at 10% of equity. The configured stop loss protects both sides. Set Short budget to 0% or disable shorts to prevent new short entries."),
    );
}

function performancePanel(perf) {
    const closed = Number(perf.closedTrades ?? 0), recent = Array.isArray(perf.recentTrades) ? perf.recentTrades : [];
    return el("div", { style:{marginTop:"8px",paddingTop:"8px",borderTop:"1px solid #1b2b37"} },
        el("div", { style:s.titleRow }, el("span", { style:s.cardTitle }, "Historical trader P&L"), badge(`${closed} CLOSED`, closed ? "accent" : "good")),
        el("div", { style:s.stats },
            stat("Realized",signedMoney(perf.realizedPnl??0)), stat("Long realized",signedMoney(perf.longRealizedPnl??0)), stat("Short realized",signedMoney(perf.shortRealizedPnl??0)),
            stat("Win rate",pct(perf.winRate??0)), stat("Profit factor",profitFactor(perf.profitFactor)), stat("Max drawdown",money(perf.maxDrawdown??0)),
        ),
        recent.length ? el("div", { style:{display:"grid",gap:"3px",marginTop:"6px"} },
            ...recent.slice(0,6).map((trade,index)=>el("div", { key:`${trade.at}-${trade.symbol}-${index}`, style:{display:"grid",gridTemplateColumns:"54px 46px 1fr 80px",gap:"8px",fontFamily:"monospace",fontSize:"10px",color:"#9fb0bd"} },
                el("span", {style:s.symbol}, trade.symbol||"—"), el("span", null, trade.side||"—"), el("span", null, trade.reason||"—"), el("span", {style:Number(trade.pnl??0)>=0?s.goodText:s.badText}, signedMoney(trade.pnl??0)),
            )),
        ) : el("div", { style:s.note }, "No closed trades recorded yet. Historical realized P&L begins with exits made by the current ledger-enabled trader."),
    );
}

function field(label,control){return el("label",{style:{display:"flex",flexDirection:"column",gap:"4px",minWidth:"150px"}},el("span",{style:s.statLabel},label),control);}
function input(type,value,setter,extra={}){return el("input",{type,value,onChange:e=>setter(e.target.value),style:inputStyle(),...extra});}
function inputStyle(){return{background:"#071018",color:"#d7e2ea",border:"1px solid #263847",borderRadius:"4px",padding:"6px 8px",fontFamily:"monospace",minWidth:"130px"};}
function parseCash(value){const text=String(value??"").trim().toLowerCase().replace(/[$,_ ]/g,"");const match=text.match(/^([+-]?\d*\.?\d+)\s*([kmbt]?)$/);if(!match)return 0;return Math.max(0,Number(match[1])*({"":1,k:1e3,m:1e6,b:1e9,t:1e12}[match[2]]??1));}
function formatInputAmount(value){return String(Math.max(0,Number(value)||0));}
function money(value){const n=Number(value)||0;if(Math.abs(n)>=1e12)return`$${(n/1e12).toFixed(2)}t`;if(Math.abs(n)>=1e9)return`$${(n/1e9).toFixed(2)}b`;if(Math.abs(n)>=1e6)return`$${(n/1e6).toFixed(2)}m`;if(Math.abs(n)>=1e3)return`$${(n/1e3).toFixed(2)}k`;return`$${n.toFixed(2)}`;}
function signedMoney(value){const n=Number(value)||0;return`${n>=0?"+":"-"}${money(Math.abs(n))}`;}
function pct(value){return`${((Number(value)||0)*100).toFixed(1)}%`;}
function profitFactor(value){const n=Number(value);return Number.isFinite(n)?n.toFixed(2):n===Infinity?"∞":"0.00";}
function stat(label,value){return el("div",{style:s.stat},el("div",{style:s.statLabel},label),el("div",{style:s.statValue},String(value)));}
function badge(text,tone){return el("span",{style:{...s.badge,...(s[tone]??{})}},text);}
function el(type,props,...children){return React.createElement(type,props,...children);}
function clamp(v,min,max){return Math.min(max,Math.max(min,Number(v)||0));}
