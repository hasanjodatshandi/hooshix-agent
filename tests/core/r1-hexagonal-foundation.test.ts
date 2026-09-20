import { describe, expect, it } from "vitest";
import { assertAppendAllowed, assertTaskInvariants, type Task, type TaskStep } from "../../src/domain/task/task.js";
import { compareIdempotency } from "../../src/domain/task/idempotency.js";
import { requireNonblankId, requireStepId, type CorrelationId, type IdempotencyKey, type PrincipalId, type SessionId, type TaskId, type ToolId } from "../../src/domain/shared/ids.js";
import { captureWorkspaceScope } from "../../src/domain/workspace/workspace-scope.js";
import { createR1DeterministicIds, createR1FakeComposition } from "../../src/infrastructure/composition/r1-application-composition.js";

const principalId="r1-principal" as PrincipalId, sessionId="r1-session" as SessionId, toolId="read_fixture" as ToolId;
function baseTask(steps: readonly TaskStep[]): Task {
 return { id:"r1-task" as TaskId, correlationId:"r1-correlation" as CorrelationId, title:"R1 plan",state:"planning",
 steps, executionScope:captureWorkspaceScope({principalId,sessionId,root:"/fixture",allowedRoots:["/fixture"],unrestricted:false,capturedAt:"2026-01-01T00:00:00Z"}),
 retryPolicy:{maxAttempts:1},totalRunCount:0,createdAt:"2026-01-01T00:00:00Z",updatedAt:"2026-01-01T00:00:00Z"};
}
const step=(id:number,dependencies:number[]=[]):TaskStep=>({ id:requireStepId(id),action:"read",toolId,arguments:{path:"a"},dependencies:dependencies.map(requireStepId),runWhen:"success",timeoutMs:1000,state:"pending",attempts:0,failedAttempts:0,attemptHistory:[] });
function composition(effect:"read_only"|"non_idempotent_mutation"="read_only") {
 const setup=createR1FakeComposition({
 descriptor:{id:toolId,requiredPermission:"READ",risk:"low",approval:"never",effect,workspaceScope:"read",supportsIdempotency:false,capabilities:[]},
 output:{message:"fake only"},clock:{now:()=>"2026-01-01T00:00:00Z"},ids:createR1DeterministicIds(),
 });
 return setup;
}
describe("R1 domain pure policies and fake application composition",()=>{
 it("validates branded identifiers and rejects malformed values",()=>{
  expect(requireNonblankId("task-1","TaskId")).toBe("task-1");
  expect(()=>requireNonblankId(" task-1","TaskId")).toThrow();
  expect(()=>requireStepId(0)).toThrow();
 });
 it("rejects unknown and cyclic dependencies without requiring any filesystem adapter",()=>{
  expect(()=>assertTaskInvariants(baseTask([step(1,[2])]))).toThrow("Unknown step dependency");
  expect(()=>assertTaskInvariants(baseTask([step(1,[2]),step(2,[1])]))).toThrow("Cyclic task plan");
  expect(()=>assertTaskInvariants(baseTask([step(1),step(1)]))).toThrow("Duplicate");
  expect(()=>assertTaskInvariants(baseTask([step(1),step(2,[1])]))).not.toThrow();
 });
 it("blocks terminal append and mutation after unresolved outcome",()=>{
  expect(()=>assertAppendAllowed({...baseTask([step(1)]),state:"completed"})).toThrow("terminal");
  expect(()=>assertAppendAllowed(baseTask([{...step(1),state:"outcome_unknown"}]))).toThrow("Reconcile");
 });
 it("enforces idempotency equality rather than key-only equality",()=>{
  expect(compareIdempotency({key:"k" as IdempotencyKey,taskId:"t" as TaskId,canonicalRequestHash:"hash1"},"hash1")).toBe("same");
  expect(compareIdempotency({key:"k" as IdempotencyKey,taskId:"t" as TaskId,canonicalRequestHash:"hash1"},"hash2")).toBe("conflict");
 });
 it("copies principal/session workspace into new Task and does not follow subsequent direct context change",async()=>{
  const c=composition();
  const s={principalId,sessionId,root:"/fixture-a",allowedRoots:["/fixture-a"],unrestricted:false,capturedAt:"2026-01-01T00:00:00Z"};
  await c.workspace.set(sessionId,principalId,s);
  const task=await c.createTask.execute({principalId,sessionId,title:"isolated",steps:[step(1)]});
  expect(task.executionScope.root).toBe("/fixture-a");
  await c.workspace.set(sessionId,principalId,{...s,root:"/fixture-b",allowedRoots:["/fixture-b"]});
  expect((await c.getTask.execute(task.id))?.executionScope.root).toBe("/fixture-a");
  expect((await c.getWorkspace.execute(sessionId,principalId))?.root).toBe("/fixture-b");
  await expect(c.workspace.get(sessionId,"other-principal" as PrincipalId)).resolves.toBeNull();
 });
 it("rejects mismatched workspace actor identity and impossible plans",async()=>{
  const c=composition();
  const s={principalId,sessionId,root:"/fixture-a",allowedRoots:["/fixture-a"],unrestricted:false,capturedAt:"2026-01-01T00:00:00Z"};
  await expect(c.workspace.set(sessionId,"other-principal" as PrincipalId,s)).rejects.toThrow("workspace_identity_mismatch");
  await c.workspace.set(sessionId,principalId,s);
  await expect(c.createTask.execute({principalId,sessionId,title:"bad",steps:[step(1,[3])]})).rejects.toThrow("Unknown");
 });
 it("never dispatches unknown tools, malformed input, mutations or unauthorized principals",async()=>{
  const c=composition();
  const scope=baseTask([step(1)]).executionScope;
  const taskContext=(workspaceScope:typeof scope)=>({taskId:"r1-task" as TaskId,stepId:requireStepId(1),workspaceScope});
  const principal={id:principalId,permission:"READ" as const,scopes:[]};
  expect((await c.executeTool.execute({principal,descriptorId:"missing" as ToolId,arguments:{},taskContext:taskContext(scope)})).kind).toBe("blocked");
  expect((await c.executeTool.execute({principal,descriptorId:toolId,arguments:"bad",taskContext:taskContext(scope)})).kind).toBe("blocked");
  expect((await c.executeTool.execute({principal:{...principal,id:"other" as PrincipalId},descriptorId:toolId,arguments:{},taskContext:taskContext(scope)})).kind).toBe("blocked");
  const ungranted={...scope,root:"/outside"};
  expect((await c.executeTool.execute({principal,descriptorId:toolId,arguments:{},taskContext:taskContext(ungranted)})).kind).toBe("blocked");
  expect(c.tools.calls).toHaveLength(0);
  const mutating=composition("non_idempotent_mutation");
  expect((await mutating.executeTool.execute({principal,descriptorId:toolId,arguments:{},taskContext:taskContext(scope)})).kind).toBe("approval_required");
  expect(mutating.tools.calls).toHaveLength(0);
 });
 it("dispatches a permitted read through fake ports without MCP, SQLite, Node FS, or process",async()=>{
  const c=composition();
  const r=await c.executeTool.execute({principal:{id:principalId,permission:"READ",scopes:[]},descriptorId:toolId,arguments:{path:"fixture"},taskContext:{taskId:"r1-task" as TaskId,stepId:requireStepId(1),workspaceScope:baseTask([step(1)]).executionScope}});
  expect(r).toMatchObject({kind:"succeeded",output:{message:"fake only"}});
  expect(c.tools.calls).toHaveLength(1);
 });
});