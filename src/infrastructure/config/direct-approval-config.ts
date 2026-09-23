/** R7.01 compatibility projection over the single direct-approval parser in `app-config.ts`. */
import { parseDirectApprovalBypass } from "./app-config.js";

export const isDirectApprovalBypassConfigured = parseDirectApprovalBypass;
