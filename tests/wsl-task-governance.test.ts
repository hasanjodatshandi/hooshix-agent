import {describe,expect,it} from "vitest";
import {checkStepGovernance} from "../src/core/governance/step-governance.js";
import {runWithWorkspaceScope} from "../src/security/workspace-guard.js";
import type {TaskStep} from "../src/application/dto/legacy-task-plan.js";

const root="wsl://Ubuntu/home/coder/workspace/Hooshix";
function step(tool:TaskStep["tool"],args:Record<string,unknown>={}):TaskStep{
 return {id:1,action:"WSL provider action",tool,status:"pending",arguments:args};
}
function decision(tool:TaskStep["tool"],args:Record<string,unknown>={}){
 return runWithWorkspaceScope(root,()=>checkStepGovernance(step(tool,args),root));
}
describe("WSL task native-provider routing and governance",()=>{
 it("allows safely scoped native read_file and Git status",()=>{
  expect(decision("read_file",{path:"src/main.java"}).decision).toBe("allow");
  expect(decision("search_files",{path:".",query:"TODO"}).decision).toBe("allow");
  expect(decision("git_status",{cwd:"."}).decision).toBe("allow");
  expect(decision("git_diff",{cwd:root}).decision).toBe("allow");
 });
 it("blocks traversal and Windows absolute paths before Task approval",()=>{
  for(const candidate of ["../outside","src/../outside","/etc/passwd","D:\\workspace\\sensitive"]){
   expect(decision("read_file",{path:candidate}).decision).toBe("blocked");
  }
  expect(decision("git_log",{cwd:root+"/unrelated"}).decision).toBe("blocked");
  expect(decision("git_status",{cwd:"D:\\workspace\\repo"}).decision).toBe("blocked");
 });
 it("blocks unsupported Git mutations and Windows execution before approval",()=>{
  for(const tool of ["git_init",
    "execute_command","install_package"] as const){
   const result=decision(tool,{cwd:root,command:"git",args:["status"],path:"."});
   expect(result.decision,tool).toBe("blocked");
   expect(result.reason).toMatch(/wsl_task_requires_native_owner_capability/);
  }
 });
 it("branch creation retains Git mutation approval while unsupported Git writes stay blocked",()=>{
  expect(decision("git_branch",{cwd:root,name:"feature/new"}).decision).toBe("approval_required");
  expect(decision("git_add",{cwd:root,paths:["README.md"]}).decision).toBe("approval_required");
  expect(decision("git_commit",{cwd:root,message:"safe"}).decision).toBe("approval_required");
  expect(decision("git_checkout",{cwd:root,name:"feature/safe",create:false}).decision).toBe("approval_required");
  expect(decision("git_branch",{cwd:"D:\\workspace\\repo",name:"feature/new"}).decision).toBe("blocked");
 });
 it("file mutations retain their normal governance posture",()=>{
  expect(decision("delete_file",{path:"src/one.txt"}).decision).toBe("approval_required");
  expect(decision("create_file",{path:"src/new.txt",content:"abc"}).decision).toBe("allow");
 });
});
