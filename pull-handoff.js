const DEFAULT_PULL_PATH = "/pull.js";
const DEFAULT_STAGED_PULL = "/data/state/pull.next.js";
const DEFAULT_INSTALLED_STATE = "/data/state/installed-revision.json";

export async function main(ns) {
  const flags = ns.flags([
    ["old-pid", 0],
    ["staged", DEFAULT_STAGED_PULL],
    ["target", DEFAULT_PULL_PATH],
    ["installed-state", DEFAULT_INSTALLED_STATE],
    ["record", ""],
  ]);

  const oldPid = Number(flags["old-pid"] || 0);
  const stagedPath = String(flags.staged || DEFAULT_STAGED_PULL);
  const targetPath = String(flags.target || DEFAULT_PULL_PATH);
  const installedStatePath = String(flags["installed-state"] || DEFAULT_INSTALLED_STATE);

  let record;
  try {
    record = JSON.parse(String(flags.record || ""));
  } catch {
    return alarm(ns, "HANDOFF_INVALID_RECORD", "Could not parse pending installed-revision record.");
  }

  if (!record?.manifest?.revisionId || !Number.isInteger(record?.manifest?.revisionSequence)) {
    return alarm(ns, "HANDOFF_INVALID_RECORD", "Pending installed-revision record is incomplete.");
  }

  if (!ns.fileExists(stagedPath, "home")) {
    return alarm(ns, "HANDOFF_STAGE_MISSING", `Staged puller missing: ${stagedPath}`);
  }

  for (let i = 0; i < 100 && oldPid > 0 && ns.isRunning(oldPid, "home"); i += 1) {
    await ns.sleep(50);
  }

  if (oldPid > 0 && ns.isRunning(oldPid, "home")) {
    return alarm(ns, "HANDOFF_OLD_PULLER_STILL_RUNNING", `PID ${oldPid} did not exit in time.`);
  }

  // Bitburner's mv API is not a reliable replacement primitive for this
  // self-update path. Copy the staged text into the canonical file instead,
  // verify the exact contents, then remove the staging file.
  const stagedContent = ns.read(stagedPath);
  if (!stagedContent) {
    return alarm(ns, "HANDOFF_STAGE_EMPTY", `Staged puller is empty or unreadable: ${stagedPath}`);
  }

  ns.write(targetPath, stagedContent, "w");

  if (!ns.fileExists(targetPath, "home")) {
    return alarm(ns, "HANDOFF_VERIFY_FAILED", `Replacement ${targetPath} is missing after write.`);
  }

  const installedContent = ns.read(targetPath);
  if (installedContent !== stagedContent) {
    return alarm(ns, "HANDOFF_VERIFY_MISMATCH", `Replacement ${targetPath} does not match staged puller contents.`);
  }

  if (ns.fileExists(stagedPath, "home") && !ns.rm(stagedPath, "home")) {
    ns.tprint(`WARNING HANDOFF_STAGE_CLEANUP_FAILED: ${stagedPath} could not be removed; installed puller was verified successfully.`);
  }

  ns.write(installedStatePath, JSON.stringify(record, null, 2), "w");

  ns.tprint(`UPDATE_COMPLETE: ${record.releaseVersion} / ${record.revisionId}`);
  ns.tprint("Self-update handoff complete; /pull.js was replaced, content-verified, and installed revision metadata finalized.");
}

function alarm(ns, code, message) {
  ns.tprint(`ALARM ${code}: ${message}`);
  ns.tprint("Installed revision metadata was NOT advanced.");
}
