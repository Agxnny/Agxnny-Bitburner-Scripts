const DEFAULT_PULL_PATH = "/pull.js";
const DEFAULT_STAGED_PULL = "/data/state/pull.next.js";
const DEFAULT_INSTALLED_STATE = "/data/state/installed-revision.json";

export async function main(ns) {
  const flags = ns.flags([
    ["old-pid", 0], ["staged", DEFAULT_STAGED_PULL], ["target", DEFAULT_PULL_PATH],
    ["installed-state", DEFAULT_INSTALLED_STATE], ["record", ""], ["runtime", "[]"],
  ]);

  const oldPid = Number(flags["old-pid"] || 0);
  const stagedPath = String(flags.staged || DEFAULT_STAGED_PULL);
  const targetPath = String(flags.target || DEFAULT_PULL_PATH);
  const installedStatePath = String(flags["installed-state"] || DEFAULT_INSTALLED_STATE);

  let record, runtime;
  try {
    record = JSON.parse(String(flags.record || ""));
    runtime = JSON.parse(String(flags.runtime || "[]"));
  } catch {
    return alarm(ns, "HANDOFF_INVALID_RECORD", "Could not parse pending update state.");
  }

  if (!record?.manifest?.revisionId || !Number.isInteger(record?.manifest?.revisionSequence)) {
    return alarm(ns, "HANDOFF_INVALID_RECORD", "Pending installed-revision record is incomplete.");
  }
  if (!Array.isArray(runtime)) runtime = [];
  if (!ns.fileExists(stagedPath, "home")) return alarm(ns, "HANDOFF_STAGE_MISSING", `Staged puller missing: ${stagedPath}`);

  for (let i = 0; i < 100 && oldPid > 0 && ns.isRunning(oldPid, "home"); i += 1) await ns.sleep(50);
  if (oldPid > 0 && ns.isRunning(oldPid, "home")) return alarm(ns, "HANDOFF_OLD_PULLER_STILL_RUNNING", `PID ${oldPid} did not exit in time.`);

  const stagedContent = ns.read(stagedPath);
  if (!stagedContent) return alarm(ns, "HANDOFF_STAGE_EMPTY", `Staged puller is empty or unreadable: ${stagedPath}`);

  ns.write(targetPath, stagedContent, "w");
  if (!ns.fileExists(targetPath, "home")) return alarm(ns, "HANDOFF_VERIFY_FAILED", `Replacement ${targetPath} is missing after write.`);
  if (ns.read(targetPath) !== stagedContent) return alarm(ns, "HANDOFF_VERIFY_MISMATCH", `Replacement ${targetPath} does not match staged puller contents.`);

  if (ns.fileExists(stagedPath, "home") && !ns.rm(stagedPath, "home")) {
    ns.tprint(`WARNING HANDOFF_STAGE_CLEANUP_FAILED: ${stagedPath}`);
  }

  ns.write(installedStatePath, JSON.stringify(record, null, 2), "w");
  restoreRuntime(ns, runtime);

  ns.tprint(`UPDATE_COMPLETE: ${record.releaseVersion} / ${record.revisionId}`);
  ns.tprint("Self-update handoff complete; managed runtime and remembered tail layout restored.");
}

function restoreRuntime(ns, runtime) {
  for (const p of runtime) {
    let pid = Number(p.pid || 0);
    if (!pid || !ns.isRunning(pid, "home")) {
      pid = ns.exec(p.filename, "home", { threads: Number(p.threads) || 1 }, ...(p.args ?? []));
      if (pid === 0) {
        ns.tprint(`WARNING RESTART_FAILED: ${p.filename}`);
        continue;
      }
    }
    if (p.tail) restoreTail(ns, pid, p.tail);
  }
}

function restoreTail(ns, pid, tail) {
  try {
    ns.ui.openTail(pid);
    ns.ui.moveTail(Number(tail.x) || 0, Number(tail.y) || 0, pid);
    ns.ui.resizeTail(Number(tail.width) || 600, Number(tail.height) || 400, pid);
  } catch (error) {
    ns.tprint(`WARNING TAIL_RESTORE_FAILED pid=${pid}: ${String(error)}`);
  }
}

function alarm(ns, code, message) {
  ns.tprint(`ALARM ${code}: ${message}`);
  ns.tprint("Installed revision metadata was NOT advanced.");
}
