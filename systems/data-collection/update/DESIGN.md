# Repository Update Subsystem — Design

## Authority

This document refines the root `DESIGN.md` and `systems/data-collection/DESIGN.md` for repository update behavior. Higher-level design documents remain authoritative if they conflict with this file.

## Purpose

Keep the in-game managed script set synchronized with an explicitly approved repository revision while making update status, changed files, integrity failures, and revision mistakes visible.

The subsystem contains two roles:

```text
Repository Update Subsystem
├── Update Watcher
└── Revision Puller
```

The watcher may detect updates automatically. The puller may install only after explicit player authorization.

## Authoritative Revision Manifest

Every published stack revision must provide a manifest describing the complete expected managed-file inventory for that revision.

The manifest is both:

1. the update plan/source of truth for what should exist after installation; and
2. the sanity-check record used to prove what changed and whether the pull actually reached the intended revision.

Required revision-level identity includes:

```text
schemaVersion
releaseVersion
revisionSequence
revisionId
previousRevisionId
versionFile
files[]
removedFiles[]
runtimeEntries[]
persistent[]
```

`revisionSequence` is a monotonically increasing integer for published managed-stack revisions. `revisionId` uniquely identifies the exact manifest/revision. The sequence exists so the updater can determine ordering without guessing from timestamps or semantic-version text.

Each managed file entry should contain at least:

```text
path
required
fileVersion
change
```

`fileVersion` is a monotonically increasing per-file token and changes whenever the managed contents of that file change.

`change` is release-relative metadata intended for reporting and should classify the target revision entry as `added`, `modified`, or `unchanged` relative to the preceding published revision.

Files intentionally removed from management are listed explicitly in `removedFiles`.

> A managed file may not silently disappear from the manifest and be interpreted as permission to delete it.

## Local Installed Revision Record

The updater must retain the last successfully installed manifest/revision identity as local installed-state metadata.

That record is advanced only after the target revision passes required post-pull integrity validation.

The previous installed manifest remains available during update planning and validation so the puller can compare local and target file versions and build an explicit change report.

## Revision Sanity Checks

Before installation, compare the target revision with the currently installed revision.

Required outcomes include:

### Forward Revision

```text
target.revisionSequence > installed.revisionSequence
```

Normal update candidate. Continue with manifest comparison, authorization, pull, and validation.

### Same Revision Re-Pull

```text
target.revisionSequence == installed.revisionSequence
AND target.revisionId == installed.revisionId
```

Status: `SAME_REVISION_REPULL`.

This must raise a visible warning/alarm and must not be reported as a successful new update. A manual repair/revalidation operation may still re-fetch missing or corrupt files, but the installed revision does not advance and the result must be described as repair/revalidation rather than update success.

### Older Revision Detected

```text
target.revisionSequence < installed.revisionSequence
```

Status: `OLDER_REVISION_DETECTED`.

This must raise a high-visibility alarm and block normal update installation. A downgrade, if ever supported, requires an explicit separate player-authorized downgrade path rather than being treated as an update.

### Revision Identity Mismatch

```text
target.revisionSequence == installed.revisionSequence
AND target.revisionId != installed.revisionId
```

Status: `REVISION_MISMATCH`.

This indicates inconsistent/corrupt revision metadata and must block installation until reconciled.

### Missing Local Revision Metadata

A fresh install or damaged local install may have no trustworthy installed manifest. In that case the target manifest is treated as a full-install inventory. The result must be labelled as a fresh/recovery install, not inferred to be an incremental update.

## Update Planning

Before modifying managed files, compare the installed and target manifests and classify every managed path as applicable:

```text
ADDED
UPDATED
UNCHANGED
MISSING_LOCAL
REMOVED
PRESERVED_PERSISTENT
FAILED
```

Expected behavior:

- target file absent locally → fetch regardless of matching metadata;
- target file version newer/different → fetch;
- target file version unchanged and file exists → normally leave unchanged;
- explicitly removed target path → remove only under the controlled removal policy;
- persistent running scripts → preserve/restart according to compatibility policy;
- files outside managed inventory → never delete merely because they are unknown to the manifest.

## Pull and Integrity Sequence

Conceptually:

```text
fetch target manifest
→ validate manifest schema/revision identity
→ compare target vs installed revision
→ alarm/block on older or inconsistent revision
→ build explicit file-change plan
→ player authorizes installation
→ stop/reconcile replaceable processes
→ fetch required added/updated/missing files
→ process explicit removals
→ verify every required target file is present
→ verify fetched files correspond to target manifest metadata where supported
→ regenerate/validate RAM audit
→ record target manifest as installed
→ restart normal stack
→ publish update result/change report
```

The installed revision record must be one of the final successful steps, never an optimistic pre-pull write.

## Change Reporting

Every pull/revalidation attempt should publish a machine-readable and human-readable result containing at least:

```text
installedBefore
targetRevision
installedAfter
outcome
added[]
updated[]
unchanged[]
restoredMissing[]
removed[]
preserved[]
failed[]
warnings[]
```

The dashboard/terminal should clearly distinguish:

- a genuine forward revision installed successfully;
- an already-current revision being re-pulled;
- a repair of missing/corrupt files at the same revision;
- an attempted older revision;
- an integrity or metadata mismatch;
- a partial/failed update.

> Download completion is not evidence of update success. The updater must prove that the intended target revision became the validated installed revision.

## Watcher Behavior

The Update Watcher compares the installed revision record with the approved remote manifest and publishes update state without modifying managed scripts.

Useful states include:

```text
CURRENT
UPDATE_AVAILABLE
SAME_REVISION
REMOTE_OLDER
REVISION_MISMATCH
LOCAL_REVISION_UNKNOWN
CHECK_FAILED
```

`REMOTE_OLDER` and `REVISION_MISMATCH` should generate prominent telemetry warnings because they may indicate a stale branch, cached/incorrect source, accidental rollback, or manifest publication error.

## Failure and Recovery

A failed update must not advance the installed revision record.

If the updater changes some files but fails before validation completes, the stack should expose `DEGRADED`/update-failed state and use the retained installed/target manifests to identify the partial state. Exact rollback/staging mechanics remain implementation-dependent, but silent partial success is prohibited.

## Validation Expectations

Validation must prove that:

- every required target file is checked for presence;
- changed per-file versions produce `UPDATED` classification;
- newly introduced files produce `ADDED` classification;
- unchanged present files are not falsely reported as updated;
- missing unchanged files are restored and reported separately;
- explicit removals are distinguishable from absent manifest entries;
- the manifest and version metadata participate in sanity checking;
- same-revision re-pulls raise `SAME_REVISION_REPULL` and never report a new update success;
- older targets raise `OLDER_REVISION_DETECTED` and are blocked from normal update flow;
- equal sequence with different IDs raises `REVISION_MISMATCH`;
- failed/partial pulls do not advance installed revision metadata;
- successful forward pulls report the exact files added, updated, unchanged, restored, removed, preserved, and failed;
- RAM Audit is regenerated/validated before normal scheduling relies on the new revision.

## Deferred Implementation Details

Intentionally deferred until the updater is implemented and tested:

- exact remote URL/base-path mechanism;
- exact installed-manifest state-file path;
- content hash/checksum strategy in addition to fileVersion;
- download retry/backoff values;
- staging/rollback implementation;
- persistent-process compatibility declaration format;
- exact dashboard alarm presentation;
- explicit downgrade workflow, if one is ever needed.
