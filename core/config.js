// Central configuration for cross-cutting stack behavior.
// Domain-specific tuning belongs with the owning subsystem unless multiple systems need it.

export const PATHS = Object.freeze({
  version: "/VERSION.txt",
  manifest: "/stack-manifest.json",
  installedRevision: "/data/state/installed-revision.json",
  remoteManifestTemp: "/data/state/remote-stack-manifest.json",
  stateRoot: "/data/state",
  telemetryRoot: "/data/telemetry",
  ramAudit: "/data/state/ram-audit.json",
  resourceState: "/data/state/resources.json",
  serverState: "/data/state/servers.json",
  playerState: "/data/state/player.json",
  updateState: "/data/state/update.json",
  updateValidationState: "/data/state/update-validation.json",
});

export const REPOSITORY = Object.freeze({
  owner: "Agxnny",
  name: "Agxnny-Bitburner-Scripts",
  branch: "main",
  rawBaseUrl: "https://raw.githubusercontent.com/Agxnny/Agxnny-Bitburner-Scripts/main",
  manifestUrl: "https://raw.githubusercontent.com/Agxnny/Agxnny-Bitburner-Scripts/main/stack-manifest.json",
});

export const STATE_SCHEMA_VERSION = 1;
export const TELEMETRY_SCHEMA_VERSION = 1;
export const MESSAGE_SCHEMA_VERSION = 1;

export const FRESHNESS_MS = Object.freeze({
  fast: 5_000,
  medium: 30_000,
  slow: 300_000,
});

export const TELEMETRY = Object.freeze({
  maxEventsPerStream: 250,
});
