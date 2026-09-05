import { styles } from "/ui/styles.js";

export function el(type, props, ...children) { return React.createElement(type, props, ...children); }

function CollapsibleCard({ title, content, wide = false }) {
    const [open, setOpen] = React.useState(true);
    return el("div", { style: { ...styles.card, ...(wide ? styles.wide : {}) } },
        el("button", { onClick: () => setOpen((value) => !value), style: styles.cardHeaderButton },
            el("span", { style: styles.cardTitle }, title),
            el("span", { style: styles.collapseGlyph }, open ? "−" : "+"),
        ),
        open ? content : null,
    );
}

function CollapsibleHero({ label, value, sub }) {
    const [open, setOpen] = React.useState(true);
    return el("div", { style: styles.heroCard },
        el("button", { onClick: () => setOpen((current) => !current), style: styles.heroHeaderButton },
            el("span", { style: styles.heroLabel }, label),
            el("span", { style: styles.collapseGlyph }, open ? "−" : "+"),
        ),
        el("div", { style: styles.heroValue }, value),
        open ? el("div", { style: styles.heroSub }, sub) : null,
    );
}

export function heroMetric(label, value, sub) { return el(CollapsibleHero, { label, value, sub }); }
export function card(title, content, wide = false) { return el(CollapsibleCard, { title, content, wide }); }
export function grid(...children) { return el("div", { style: styles.grid }, ...children); }
export function kv(k, v) { return el("div", { style: styles.kv }, el("span", { style: styles.key }, k), el("span", { style: styles.value }, String(v))); }
export function note(v) { return el("div", { style: styles.note }, String(v)); }
export function badge(label, tone) { return el("span", { style: { ...styles.badge, ...styles[`badge_${tone}`] } }, label); }
export function stat(label, value) { return el("div", { style: styles.stat }, el("div", { style: styles.statLabel }, label), el("div", { style: styles.statValue }, String(value))); }
export function details(title, content) { return el("details", { style: styles.details }, el("summary", { style: styles.summary }, title), content); }
export function healthRow(label, ok) { return el("div", { style: styles.kv }, el("span", { style: styles.key }, label), el("span", { style: ok ? styles.goodText : styles.warnText }, ok ? "ONLINE" : "WAITING")); }
export function progressBar(value) {
    const width = `${Math.max(0, Math.min(1, Number(value ?? 0))) * 100}%`;
    return el("div", { style: styles.progressTrack }, el("div", { style: { ...styles.progressFill, width } }));
}
export function command(label, value) { return el("div", { style: styles.command }, el("div", { style: styles.commandLabel }, label), el("div", { style: styles.code }, value)); }
export function button(label, onClick, disabled = false, tone = "primary") {
    return el("button", {
        disabled,
        onClick,
        style: { ...(tone === "clear" ? styles.clearButton : styles.primaryButton), ...(disabled ? styles.disabledButton : {}) },
    }, label);
}
export function labeledControl(label, control) {
    return el("label", { style: styles.controlField }, el("span", { style: styles.controlLabel }, label), control);
}
