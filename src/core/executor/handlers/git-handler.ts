import { z } from "zod";
import { isWSLWorkspaceURI } from "../../../security/wsl-workspace-uri.js";
import { getActiveWorkspace } from "../../../security/workspace-guard.js";
import { invokeWSLFileOperation, invokeWSLGitCreateBranch, invokeWSLGitAdd, invokeWSLGitCommit, invokeWSLGitCheckout } from "../../../security/wsl-workspace-client.js";
import { policyDecisionPoint } from "../../governance/policy-decision-point.js";
import { resolveCorrelationId } from "../../runtime/correlation-id.js";
import { logCommandAction } from "../../../memory/command-audit.js";
import { bestEffortAsyncTelemetry } from "../../trace/telemetry-degradation.js";
import type { ToolHandler, ToolHandlerContext } from "./tool-handler.js";
import type { ToolName } from "../../../application/services/legacy-tool-orchestrator.js";
import { gitStatus, gitDiff, gitClone, gitCommit, gitBranch, gitCheckout, gitAdd, gitInit, gitLog } from "../../../services/git/git-service.js";

const GIT_TOOLS: ReadonlySet<ToolName> = new Set([
  "git_status", "git_diff", "git_clone", "git_commit", "git_branch", "git_checkout",
  "git_add", "git_init", "git_log"
]);

const object = z.record(z.string(), z.unknown());

export class GitToolHandler implements ToolHandler {
  canHandle(tool: ToolName): boolean {
    return GIT_TOOLS.has(tool);
  }

