const VALID_PROFILES = new Set(["money", "balanced", "xp"]);

/**
 * Shared candidate-source selection for the real MULTI executor and AUTOMULTI.
 * XP intentionally uses baseline planner rankings. MONEY/BALANCED prefer the
 * economic ranking when it has enough rows to sustain multi-target admission.
 */
export function multiTargetRankings(planner, economic, profile, minimumEconomicRows = 2) {
    const normalized = normalizeProfile(profile);
    const baseline = Array.isArray(planner?.rankings) ? planner.rankings : [];
    if (normalized === "xp") return baseline;

    const economicRows = Array.isArray(economic?.rankings) ? economic.rankings : [];
    return economicRows.length >= Math.max(2, Number(minimumEconomicRows) || 2)
        ? economicRows
        : baseline;
}

export function multiTargetRankingSource(planner, economic, profile, minimumEconomicRows = 2) {
    const normalized = normalizeProfile(profile);
    if (normalized === "xp") return "PLANNER_BASELINE";
    const economicRows = Array.isArray(economic?.rankings) ? economic.rankings : [];
    return economicRows.length >= Math.max(2, Number(minimumEconomicRows) || 2)
        ? "ECONOMIC"
        : "PLANNER_FALLBACK";
}

export function normalizeMultiProfile(value) { return normalizeProfile(value); }

function normalizeProfile(value) {
    const profile = String(value ?? "money").trim().toLowerCase();
    return VALID_PROFILES.has(profile) ? profile : "money";
}
