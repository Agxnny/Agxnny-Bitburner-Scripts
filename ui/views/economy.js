import { field, queueGoal, setField, status } from "/ui/actions.js";
import { button, card, el, grid, kv, note } from "/ui/components/layout.js";
import { moneyFmt } from "/ui/components/format.js";
import { styles } from "/ui/styles.js";

export function economyView(s) {
    const e = s.economy ?? {};
    const manual = s.manualGoal ?? {};
    const purchase = s.purchase ?? {};
    return el("div", null,
        card("Money goal", el("div", null,
            el("div", { style: styles.goalForm },
                el("input", { value: field("goal"), placeholder: "50m / 1.5b", onChange: (event) => setField("goal", event.target.value), style: styles.input }),
                el("input", { value: field("goalLabel"), placeholder: "optional label", onChange: (event) => setField("goalLabel", event.target.value), style: styles.input }),
                button("Set", () => queueGoal({ type: "set", value: field("goal"), label: field("goalLabel") }), false, "primary"),
                button("Clear", () => queueGoal({ type: "clear" }), false, "clear"),
            ),
            el("div", { style: styles.goalStatus }, status("goalStatus")),
        ), true),
        grid(
            card("Savings", el("div", null,
                kv("Cash", moneyFmt(e.cash)),
                kv("Goal", e.goal?.title ?? "No goal"),
                kv("Remaining", moneyFmt(e.goal?.remaining)),
                kv("Lock", manual.active ? `ACTIVE · ${moneyFmt(manual.targetCash)}` : "off"),
            )),
            card("Cloud + progression", el("div", null,
                kv("Cloud", purchase.status ?? "idle"),
                kv("Action", purchase.action ?? "NONE"),
                kv("Server", purchase.hostname || "—"),
                kv("Next goal", e.automaticGoal?.title ?? "—"),
                note(purchase.reason ?? "Automatic cloud actions respect the savings lock."),
            )),
        ),
    );
}
