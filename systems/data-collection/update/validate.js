import {
  classifyInstallAttempt,
  compareRevisions,
  validateManifest,
} from "/systems/data-collection/update/manifest.js";

export async function main(ns) {
  const tests = [
    test("valid manifest accepted", () => validateManifest(validManifest()).valid === true),
    test("duplicate path rejected", () => {
      const manifest = validManifest();
      manifest.files.push({ ...manifest.files[0] });
      return validateManifest(manifest).valid === false;
    }),
    test("newer revision detected", () => compareRevisions(installed(2, "r2"), target(3, "r3")) === "UPDATE_AVAILABLE"),
    test("current revision detected", () => compareRevisions(installed(3, "r3"), target(3, "r3")) === "CURRENT"),
    test("older revision detected", () => compareRevisions(installed(3, "r3"), target(2, "r2")) === "REMOTE_OLDER"),
    test("same sequence mismatch detected", () => compareRevisions(installed(3, "r3"), target(3, "other")) === "REVISION_MISMATCH"),
    test("missing installed record detected", () => compareRevisions(null, target(3, "r3")) === "LOCAL_REVISION_UNKNOWN"),
    test("repull attempt alarm classified", () => classifyInstallAttempt(installed(3, "r3"), target(3, "r3")) === "SAME_REVISION_REPULL"),
    test("older install attempt alarm classified", () => classifyInstallAttempt(installed(3, "r3"), target(2, "r2")) === "OLDER_REVISION_DETECTED"),
  ];

  const failed = tests.filter((result) => !result.pass);
  for (const result of tests) {
    ns.tprint(`${result.pass ? "PASS" : "FAIL"} - ${result.name}${result.error ? `: ${result.error}` : ""}`);
  }

  ns.tprint(`Update manifest validation: ${tests.length - failed.length}/${tests.length} passed.`);
  if (failed.length > 0) throw new Error(`${failed.length} update validation test(s) failed`);
}

function test(name, fn) {
  try {
    return { name, pass: Boolean(fn()), error: null };
  } catch (error) {
    return { name, pass: false, error: String(error) };
  }
}

function validManifest() {
  return {
    schemaVersion: 2,
    releaseVersion: "v0.1.0",
    revisionSequence: 3,
    revisionId: "r3",
    previousRevisionId: "r2",
    versionFile: "/VERSION.txt",
    files: [
      { path: "/VERSION.txt", required: true, fileVersion: 1, change: "unchanged" },
    ],
    removedFiles: [],
    runtimeEntries: [],
    persistent: [],
  };
}

function installed(revisionSequence, revisionId) {
  return { revisionSequence, revisionId };
}

function target(revisionSequence, revisionId) {
  return { revisionSequence, revisionId };
}
