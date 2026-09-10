import { FRESHNESS, createStateSnapshot } from "/core/contracts.js";

export function readJson(ns, path, fallback = null) {
  const raw = ns.read(path);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJson(ns, path, value) {
  const serialized = JSON.stringify(value, null, 2);
  return ns.write(path, serialized, "w");
}

export function publishState(ns, path, snapshot) {
  validateSnapshot(snapshot);
  return writeJson(ns, path, snapshot);
}

export function publishDomainState(ns, path, options) {
  const snapshot = createStateSnapshot(options);
  publishState(ns, path, snapshot);
  return snapshot;
}

export function getSnapshotAgeMs(snapshot, now = Date.now()) {
  if (!snapshot || !Number.isFinite(snapshot.generatedAt)) return Infinity;
  return Math.max(0, now - snapshot.generatedAt);
}

export function classifyFreshness(snapshot, maxAgeMs, now = Date.now()) {
  if (!snapshot) return FRESHNESS.UNAVAILABLE;
  if (snapshot.valid === false || snapshot.freshness === FRESHNESS.INVALID) {
    return FRESHNESS.INVALID;
  }

  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    throw new Error("maxAgeMs must be a non-negative finite number");
  }

  return getSnapshotAgeMs(snapshot, now) <= maxAgeMs
    ? FRESHNESS.FRESH
    : FRESHNESS.STALE;
}

export function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("State snapshot must be an object");
  }
  if (!snapshot.domain) throw new Error("State snapshot requires domain");
  if (!Number.isFinite(snapshot.schemaVersion)) {
    throw new Error("State snapshot requires numeric schemaVersion");
  }
  if (!Number.isFinite(snapshot.generatedAt)) {
    throw new Error("State snapshot requires numeric generatedAt");
  }
  if (typeof snapshot.valid !== "boolean") {
    throw new Error("State snapshot requires boolean valid");
  }

  return true;
}
