import { readJson, writeJson } from "/core/state.js";

export function readInstalledRevision(ns, path) {
  const record = readJson(ns, path, null);
  if (!record || typeof record !== "object") return null;
  if (!Number.isInteger(record.revisionSequence)) return null;
  if (typeof record.revisionId !== "string" || record.revisionId.length === 0) return null;
  if (!record.manifest || typeof record.manifest !== "object") return null;
  return record;
}

export function writeInstalledRevision(ns, path, manifest, installedAt = Date.now()) {
  const record = {
    schemaVersion: 1,
    installedAt,
    releaseVersion: manifest.releaseVersion,
    revisionSequence: manifest.revisionSequence,
    revisionId: manifest.revisionId,
    manifest,
  };
  writeJson(ns, path, record);
  return record;
}

export function summarizeInstalledRecord(record) {
  if (!record) return null;
  return {
    releaseVersion: record.releaseVersion,
    revisionSequence: record.revisionSequence,
    revisionId: record.revisionId,
    installedAt: record.installedAt ?? null,
  };
}
