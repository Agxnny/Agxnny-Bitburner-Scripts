const VALID_CHANGES = new Set(["added", "modified", "unchanged"]);

export function validateManifest(manifest) {
  const errors = [];

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { valid: false, errors: ["Manifest must be an object"] };
  }

  requireInteger(manifest, "schemaVersion", errors, 1);
  requireString(manifest, "releaseVersion", errors);
  requireInteger(manifest, "revisionSequence", errors, 0);
  requireString(manifest, "revisionId", errors);
  requireString(manifest, "versionFile", errors);

  if (manifest.previousRevisionId !== null && manifest.previousRevisionId !== undefined) {
    requireString(manifest, "previousRevisionId", errors);
  }

  if (!Array.isArray(manifest.files)) {
    errors.push("files must be an array");
  } else {
    const seen = new Set();
    for (let i = 0; i < manifest.files.length; i += 1) {
      const file = manifest.files[i];
      const prefix = `files[${i}]`;
      if (!file || typeof file !== "object" || Array.isArray(file)) {
        errors.push(`${prefix} must be an object`);
        continue;
      }

      if (typeof file.path !== "string" || !file.path.startsWith("/")) {
        errors.push(`${prefix}.path must be an absolute repository path`);
      } else if (seen.has(file.path)) {
        errors.push(`Duplicate managed path: ${file.path}`);
      } else {
        seen.add(file.path);
      }

      if (typeof file.required !== "boolean") {
        errors.push(`${prefix}.required must be boolean`);
      }
      if (!Number.isInteger(file.fileVersion) || file.fileVersion < 1) {
        errors.push(`${prefix}.fileVersion must be an integer >= 1`);
      }
      if (!VALID_CHANGES.has(file.change)) {
        errors.push(`${prefix}.change must be added, modified, or unchanged`);
      }
    }
  }

  if (!Array.isArray(manifest.removedFiles)) {
    errors.push("removedFiles must be an array");
  } else {
    const removed = new Set();
    for (const path of manifest.removedFiles) {
      if (typeof path !== "string" || !path.startsWith("/")) {
        errors.push("removedFiles entries must be absolute repository paths");
        continue;
      }
      if (removed.has(path)) errors.push(`Duplicate removed path: ${path}`);
      removed.add(path);
    }
  }

  if (!Array.isArray(manifest.runtimeEntries)) {
    errors.push("runtimeEntries must be an array");
  }
  if (!Array.isArray(manifest.persistent)) {
    errors.push("persistent must be an array");
  }

  return { valid: errors.length === 0, errors };
}

export function compareRevisions(installed, target) {
  if (!installed) return "LOCAL_REVISION_UNKNOWN";

  const installedSequence = installed.revisionSequence;
  const targetSequence = target.revisionSequence;

  if (!Number.isInteger(installedSequence)) return "LOCAL_REVISION_UNKNOWN";
  if (targetSequence > installedSequence) return "UPDATE_AVAILABLE";
  if (targetSequence < installedSequence) return "REMOTE_OLDER";
  if (target.revisionId === installed.revisionId) return "CURRENT";
  return "REVISION_MISMATCH";
}

export function classifyInstallAttempt(installed, target) {
  const comparison = compareRevisions(installed, target);
  if (comparison === "CURRENT") return "SAME_REVISION_REPULL";
  if (comparison === "REMOTE_OLDER") return "OLDER_REVISION_DETECTED";
  return comparison;
}

export function buildChangePlan(ns, installedManifest, targetManifest) {
  const installedByPath = new Map(
    (installedManifest?.files ?? []).map((file) => [file.path, file]),
  );

  const plan = {
    added: [],
    updated: [],
    unchanged: [],
    missingLocal: [],
    removed: [...(targetManifest.removedFiles ?? [])],
  };

  for (const target of targetManifest.files) {
    const path = target.path;
    if (!ns.fileExists(path, "home")) {
      plan.missingLocal.push(path);
      continue;
    }

    const installed = installedByPath.get(path);
    if (!installed) {
      plan.added.push(path);
    } else if (installed.fileVersion !== target.fileVersion) {
      plan.updated.push(path);
    } else {
      plan.unchanged.push(path);
    }
  }

  return plan;
}

export function summarizeManifest(manifest) {
  if (!manifest) return null;
  return {
    schemaVersion: manifest.schemaVersion,
    releaseVersion: manifest.releaseVersion,
    revisionSequence: manifest.revisionSequence,
    revisionId: manifest.revisionId,
    previousRevisionId: manifest.previousRevisionId ?? null,
  };
}

function requireString(object, key, errors) {
  if (typeof object[key] !== "string" || object[key].trim() === "") {
    errors.push(`${key} must be a non-empty string`);
  }
}

function requireInteger(object, key, errors, minimum) {
  if (!Number.isInteger(object[key]) || object[key] < minimum) {
    errors.push(`${key} must be an integer >= ${minimum}`);
  }
}