  async handle({ tool, input, correlationId, executionContext }: ToolHandlerContext): Promise<unknown> {
    const data = object.parse(input);
    const root = executionContext?.workspace ?? getActiveWorkspace();
    if(root && isWSLWorkspaceURI(root)){
      // Native WSL Git is confined to the authenticated Linux root.
      const cwd = data.cwd;
      if(cwd!==undefined && (typeof cwd!=="string" || (cwd!=="." && cwd!==root)))
        throw new Error("wslgit_cwd_must_equal_workspace_root");
      if(tool==="git_checkout"){
        const {name,create}=z.object({
          name:z.string().min(1).max(128),create:z.boolean().default(false)
        }).parse(data);
        if(create)throw new Error("wslgit_checkout_create_requires_transactional_support");
        policyDecisionPoint.assertAllowed({tool,arguments:input,correlationId});
        const trace=resolveCorrelationId(correlationId);
        try{
          const reply=await invokeWSLGitCheckout(root,name,false);
          await bestEffortAsyncTelemetry(()=>logCommandAction({
            command:"git",args:["checkout","--",name],cwd:root,exitCode:0,
            status:"success",correlationId:trace
          }));
          return {exitCode:0,stdout:reply.gitStdout??"",stderr:reply.gitStderr??"",
            branch:name,correlationId:trace};
        }catch(e){
          await bestEffortAsyncTelemetry(()=>logCommandAction({
            command:"git",args:["checkout","--",name],cwd:root,status:"failed",correlationId:trace
          }));
          throw e;
        }
      }
      if(tool==="git_commit"){
        const {message}=z.object({message:z.string().min(1).max(500)}).parse(data);
        policyDecisionPoint.assertAllowed({tool,arguments:input,correlationId});
        const trace=resolveCorrelationId(correlationId);
        try{
          const reply=await invokeWSLGitCommit(root,message);
          await bestEffortAsyncTelemetry(()=>logCommandAction({
            command:"git",args:["commit","-m",message],cwd:root,exitCode:0,
            status:"success",correlationId:trace
          }));
          return {exitCode:0,stdout:reply.gitStdout??"",stderr:reply.gitStderr??"",
            commitOid:reply.gitStdout,correlationId:trace};
        }catch(e){
          await bestEffortAsyncTelemetry(()=>logCommandAction({
            command:"git",args:["commit","-m",message],cwd:root,status:"failed",correlationId:trace
          }));
          throw e;
        }
      }
      if(tool==="git_add"){
        const {paths}=z.object({paths:z.array(z.string()).min(1).max(100)}).parse(data);
        policyDecisionPoint.assertAllowed({tool,arguments:input,correlationId});
        const trace=resolveCorrelationId(correlationId);
        try{
          const reply=await invokeWSLGitAdd(root,paths);
          await bestEffortAsyncTelemetry(()=>logCommandAction({
            command:"git",args:["add", "--",...paths],cwd:root,exitCode:0,
            status:"success",correlationId:trace
          }));
          return {exitCode:0,stdout:reply.gitStdout??"",stderr:reply.gitStderr??"",
            stagedFiles:reply.stagedFiles,correlationId:trace};
        }catch(e){
          await bestEffortAsyncTelemetry(()=>logCommandAction({
            command:"git",args:["add","--",...paths],cwd:root,status:"failed",correlationId:trace
          }));
          throw e;
        }
      }
      if(tool==="git_branch"){
        const {name}=z.object({name:z.string().min(1).max(128)}).parse(data);
        policyDecisionPoint.assertAllowed({tool,arguments:input,correlationId});
        const trace=resolveCorrelationId(correlationId);
        try{
          const reply=await invokeWSLGitCreateBranch(root,name);
          await bestEffortAsyncTelemetry(()=>logCommandAction({
            command:"git",args:["branch","--",name],cwd:root,exitCode:0,
            status:"success",correlationId:trace
          }));
          return {exitCode:0,stdout:reply.gitStdout??"",stderr:reply.gitStderr??"",correlationId:trace};
        }catch(e){
          await bestEffortAsyncTelemetry(()=>logCommandAction({
            command:"git",args:["branch","--",name],cwd:root,status:"failed",correlationId:trace
          }));
          throw e;
        }
      }
      if(tool!=="git_status" && tool!=="git_diff" && tool!=="git_log")
        throw new Error("wslgit_mutation_requires_separate_owner_git_enrollment");
      let query="";
      if(tool==="git_diff"){
        const values=z.object({staged:z.boolean().default(false)}).parse({staged:data.staged});
        query=values.staged?"staged":"";
      }
      if(tool==="git_log"){
        const values=z.object({limit:z.number().int().min(1).max(100).default(20)}).parse({limit:data.limit});
        query=String(values.limit);
      }
      policyDecisionPoint.assertAllowed({tool,arguments:input,correlationId});
      const result=await invokeWSLFileOperation(root,tool,".",{query});
      const trace=resolveCorrelationId(correlationId);
      await bestEffortAsyncTelemetry(()=>logCommandAction({
        command:"git",args:[tool,query],cwd:root,exitCode:0,status:"success",correlationId:trace
      }));
      return {exitCode:0,stdout:result.gitStdout??"",stderr:result.gitStderr??"",correlationId:trace};
    }
    switch (tool) {
      case "git_status": {
        const value = z.object({ cwd: z.string().default(".") }).parse(data);
        return gitStatus(value.cwd, correlationId);
      }
      case "git_diff": {
        const value = z.object({ cwd: z.string().default("."), staged: z.boolean().default(false) }).parse(data);
        return gitDiff(value.cwd, value.staged, correlationId);
      }
      case "git_clone": {
        const value = z.object({ url: z.url(), path: z.string() }).parse(data);
        return gitClone(value.url, value.path, correlationId);
      }
      case "git_commit": {
        const value = z.object({ cwd: z.string().default("."), message: z.string().min(1).max(500) }).parse(data);
        return gitCommit(value.cwd, value.message, correlationId);
      }
      case "git_branch": {
        const value = z.object({ cwd: z.string().default("."), name: z.string() }).parse(data);
        return gitBranch(value.cwd, value.name, correlationId);
      }
      case "git_checkout": {
        const value = z.object({ cwd: z.string().default("."), name: z.string(), create: z.boolean().default(false) }).parse(data);
        return gitCheckout(value.cwd, value.name, value.create, correlationId);
      }
      case "git_add": {
        const value = z.object({ cwd: z.string().default("."), paths: z.array(z.string()).min(1).max(100) }).parse(data);
        return gitAdd(value.cwd, value.paths, correlationId);
      }
      case "git_init": {
        const value = z.object({ path: z.string(), initialBranch: z.string().default("main") }).parse(data);
        return gitInit(value.path, value.initialBranch, correlationId);
      }
      case "git_log": {
        const value = z.object({ cwd: z.string().default("."), limit: z.number().int().min(1).max(100).default(20) }).parse(data);
        return gitLog(value.cwd, value.limit, correlationId);
      }
      default:
        throw new Error(`GitToolHandler: unsupported tool ${tool}`);
    }
  }
}
