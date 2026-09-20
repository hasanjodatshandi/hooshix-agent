import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { executeShellCommand } from "../../src/services/shell/shell-service.js";
import { runWithPolicyApproval } from "../../src/core/governance/policy-decision-point.js";
import { getActiveWorkspace } from "../../src/security/workspace-guard.js";
const original=process.env.HOOSHIX_DIRECT_AUTO_APPROVE;
afterEach(()=>{
  if(original===undefined)delete process.env.HOOSHIX_DIRECT_AUTO_APPROVE;
  else process.env.HOOSHIX_DIRECT_AUTO_APPROVE=original;
});
describe("R2.07 outside-cwd privilege boundary",()=>{
  it("rejects direct outside-workspace subprocess even with legacy direct-auto-approve enabled",async()=>{
    expect(getActiveWorkspace()).toBeTruthy();
    process.env.HOOSHIX_DIRECT_AUTO_APPROVE="1";
    await expect(executeShellCommand("node",["--version"],os.tmpdir()))
      .rejects.toThrow(/approval required|outside workspace/i);
  });
  it("keeps the existing explicitly governed Task approval behavior",async()=>{
    process.env.HOOSHIX_DIRECT_AUTO_APPROVE="1";
    const response=await runWithPolicyApproval("execute_command",()=>executeShellCommand("node",["--version"],os.tmpdir()));
    expect(response.exitCode).toBe(0);
  });
});
