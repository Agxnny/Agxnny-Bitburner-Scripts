import { card, el, heroMetric, note } from "/ui/components/layout.js";
import { age, ramFmt } from "/ui/components/format.js";
import { styles } from "/ui/styles.js";

export function networkView(s) {
    const n = s.planner?.network ?? {};
    const root = s.root ?? {};
    const hosts = Array.isArray(s.planner?.executionHosts) ? s.planner.executionHosts.filter((h) => h.hostname !== "home") : [];
    return el("div", null,
        el("div", { style: styles.heroGrid },
            heroMetric("DISCOVERED", String(n.discovered ?? 0), "hosts"),
            heroMetric("ROOTED", String(n.rooted ?? 0), "access"),
            heroMetric("EXEC HOSTS", String(hosts.length), "remote pool"),
            heroMetric("PORT TOOLS", `${root.portToolCount ?? n.portToolCount ?? 0}/5`, age(root.updatedAt)),
        ),
        card("Execution hosts", hosts.length ? el("div", null, ...hosts.slice(0, 14).map(hostRow)) : note("No remote hosts."), true),
    );
}

function hostRow(h) {
    return el("div", { key: h.hostname, style: styles.hostRow },
        el("span", null, String(h.hostname)),
        el("span", { style: styles.right }, `${ramFmt(h.maxRam)} max`),
        el("span", { style: styles.right }, `${ramFmt(h.usedRam ?? 0)} used`),
    );
}
