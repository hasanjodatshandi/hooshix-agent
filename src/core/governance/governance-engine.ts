/** R1 compatibility facade; pure action governance is application-owned. */
export {
  evaluateAction,
  assertGovernance,
} from "../../application/services/legacy-action-governance.js";
export type {
  ActionRisk,
  GovernanceDecision,
  GovernanceResult,
} from "../../application/services/legacy-action-governance.js";
