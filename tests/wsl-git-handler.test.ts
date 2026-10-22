import {describe,expect,it,vi,beforeEach} from "vitest";
import {GitToolHandler} from "../src/core/executor/handlers/git-handler.js";
import {runWithWorkspaceScope} from "../src/security/workspace-guard.js";

const fake=vi.hoisted(()=>({runs:[] as Array<{root:string;operation:string;path:string;query:string}>,branches:[] as string[], staged:[] as string[][],commits:[] as string[],checkouts:[] as string[]}));
vi.mock("../src/security/wsl-workspace-client.js",()=>({
 invokeWSLFileOperation:vi.fn(async(root:string,operation:string,path:string,options?:{query?:string})=>{
  fake.runs.push({root,operation,path,query:options?.query??""});
  return {ok:true,gitStdout:operation+" result",gitStderr:""};
 }),
 invokeWSLGitCreateBranch:vi.fn(async(_root:string,name:string)=>{
   fake.branches.push(name);
   return {ok:true,gitStdout:"",gitStderr:""};
 }),
 invokeWSLGitAdd:vi.fn(async(_root:string,paths:string[])=>{
   fake.staged.push(paths);
   return {ok:true,gitStdout:"staged",gitStderr:"",stagedFiles:paths.length};
 }),
 invokeWSLGitCommit:vi.fn(async(_root:string,message:string)=>{
  fake.commits.push(message);
  return {ok:true,gitStdout:"a".repeat(40),gitStderr:""};
 }),
 invokeWSLGitCheckout:vi.fn(async(_root:string,name:string,create:boolean)=>{
  if(create)throw new Error("create denied");
  fake.checkouts.push(name);
  return {ok:true,gitStdout:name,gitStderr:""};
 })
}));
vi.mock("../src/services/git/git-service.js",()=>({
 gitStatus:()=>{throw new Error("native Windows Git must never run")},
 gitDiff:()=>{throw new Error("native Windows Git must never run")},
 gitClone:()=>{throw new Error("native Windows Git must never run")},
 gitCommit:()=>{throw new Error("native Windows Git must never run")},
 gitBranch:()=>{throw new Error("native Windows Git must never run")},
 gitCheckout:()=>{throw new Error("native Windows Git must never run")},
 gitAdd:()=>{throw new Error("native Windows Git must never run")},
 gitInit:()=>{throw new Error("native Windows Git must never run")},
 gitLog:()=>{throw new Error("native Windows Git must never run")},
}));
vi.mock("../src/core/governance/policy-decision-point.js",()=>({
 policyDecisionPoint:{assertAllowed:vi.fn(),evaluate:vi.fn(()=>({
  allowed:true,requiresApproval:false,risk:"low",reason:"test allow"
 }))},
}));
vi.mock("../src/memory/command-audit.js",()=>({logCommandAction:vi.fn(async()=>{})}));

const root="wsl://Ubuntu/home/coder/workspace/Hooshix";
const handler=new GitToolHandler();
function call(tool:"git_status"|"git_diff"|"git_log"|"git_branch"|"git_add"|"git_commit"|"git_checkout"|"git_init",
 input:Record<string,unknown>={}){
 return runWithWorkspaceScope(root,()=>handler.handle({
   tool,input,correlationId:"test-wsl-git",
 }));
}
describe("native WSL Git tool routing",()=>{
 beforeEach(()=>{fake.runs.length=0;fake.branches.length=0;fake.staged.length=0;fake.commits.length=0;fake.checkouts.length=0;});
 it("routes Git status, diff and log over the native Linux file broker",async()=>{
  const status=await call("git_status");
  const diff=await call("git_diff",{cwd:root,staged:true});
  const log=await call("git_log",{limit:7});
  expect(status).toMatchObject({exitCode:0,stdout:"git_status result"});
  expect(diff).toMatchObject({exitCode:0,stdout:"git_diff result"});
  expect(log).toMatchObject({exitCode:0,stdout:"git_log result"});
  expect(fake.runs).toEqual([
    {root,operation:"git_status",path:".",query:""},
    {root,operation:"git_diff",path:".",query:"staged"},
    {root,operation:"git_log",path:".",query:"7"},
  ]);
 });
 it("rejects Windows paths, Linux subfolders and invalid query arguments",async()=>{
  await expect(call("git_status",{cwd:"D:\\workspace\\other"})).rejects.toThrow(/cwd_must_equal/);
  await expect(call("git_status",{cwd:root+"/subdir"})).rejects.toThrow(/cwd_must_equal/);
  await expect(call("git_log",{limit:101})).rejects.toThrow();
  await expect(call("git_diff",{staged:"yes"})).rejects.toThrow();
  expect(fake.runs).toHaveLength(0);
 });
 it("routes branch creation through independently approved Git mutation pipe",async()=>{
  const created=await call("git_branch",{name:"feature/safe"});
  expect(created).toMatchObject({exitCode:0});
  expect(fake.branches).toEqual(["feature/safe"]);
  expect(fake.runs).toHaveLength(0);
 });
 it("routes scoped git_add to Git write worker without using Windows Git",async()=>{
  const result=await call("git_add",{paths:["src/App.java","README.md"]});
  expect(result).toMatchObject({exitCode:0,stagedFiles:2});
  expect(fake.staged).toEqual([["src/App.java","README.md"]]);
  expect(fake.runs).toHaveLength(0);
 });
 it("routes commit through independent Git write pipe",async()=>{
   const committed=await call("git_commit",{message:"safe change"});
   expect(committed).toMatchObject({exitCode:0,commitOid:"a".repeat(40)});
   expect(fake.commits).toEqual(["safe change"]);
   expect(fake.runs).toHaveLength(0);
 });
 it("routes existing-branch checkout to independent owner Git pipe",async()=>{
  const reply=await call("git_checkout",{name:"feature/safe",create:false});
  expect(reply).toMatchObject({exitCode:0,branch:"feature/safe"});
  expect(fake.checkouts).toEqual(["feature/safe"]);
  await expect(call("git_checkout",{name:"feature/new",create:true}))
    .rejects.toThrow(/checkout_create_requires_transactional_support/);
  expect(fake.checkouts).toHaveLength(1);
  expect(fake.runs).toHaveLength(0);
 });
 it("keeps unsupported mutating Git tools disabled on the read-only WSL worker",async()=>{
  await expect(call("git_init",{path:root})).rejects.toThrow(/separate_owner_git_enrollment/);
  expect(fake.runs).toHaveLength(0);
 });
});
