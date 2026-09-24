import fs from "node:fs";
import path from "node:path";
import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {FileToolHandler} from "../../src/core/executor/handlers/file-handler.js";
import {createDisposableFixture} from "../helpers/r0-disposable-fixtures.js";
import {SEARCH_LIMITS} from "../../src/services/filesystem/search-budget.js";
import {addWorkspaceRoots,removeWorkspaceRoot,setActiveWorkspace} from "../../src/security/workspace-guard.js";

/**
 * MED-03 — "search budgets proven on one transport only". The R6 aggregate
 * safety test drives `searchWorkspaceFiles` directly, which is the stdio path.
 * This test drives the SAME budget through the task-engine transport: the
 * `search_files` tool as the file handler dispatches it. The budget is enforced
 * in `searchWorkspaceFiles` itself, so it cannot be bypassed by reaching the
 * function through a different caller — but the finding asked for proof on the
 * second transport, and proof is cheap here.
 */

describe("MED-03 search budget is enforced through the task-engine transport",()=>{
  let fixture:ReturnType<typeof createDisposableFixture>;
  let workspace:string;
  const extraRoots=new Set<string>();

  beforeEach(()=>{
    fixture=createDisposableFixture("r6-search-task");
    workspace=fixture.root;
    addWorkspaceRoots([workspace]);
    extraRoots.add(workspace);
    setActiveWorkspace(workspace);
    // Many files each with many matching LINES (not one long line), so the
    // 1000-result aggregate cap fires partway through the walk.
    for(let i=0;i<60;i++){
      fs.writeFileSync(path.join(workspace,`f${i}.txt`),`${Array.from({length:20},()=>`line ${i} needle`).join("\n")}\n`);
    }
  });
  afterEach(()=>{
    setActiveWorkspace(process.cwd());
    for(const root of extraRoots)removeWorkspaceRoot(root);
    extraRoots.clear();
    fixture.cleanup();
  });

  it("the file handler returns at most the result cap and marks the run truncated",async()=>{
    const handler=new FileToolHandler();
    const result=await handler.handle({
      tool:"search_files",
      input:{path:workspace,query:"needle"},
      correlationId:"correlation-med03",
      executionContext:{workspace,roots:[workspace],unrestricted:false},
    }) as {matches:unknown[];truncated:boolean;totalMatches:number};

    expect(result.matches.length).toBeLessThanOrEqual(SEARCH_LIMITS.maxResults);
    expect(result.truncated).toBe(true);
    expect(result.totalMatches).toBeGreaterThanOrEqual(result.matches.length);
  });

  it("a workspace with few matches reports no truncation",async()=>{
    const handler=new FileToolHandler();
    const result=await handler.handle({
      tool:"search_files",
      input:{path:workspace,query:"this-string-appears-nowhere"},
      correlationId:"correlation-med03-sparse",
      executionContext:{workspace,roots:[workspace],unrestricted:false},
    }) as {matches:unknown[];truncated:boolean};

    expect(result.matches).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});
