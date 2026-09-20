/** Legacy import facade: R2.01 metadata is sourced only from the exhaustive operation catalog.
 * Runtime tool effects are mediated by the R2 ExecuteToolUseCase; this facade remains for typed Task-step selection. */
import { TOOL_NAMES, TOOL_CAPABILITIES } from "./operation-catalog.js";
import type { ToolName, ToolCapability } from "./operation-catalog.js";
import type { ToolRisk } from "../../domain/tool/tool-descriptor.js";
export { TOOL_NAMES, TOOL_CATEGORIES, TOOL_CATEGORY_MAP, TOOL_CAPABILITIES, ALL_REGISTERED_TOOLS } from "./operation-catalog.js";
export type { ToolName, ToolCategory, ToolCapability } from "./operation-catalog.js";
export type { ToolRisk } from "../../domain/tool/tool-descriptor.js";
const TOOL_SET = new Set<string>(TOOL_NAMES);
const RISK_RANK: Record<ToolRisk,number>={low:0,medium:1,high:2,critical:3};

export interface LegacyToolStep { readonly action: string; readonly tool?: ToolName; readonly id?: number; readonly status?: string; readonly arguments?: unknown; readonly dependsOn?: readonly number[]; }

export function validateToolName(value:string):ToolName {
  if(!TOOL_SET.has(value)) throw new Error(`Unknown tool: ${value}`);
  return value as ToolName;
}
export function validateToolArguments(tool:ToolName,value:unknown):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value)) throw new Error(`Invalid arguments for ${tool}`);
  const input=value as Record<string,unknown>;
  const missing=TOOL_CAPABILITIES[tool].requiredArguments.filter(name=>!(name in input));
  if(missing.length) throw new Error(`Invalid arguments for ${tool}: missing ${missing.join(", ")}`);
  return input;
}
function capabilityScore(action:string,capability:ToolCapability):number{
  const tokens=new Set(action.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean));
  return capability.capabilities.reduce((score,word,index)=>score+(tokens.has(word)?index===0?3:1:0),0);
}
export class ToolSelector {
  select(step:LegacyToolStep,available:readonly ToolName[]=TOOL_NAMES):ToolName{
    if(step.tool) return validateToolName(step.tool);
    if(!available.length) throw new Error("No tools are available");
    const ranked=available.map(tool=>({tool,score:capabilityScore(step.action,TOOL_CAPABILITIES[tool])}))
      .sort((a,b)=>b.score-a.score||RISK_RANK[TOOL_CAPABILITIES[a.tool].risk]-RISK_RANK[TOOL_CAPABILITIES[b.tool].risk]||TOOL_NAMES.indexOf(a.tool)-TOOL_NAMES.indexOf(b.tool));
    return ranked[0].score>0?ranked[0].tool:"search_files";
  }
}
const defaultSelector=new ToolSelector();
export function selectTool(step:LegacyToolStep):ToolName{return defaultSelector.select(step);}
export async function executeToolStep<TStep extends LegacyToolStep,TSignal>(
  step:TStep,
  executor:(tool:ToolName,step:TStep,signal?:TSignal)=>Promise<unknown>,
  signal?:TSignal,
):Promise<{tool:ToolName;result:unknown}>{
  const tool=defaultSelector.select(step);
  return {tool,result:await executor(tool,step,signal)};
}