import {createHash} from "node:crypto";
import {describe,expect,it} from "vitest";
import {validateWSLMutationRequest,validateWSLMutationResponse,
 type WSLMutationRequest} from "../src/security/wsl-workspace-client.js";

const hash=(s:string)=>createHash("sha256").update(s,"utf8").digest("hex");
const request=(operation:WSLMutationRequest["operation"],content?:string):WSLMutationRequest=>({
  version:1,operation,path:"src/file.txt",...(content!==undefined?{content}:{}),
  ...(operation==="create"?{}:{expectedSha256:hash("before")}),
  ...(operation==="modify_existing"?{query:"before"}:{}),
  ...(operation==="restore_modified"?{restoredSha256:hash(content??"")}:{}),
});
describe("WSL owner write pipe validation",()=>{
 it("accepts only versioned confined write frames with explicit preconditions",()=>{
  expect(JSON.parse(validateWSLMutationRequest(request("create",""))).operation).toBe("create");
  expect(JSON.parse(validateWSLMutationRequest(request("write_existing","new"))).expectedSha256).toBe(hash("before"));
  expect(JSON.parse(validateWSLMutationRequest(request("delete_existing"))).operation).toBe("delete_existing");
  expect(()=>validateWSLMutationRequest({...request("create","x"),path:"../secret"})).toThrow();
  expect(()=>validateWSLMutationRequest({...request("create","x"),path:"/etc/passwd"})).toThrow();
  expect(()=>validateWSLMutationRequest({...request("write_existing","x"),expectedSha256:"invalid"})).toThrow();
  expect(()=>validateWSLMutationRequest({...request("create","x"),expectedSha256:hash("before")})).toThrow();
  expect(()=>validateWSLMutationRequest(request("write_existing","x".repeat(1024*1024+1)))).toThrow();
  expect(()=>validateWSLMutationRequest(request("write_existing","a\0b"))).toThrow();
  expect(()=>validateWSLMutationRequest({...request("modify_existing","x"),query:""})).toThrow();
  expect(()=>validateWSLMutationRequest({...request("delete_existing"),content:"extra"})).toThrow();
  expect(()=>validateWSLMutationRequest({...request("restore_modified","restored"),restoredSha256:"bad"})).toThrow();
 });
 it("requires worker digests, confirmed creation and valid modify count",()=>{
  const created=request("create","new");
  expect(validateWSLMutationResponse(JSON.stringify({ok:true,created:true,sha256:hash("new")}),created).created).toBe(true);
  expect(()=>validateWSLMutationResponse(JSON.stringify({ok:true,created:true,sha256:hash("tampered")}),created)).toThrow(/digest_mismatch/);
  expect(()=>validateWSLMutationResponse(JSON.stringify({ok:true,sha256:hash("new")}),created)).toThrow(/creation_unconfirmed/);
  const modified=request("modify_existing","after");
  expect(validateWSLMutationResponse(JSON.stringify({ok:true,sha256:hash("after"),replacedOccurrences:2}),modified).replacedOccurrences).toBe(2);
  expect(()=>validateWSLMutationResponse(JSON.stringify({ok:true,sha256:hash("after"),replacedOccurrences:0}),modified)).toThrow(/modification_unconfirmed/);
  expect(()=>validateWSLMutationResponse("not-json",created)).toThrow(/invalid_write_response/);
  expect(()=>validateWSLMutationResponse(JSON.stringify({ok:false,error:"write_revision_conflict_or_unknown"}),created)).toThrow(/revision_conflict/);
 });
 it("requires authenticated response for restore_created and restore_deleted",()=>{
  expect(validateWSLMutationResponse(JSON.stringify({ok:true,restored:true}),request("restore_created")).restored).toBe(true);
  expect(()=>validateWSLMutationResponse(JSON.stringify({ok:true}),request("restore_created"))).toThrow();
  expect(validateWSLMutationResponse(JSON.stringify({ok:true,restored:true,created:true,sha256:hash("before")}),request("restore_deleted","before")).restored).toBe(true);
 });
});
