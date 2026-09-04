import { isQuiet } from "/lib/output.js";

/**
 * Print the RAM cost of every JavaScript file currently installed on home.
 *
 * This intentionally scans the live filesystem instead of depending on
 * manifest.json, so it also works immediately after updater problems and can
 * reveal stale/unmanaged scripts that are still present.
 *
 * Usage:
 *   run diagnostics/mem-audit.js
 *   run diagnostics/mem-audit.js --path
 *   run diagnostics/mem-audit.js --managed
 *   run diagnostics/mem-audit.js --quiet
 *
 * Default order is highest RAM first; --path sorts by file path.
 * --managed limits the report to files listed in manifest.json when available.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const quiet = isQuiet(ns);
    const args = ns.args.map((arg) => String(arg).toLowerCase());
    const sortByPath = args.includes("--path");
    const managedOnly = args.includes("--managed");

    let files = ns.ls("home", ".js")
        .map(String)
        .filter((file) => file.endsWith(".js"));

    let managedSet = null;
    if (ns.fileExists("manifest.json", "home")) {
        try {
            const manifest = JSON.parse(ns.read("manifest.json"));
            if (Array.isArray(manifest?.files)) {
                managedSet = new Set(manifest.files.map(String));
            }
        } catch {
            // A broken manifest should never prevent a filesystem RAM audit.
        }
    }

    if (managedOnly && managedSet) {
        files = files.filter((file) => managedSet.has(file));
    }

    const rows = files.map((file) => ({
        file,
        ram: Math.max(0, Number(ns.getScriptRam(file, "home")) || 0),
        kind: file.startsWith("lib/") ? "module" : "script",
        managed: managedSet ? managedSet.has(file) : null,
    }));

    rows.sort(sortByPath
        ? (a, b) => a.file.localeCompare(b.file)
        : (a, b) => b.ram - a.ram || a.file.localeCompare(b.file));

    if (quiet) return;

    ns.tprint("=== INSTALLED SCRIPT RAM AUDIT ===");
    ns.tprint(`Files: ${rows.length} | sort: ${sortByPath ? "path" : "RAM descending"}`);
    if (managedOnly && !managedSet) {
        ns.tprint("WARNING: --managed requested but manifest.json is unavailable; showing all installed .js files.");
    }
    ns.tprint("");

    for (const row of rows) {
        const managed = row.managed === null ? "?" : row.managed ? "M" : "U";
        ns.tprint(`${row.ram.toFixed(2).padStart(6)} GB | ${row.kind.padEnd(6)} | ${managed} | ${row.file}`);
    }

    const runnable = rows.filter((row) => row.kind === "script");
    const modules = rows.filter((row) => row.kind === "module");
    const unmanaged = rows.filter((row) => row.managed === false);
    ns.tprint("");
    ns.tprint(`Runnable scripts: ${runnable.length} | library modules: ${modules.length}`);
    if (managedSet) ns.tprint(`Unmanaged installed .js files: ${unmanaged.length}`);
    ns.tprint("Legend: M = listed in manifest, U = installed but unmanaged, ? = manifest unavailable.");
    ns.tprint("Note: imported library RAM is already reflected in each runnable script's reported total.");
}
