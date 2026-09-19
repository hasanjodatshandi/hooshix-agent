/** R1 compatibility facade; pure command policy is application-owned. */
export {
  validateCommand,
  evaluateCommandPermission,
  assertCommandPermission,
} from "../../application/services/legacy-command-policy.js";
export type {
  CommandRisk,
  PermissionDecision,
} from "../../application/services/legacy-command-policy.js";
