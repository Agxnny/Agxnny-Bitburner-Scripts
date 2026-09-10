import {
  MESSAGE_SCHEMA_VERSION,
  STATE_SCHEMA_VERSION,
  TELEMETRY_SCHEMA_VERSION,
} from "/core/config.js";

export const HEALTH = Object.freeze({
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  IN_DEVELOPMENT: "IN_DEVELOPMENT",
  UNTESTED: "UNTESTED",
  PASS: "PASS",
  DEGRADED: "DEGRADED",
  FAIL: "FAIL",
  BLOCKED: "BLOCKED",
  DISABLED: "DISABLED",
});

export const FRESHNESS = Object.freeze({
  FRESH: "FRESH",
  STALE: "STALE",
  INVALID: "INVALID",
  UNAVAILABLE: "UNAVAILABLE",
});

export const SEVERITY = Object.freeze({
  DEBUG: "DEBUG",
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
});

export function createStateSnapshot({
  domain,
  data,
  generatedAt = Date.now(),
  freshness = FRESHNESS.FRESH,
  valid = true,
  source = "unknown",
  schemaVersion = STATE_SCHEMA_VERSION,
}) {
  if (!domain) throw new Error("State snapshot requires a domain");

  return {
    domain,
    schemaVersion,
    generatedAt,
    valid: Boolean(valid),
    freshness,
    source,
    data,
  };
}

export function createTelemetryEvent({
  type,
  source,
  payload = {},
  severity = SEVERITY.INFO,
  timestamp = Date.now(),
  correlationId = null,
  schemaVersion = TELEMETRY_SCHEMA_VERSION,
}) {
  if (!type) throw new Error("Telemetry event requires a type");
  if (!source) throw new Error("Telemetry event requires a source");

  return {
    schemaVersion,
    type,
    source,
    timestamp,
    severity,
    correlationId,
    payload,
  };
}

export function createControlMessage({
  type,
  source,
  target,
  payload = {},
  timestamp = Date.now(),
  requestId = null,
  correlationId = null,
  schemaVersion = MESSAGE_SCHEMA_VERSION,
}) {
  if (!type) throw new Error("Control message requires a type");
  if (!source) throw new Error("Control message requires a source");
  if (!target) throw new Error("Control message requires a target");

  return {
    schemaVersion,
    type,
    source,
    target,
    timestamp,
    requestId,
    correlationId,
    payload,
  };
}

export function isKnownHealth(value) {
  return Object.values(HEALTH).includes(value);
}

export function isKnownFreshness(value) {
  return Object.values(FRESHNESS).includes(value);
}
