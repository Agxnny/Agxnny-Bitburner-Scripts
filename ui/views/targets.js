import { field, queueController, setField, status } from "/ui/actions.js";
import { button, card, el, kv, note, stat } from "/ui/components/layout.js";
import { compactMs, duration, moneyFmt, pct, pctFine, ramFmt, signedNum } from "/ui/components/format.js";
import { styles } from "/ui/styles.js";

export function targetsView(s) {
    const selected = s.economic?.selectedTarget;
    const rankings = Array.isArray(s.economic?.rankings) ? s.economic.rankings : [];
    return el("div", null,
        card("Target override", targetOverride(s), true),
        selected ? card("Selected strategy", selectedStrategy(selected), true) : null,
        card("Servers below max money", prepProgress(s.prepper), true),
        card("Top targets", rankings.length ? el("div", null, ...rankings.slice(0, 7).map(targetRow)) : note("No ranking available."), true),
    );
}

function targetOverride(s) {
    const manual = field("manualTarget");
    const submit = () => { if (field("manualTarget").trim()) queueController({ action: "SET_MANUAL_TARGET", target: field("manualTarget").trim() }); };
    return el("div", null,
        el("div", { style: styles.targetForm },
            el("input", {
                value: manual,
                placeholder: "hostname",
                onChange: (event) => setField("manualTarget", event.target.value),
                onKeyDown: (event) => { if (event.key === "Enter") submit(); },
                style: styles.input,
            }),
            button("Set manual", submit, !manual.trim(), "primary"),
            button("Use auto", () => queueController({ action: "CLEAR_MANUAL_TARGET" }), false, "clear"),
        ),
        el("div", { style: styles.goalStatus }, s.controller?.targetControl?.lastMessage || status("controllerStatus")),
    );
}

function selectedStrategy(selected) {
    return el("div", null,
        el("div", { style: styles.strategyTitle }, `${selected.hostname} · ${pct(selected.moneyTargetPercent)} money`),
        el("div", { style: styles.statGrid },
            stat("Prep", duration(selected.prepSeconds)),
            stat("Income", `${moneyFmt(selected.steadyIncomePerSecond)}/s`),
            stat("ETA", duration(selected.economicEtaSeconds)),
        ),
        note(selected.reason ?? ""),
    );
}

function prepProgress(prepper) {
    if (!prepper || Date.now() - Number(prepper.updatedAt ?? 0) > 5000) return note("Waiting for fresh distributed prepper state.");
    const all = Array.isArray(prepper.prepTargets) ? prepper.prepTargets : [];
    const belowMax = all.filter((target) => Number(target.moneyRatio ?? 1) < 0.999999);
    return el("div", null,
        el("div", { style: styles.compactGrid },
            kv("Prepared", `${Number(prepper.preparedCount ?? 0)} / ${Number(prepper.targetCount ?? 0)}`),
            kv("Below max", belowMax.length),
            kv("Active prep", Number(prepper.activeCount ?? 0)),
            kv("Prep reserve", `${ramFmt(prepper.reservedRamGb)} · ${(prepper.reservedHosts ?? []).length} hosts`),
        ),
        belowMax.length ? el("div", { style: styles.pipelineRows },
            el("div", { style: styles.prepRow },
                el("span", { style: styles.dimText }, "SERVER"),
                el("span", { style: styles.right }, "MONEY"),
                el("span", { style: styles.dimText }, "STATE"),
                el("span", { style: styles.right }, "ETA 100%"),
                el("span", { style: styles.dimText }, "HOST / SEC"),
            ),
            ...belowMax.map(prepRow),
        ) : note("All currently tracked prep targets are at max money."),
        note("ETA 100% is an estimate from current grow/weaken timings, queue position, and reserved prep-host capacity."),
    );
}

function prepRow(target) {
    const active = Boolean(target.active);
    const eta = Number(target.etaMs);
    return el("div", { key: target.hostname, style: styles.prepRow },
        el("span", { style: styles.multiTargetName }, String(target.hostname ?? "?")),
        el("span", { style: styles.right }, pctFine(target.moneyRatio)),
        el("span", { style: active ? styles.goodText : styles.dimText }, active ? target.action ?? "PREP" : `QUEUED ${target.action ?? ""}`.trim()),
        el("span", { style: styles.right }, Number.isFinite(eta) ? compactMs(eta) : "—"),
        el("span", { style: styles.dimText }, active ? target.host || "reserved" : `sec ${signedNum(target.securityDelta, 2)}`),
    );
}

function targetRow(r, i) {
    return el("div", { key: `${r.hostname}-${i}`, style: styles.targetRow },
        el("span", { style: styles.rank }, `#${r.economicRank ?? i + 1}`),
        el("span", null, String(r.hostname)),
        el("span", { style: styles.right }, pct(r.moneyTargetPercent)),
        el("span", { style: styles.right }, `${moneyFmt(r.steadyIncomePerSecond)}/s`),
        el("span", { style: styles.right }, duration(r.economicEtaSeconds)),
    );
}
