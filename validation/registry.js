import { PATHS } from "/core/config.js";

// This is the single list the dashboard's "Run Active Tests" button follows.
// Add tests here while a feature is ACTIVE/VALIDATING; remove them once COMPLETE.
export const ACTIVE_TESTS = Object.freeze([
  {
    id: "updater-contracts",
    label: "Updater contract tests",
    script: "/systems/data-collection/update/validate.js",
    args: [],
    resultPath: PATHS.updateValidationState,
    timeoutMs: 15_000,
  },
  {
    id: "ram-audit",
    label: "RAM audit",
    script: "/systems/ram-audit/audit.js",
    args: [],
    resultPath: PATHS.ramAudit,
    timeoutMs: 15_000,
  },
]);
