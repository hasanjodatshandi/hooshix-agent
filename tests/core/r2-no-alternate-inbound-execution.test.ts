import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";
import {TOOL_NAMES} from "../../src/application/services/operation-catalog.js";

const root=path.resolve("src/tools");
const schemaOnly=[
  ...["read-file","write-file","list-directory","modify-file","search-files","create-file","delete-file","restore-file"].map(n=>"filesystem/"+n+".ts"),
  "git/index.ts","package/index.ts","shell/execute-command.ts",
  "system/workspace.ts","system/system-info.ts","system/agent-metrics.ts",
];
describe("R2.09 inbound execution path retirement",()=>{
  it("registers every concrete operation through the one application gateway",()=>{
    const registry=fs.readFileSync(path.resolve("src/mcp/registry.ts"),"utf8");
    expect(registry).toContain("createR2RuntimeGateway");
    expect(registry).toContain("executeAuthorizedDirectTool");
    expect(registry).toContain("TOOL_NAMES");
    expect(registry).toContain("return callback(validated,...extra)");
    expect(TOOL_NAMES).toHaveLength(29);
    expect(new Set(TOOL_NAMES).size).toBe(29);
  });
  it("keeps all executable inbound registration modules schema-only",()=>{
    for(const relative of schemaOnly) {
      const src=fs.readFileSync(path.join(root,relative),"utf8");
      expect(src,relative).toContain("r2_legacy_direct_callback_retired");
      expect(src,relative).not.toMatch(/from ["'][^"']*\/services\/(filesystem|git|shell|package)\//);
      expect(src,relative).not.toMatch(/(?:readWorkspaceFile|writeWorkspaceFile|modifyWorkspaceFile|gitCommit|executeShellCommand|managePackage)\s*\(/);
    }
    const loop=fs.readFileSync(path.resolve("src/core/loop/closed-agent-loop.ts"),"utf8");
    expect(loop).not.toContain("runWithPolicyApproval");
    const executor=fs.readFileSync(path.resolve("src/core/executor/local-tool-executor.ts"),"utf8");
    expect(executor).toContain("return getTrustedTaskApproval()!==undefined");
    expect(executor).toContain("runWithPolicyApproval(id,dispatch)");
    const task=fs.readFileSync(path.join(root,"task/index.ts"),"utf8");
    expect(task).not.toMatch(/from ["'][^"']*task-snapshot-handler\.js["']/);
    expect(task.match(/r2_legacy_direct_callback_retired/g)).toHaveLength(2);
    const registry=fs.readFileSync(path.resolve("src/mcp/registry.ts"),"utf8");
    expect(registry).not.toMatch(/return callback\(args,\.\.\.extra\)/);
    expect(registry).toContain("executeAuthorizedDirectTool");
    expect(task).not.toMatch(/(?:captureTaskSnapshot|rollbackTaskSnapshot)\s*\(/);
  });
  it("never falls back to `any` when overriding the SDK registrar",()=>{
    // The registrar is the single mediation seam for inbound tool effects; an
    // `as any` assignment there would disable checking on every registration.
    for(const file of ["registry.ts","metrics-server.ts"]) {
      const src=fs.readFileSync(path.resolve("src/mcp",file),"utf8");
      expect(src,file).not.toMatch(/\(server as any\)\.registerTool/);
    }
    expect(fs.readFileSync(path.resolve("src/mcp/tool-registrar.ts"),"utf8"))
      .toContain("export function captureToolRegistrar");
  });
});