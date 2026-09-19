/** R1 compatibility facade; pure tool selection/catalog behavior is application-owned. */
export {
  TOOL_NAMES,
  TOOL_CATEGORIES,
  TOOL_CATEGORY_MAP,
  TOOL_CAPABILITIES,
  ALL_REGISTERED_TOOLS,
  validateToolName,
  validateToolArguments,
  ToolSelector,
  selectTool,
  executeToolStep,
} from "../../application/services/legacy-tool-orchestrator.js";
export type {
  ToolName,
  ToolRisk,
  ToolCategory,
  ToolCapability,
  LegacyToolStep,
} from "../../application/services/legacy-tool-orchestrator.js";
