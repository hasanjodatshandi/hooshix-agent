import { describe, expect, it } from "vitest";
import * as workspaceFacade from "../../src/security/workspace-policy-repository.js";
import * as workspaceAdapter from "../../src/adapters/outbound/persistence/sqlite/repositories/workspace-policy-repository.adapter.js";
import * as approvalsFacade from "../../src/core/governance/approval-memory.js";
import * as approvalsAdapter from "../../src/adapters/outbound/persistence/sqlite/repositories/approval-memory.adapter.js";
import * as checkpointsFacade from "../../src/core/memory/checkpoint-memory.js";
import * as checkpointsAdapter from "../../src/adapters/outbound/persistence/sqlite/repositories/checkpoint-memory.adapter.js";
import * as recoveryFacade from "../../src/core/trace/recovery-repository.js";
import * as recoveryAdapter from "../../src/adapters/outbound/persistence/sqlite/repositories/recovery-repository.adapter.js";
import * as resumeFacade from "../../src/core/memory/resume-memory.js";
import * as resumeAdapter from "../../src/adapters/outbound/persistence/sqlite/repositories/resume-memory.adapter.js";
import * as memoryFacade from "../../src/core/memory/sqlite-memory.js";
import * as memoryAdapter from "../../src/adapters/outbound/persistence/sqlite/repositories/sqlite-memory.adapter.js";
import * as connectionFacade from "../../src/core/memory/database/connection.js";
import * as connectionAdapter from "../../src/adapters/outbound/persistence/sqlite/connection.adapter.js";
import * as traceFacade from "../../src/core/memory/execution-trace.js";
import * as traceAdapter from "../../src/adapters/outbound/persistence/sqlite/repositories/execution-trace.adapter.js";
import * as taskRepoFacade from "../../src/core/memory/task-repository.js";
import * as taskRepoAdapter from "../../src/adapters/outbound/persistence/sqlite/repositories/task-repository.adapter.js";
import * as metricFacade from "../../src/core/trace/metrics-service.js";
import * as metricAdapter from "../../src/adapters/outbound/persistence/sqlite/repositories/agent-metrics-query.adapter.js";

/**
 * R1/R6 migration contract: existing imports must resolve to identical
 * implementations, not clones or separate stateful repositories.
 */
describe("SQLite repository legacy compatibility", () => {
  const exportsToCompare = [
    ["shared SQLite connection", connectionFacade, connectionAdapter],
    ["workspace policy", workspaceFacade, workspaceAdapter],
    ["approvals", approvalsFacade, approvalsAdapter],
    ["checkpoints", checkpointsFacade, checkpointsAdapter],
    ["recovery", recoveryFacade, recoveryAdapter],
    ["resume", resumeFacade, resumeAdapter],
    ["execution memory", memoryFacade, memoryAdapter],
    ["execution trace", traceFacade, traceAdapter],
    ["task repository", taskRepoFacade, taskRepoAdapter],
    ["agent metrics query", metricFacade, metricAdapter],
  ] as const;
  for (const [name, legacy, canonical] of exportsToCompare) {
    it(`${name}: original public exports retain referential identity`, () => {
      expect(Object.keys(legacy).sort()).toEqual(Object.keys(canonical).sort());
      for (const key of Object.keys(legacy)) {
        expect((legacy as Record<string, unknown>)[key]).toBe((canonical as Record<string, unknown>)[key]);
      }
    });
  }
});