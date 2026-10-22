import {describe,it,expect} from "vitest";
import {validateWSLGitBranchName,validateWSLGitBranchResponse,validateWSLGitAddPaths,validateWSLGitAddResponse,validateWSLGitCommitMessage,validateWSLGitCommitResponse,validateWSLGitCheckoutResponse,validateWSLGitCommitRequestID,reconcileUnknownWSLGitCommit} from "../src/security/wsl-workspace-client.js";

describe("WSL Git owner-write branch protocol",()=>{
 it("checkout rejects ambiguous acknowledgments and accepts only the target branch",()=>{
  expect(validateWSLGitCheckoutResponse(JSON.stringify({
    ok:true,gitStdout:"feature/same",gitStderr:""
  }),"feature/same").ok).toBe(true);
  for(const raw of ["{}",JSON.stringify({ok:true,gitStdout:""}),
    JSON.stringify({ok:true,gitStdout:"feature/different"}),
    JSON.stringify({ok:false,error:"wslgit_checkout_outcome_unknown"})]){
    expect(()=>validateWSLGitCheckoutResponse(raw,"feature/same")).toThrow();
  }
 });

 it("requires literal, unique and confined git_add filenames",()=>{
   expect(validateWSLGitAddPaths(["README.md","src/App.java"])).toEqual(["README.md","src/App.java"]);
   for(const paths of [[],["."],["../outside"],["D:\\sensitive"],[".git/config"],
     ["*.ts"],["foo?bar"],["src","src"],["-all"],["a:1"],["a[1]"]]){
     expect(()=>validateWSLGitAddPaths(paths),JSON.stringify(paths)).toThrow();
   }
   expect(()=>validateWSLGitAddPaths(Array.from({length:101},(_,i)=>"f"+i))).toThrow();
   expect(validateWSLGitAddResponse(JSON.stringify({
     ok:true,gitStdout:"staged 2",stagedFiles:2
   }),2).stagedFiles).toBe(2);
   expect(()=>validateWSLGitAddResponse(JSON.stringify({
     ok:true,gitStdout:"staged 1",stagedFiles:1
   }),2)).toThrow(/count_mismatch/);
 });
 it("requires an unpredictable 128-bit lowercase hex request token for reconciliation",()=>{
    const token=["0123456789abcdef","0123456789abcdef"].join("");
    expect(validateWSLGitCommitRequestID(token)).toBe(token);
    for(const invalid of ["","a".repeat(31),"a".repeat(33),"Z".repeat(32),
      "0123456789abcdef".repeat(2)+"\n","0".repeat(31)+"-"]){
      expect(()=>validateWSLGitCommitRequestID(invalid)).toThrow(/request_id_invalid/);
    }
 });
 it("reconciles an ACK loss through exactly one read-only probe and never retries a mutation",async()=>{
   const token="abcdefabcdefabcdefabcdefabcdefab";
   const oid="b".repeat(40);
   let checks=0;
   const applied=await reconcileUnknownWSLGitCommit(token,async()=>{
     checks++;
     return {ok:true,state:"applied",gitStdout:oid};
   });
   expect(checks).toBe(1);
   expect(applied).toMatchObject({ok:true,gitStdout:oid,state:"applied"});
   const unresolved=async()=>reconcileUnknownWSLGitCommit(token,async()=>{
     checks++;
     return {ok:true,state:"unresolved",gitStdout:""};
   });
   await expect(unresolved()).rejects.toThrow("requestId="+token);
   expect(checks).toBe(2);
   await expect(reconcileUnknownWSLGitCommit(token,async()=>{
     checks++;
     throw new Error("owner read pipe offline");
   })).rejects.toThrow("requestId="+token);
   expect(checks).toBe(3);
   await expect(reconcileUnknownWSLGitCommit(token,async()=>{
     checks++;
     return {ok:true,state:"applied",gitStdout:"not an OID"};
   })).rejects.toThrow("requestId="+token);
   expect(checks).toBe(4);
 });
 it("checks commit messages and exact commit object acknowledgments",()=>{
   expect(validateWSLGitCommitMessage("Commit change")).toBe("Commit change");
   for(const value of ["","    ","contains\0nul","x".repeat(501)]){
    expect(()=>validateWSLGitCommitMessage(value)).toThrow();
   }
   expect(validateWSLGitCommitResponse(JSON.stringify({
      ok:true,gitStdout:"a".repeat(40)
   })).gitStdout).toBe("a".repeat(40));
   expect(()=>validateWSLGitCommitResponse(JSON.stringify({
      ok:true,gitStdout:"success"
   }))).toThrow(/oid_invalid/);
 });

 it("accepts a constrained branch name and rejects malicious argv",()=>{
  expect(validateWSLGitBranchName("feature/issue-25")).toBe("feature/issue-25");
  for(const name of ["","--help","-D","../root","x..y","hello world","x//y","x.lock",
    "x@{y}","x/","x.","a;touch /tmp/file","refs\\heads\\bad","üñíçødé"]){
    expect(()=>validateWSLGitBranchName(name),name).toThrow(/wslgit_branch_name_invalid/);
  }
 });
 it("rejects missing or malformed broker acknowledgments without retry",()=>{
  expect(validateWSLGitBranchResponse(JSON.stringify({ok:true,gitStdout:"",gitStderr:""})).ok).toBe(true);
  for(const raw of ["{not json}","null","{}",JSON.stringify({ok:true}),
    JSON.stringify({ok:true,gitStdout:3}),
    JSON.stringify({ok:false,error:"wslgit_branch_failed_or_outcome_unknown"})]){
   expect(()=>validateWSLGitBranchResponse(raw)).toThrow();
  }
 });
});
