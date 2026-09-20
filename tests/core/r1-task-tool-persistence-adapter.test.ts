import { describe, expect, it } from "vitest";
import { withAgentDatabase } from "../../src/core/memory/database.js";
import {
  getPersistedTaskLinks, persistAppendedTaskSteps, persistTaskLink,
} from "../../src/adapters/outbound/persistence/sqlite/repositories/task-tool-persistence.adapter.js";

function insertTask(id: string): void {
  const now = new Date().toISOString();
  withAgentDatabase(db => db.prepare(
    "INSERT INTO tasks (id, title, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, id, id, "planning", now, now));
}

describe("R1 Task tool SQL adapter contract", () => {
  it("persists append rows and preserves template inputs, dependencies, order and timeout", () => {
    const id = "r1-append-adapter-task";
    insertTask(id);
    persistAppendedTaskSteps(id, 2, [{
      id: 3, action: "read A", tool: "read_file", arguments: { path: "safe.txt" },
      dependsOn: [2], status: "pending", runWhen: "always", timeout: 1200,
    }, {
      id: 4, action: "read B", tool: "read_file", arguments: { path: "other.txt" },
      dependsOn: [3], status: "pending",
    }]);
    const rows = withAgentDatabase(db => db.prepare(
      "SELECT step_id, step_order, input, dependencies, run_when, step_timeout_ms FROM task_steps WHERE task_id = ? ORDER BY step_order"
    ).all(id)) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ step_id: 3, step_order: 2, input: '{"path":"safe.txt"}', dependencies: "[2]", run_when: "always", step_timeout_ms: 1200 });
    expect(rows[1]).toMatchObject({ step_id: 4, step_order: 3, dependencies: "[3]", run_when: "success", step_timeout_ms: null });
  });

  it("stores and retrieves upstream/downstream Task relationships without changing row shape", () => {
    insertTask("r1-source");
    insertTask("r1-destination");
    persistTaskLink("r1-source", "r1-destination", "follow_up");
    expect(getPersistedTaskLinks("r1-source")).toMatchObject({
      upstream: [],
      downstream: [{ target_task_id: "r1-destination", relation: "follow_up" }],
    });
    expect(getPersistedTaskLinks("r1-destination")).toMatchObject({
      upstream: [{ source_task_id: "r1-source", relation: "follow_up" }],
      downstream: [],
    });
  });
});
