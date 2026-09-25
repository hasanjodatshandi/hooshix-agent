import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {resetAgentDatabase} from "../../src/core/memory/database/index.js";
import {saveTaskPlan} from "../../src/core/memory/task-repository.js";
import {auditToolCall} from "../../src/core/memory/tool-audit.js";
import {getAgentMetrics} from "../../src/core/trace/metrics-service.js";
import type {TaskPlan} from "../../src/application/dto/legacy-task-plan.js";

/**
 * AUDIT-M-metrics — agent_metrics previously aggregated every client's tool
 * calls and step executions. One authenticated client could read another's
 * traffic volumes and failure rates. Counters are now filtered by the caller's
 * principal via the task-ownership column.
 */
describe("agent metrics are scoped by principal",()=>{
  const ALICE="11111111-1111-1111-1111-111111111111";
  const BOB="22222222-2222-2222-2222-222222222222";

  beforeEach(()=>{resetAgentDatabase();});
  afterEach(()=>{resetAgentDatabase();});

  function plan(id:string,principalId:string):TaskPlan{
    return {
      id,task:"task "+id,
      steps:[{id:1,action:"act",arguments:{},dependsOn:[],status:"pending"}],
      executionContext:{principalId,origin:"http_oauth",
        workspace:null,roots:[],unrestricted:false},
    };
  }

  it("returns only the caller's counts and call list",async()=>{
    saveTaskPlan(plan("task-alice",ALICE));
    saveTaskPlan(plan("task-bob",BOB));
    await auditToolCall("read_file","corr-a","task-alice",async()=>{await Promise.resolve();});
    await auditToolCall("delete_file","corr-b","task-bob",
      async()=>{throw new Error("boom");}).catch(()=>{});

    const alice=getAgentMetrics({principalId:ALICE});
    const bob=getAgentMetrics({principalId:BOB});

    expect(alice.workflowTotalActions).toBe(1);
    expect(alice.workflowFailedActions).toBe(0);
    expect(alice.recentCalls.length).toBe(1);
    expect(alice.recentCalls[0].tool).toBe("read_file");
    expect(bob.workflowTotalActions).toBe(1);
    expect(bob.workflowFailedActions).toBe(1);
    expect(bob.recentCalls.length).toBe(1);
    expect(bob.recentCalls[0].tool).toBe("delete_file");
  });

  it("sees nothing when the other principal owns everything",async()=>{
    saveTaskPlan(plan("task-bob",BOB));
    await auditToolCall("read_file","corr-b","task-bob",async()=>{await Promise.resolve();});

    const alice=getAgentMetrics({principalId:ALICE});
    expect(alice.workflowTotalActions).toBe(0);
    expect(alice.pagination.total).toBe(0);
    expect(alice.recentCalls).toEqual([]);
  });
});
