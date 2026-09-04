import { isQuiet } from "/lib/output.js";

/**
 * Print the RAM cost of every managed JavaScript file in manifest.json.
 *
 * Usage:
 *   run diagnostics/mem-audit.js
 *   run diagnostics/mem-audit.js --path
 *   run diagnostics/mem-audit.js --quiet   // performs the scan without output
 *
 * Default order is highest RAM first; --path sorts by file path.
 *
 * @param {NS} ns
 */
export async function main(ns) {
    const quiet = isQuiet(ns);
    const sortByPath = ns.args.some((arg) => String(arg).toLowerCase() === "--path");
    const manifestPath = "manifest.json";

    if (!ns.fileExists(manifestPath, "home")) {
        if (!quiet) ns.tprint(`ERROR: ${manifestPath} is missing.`);
        return;
    }

    let manifest;
    try {
        manifest = JSON.parse(ns.read(manifestPath));
    } catch (error) {
        if (!quiet) ns.tprint(`ERROR: ${manifestPath} is invalid JSON: ${String(error)}`);
        return;
    }

    const files = Array.isArray(manifest?.files)
        ? manifest.files.map(String).filter((file) => file.endsWith(".js"))
        : [];

    const rows = files.map((file) => ({
        file,
        ram: Math.max(0, Number(ns.getScriptRam(file, "home")) || 0),
        kind: file.startsWith("lib/") ? "module" : "script",
    }));

    rows.sort(sortByPath
        ? (a, b) => a.file.localeCompare(b.file)
        : (a, b) => b.ram - a.ram || a.file.localeCompare(b.file));

    if (quiet) return;

    ns.tprint("=== MANAGED SCRIPT RAM AUDIT ===");
    ns.tprint(`Files: ${rows.length} | sort: ${sortByPath ? "path" : "RAM descending"}`);
    ns.tprint("");

    for (const row of rows) {
        ns.tprint(`${row.ram.toFixed(2).padStart(6)} GB | ${row.kind.padEnd(6)} | ${row.file}`);
    }

    const runnable = rows.filter((row) => row.kind === "script");
    const modules = rows.filter((row) => row.kind === "module");
    ns.tprint("");
    ns.tprint(`Runnable scripts: ${runnable.length} | library modules: ${modules.length}`);
    ns.tprint("Note: imported library RAM is already reflected in each runnable script's reported total.");
}
