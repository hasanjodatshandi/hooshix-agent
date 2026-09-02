import { describe, expect, it } from "vitest";
import { listMemoryItems, listProjects, listTasks, saveMemoryItem, saveProject } from "../../src/core/memory/task-repository.js";
import { createTaskPlan } from "../../src/core/planner/task-planner.js";
import { saveTaskPlan } from "../../src/core/memory/task-repository.js";

describe("project and contextual memory repository", () => {
  it("upserts projects and filters durable memory", () => {
    const projectId = saveProject({ name: "One", path: "D:/workspace/project", nextAction: "test" });
    expect(saveProject({ name: "Renamed", path: "D:/workspace/project", lastAction: "built" })).toBe(projectId);

    const plan = createTaskPlan("memory task", [{ action: "inspect", tool: "read_file", arguments: { path: "README.md" } }]);
    saveTaskPlan(plan);
    saveMemoryItem({ projectId, taskId: plan.id, kind: "note", content: { durable: true } });
    saveMemoryItem({ projectId, kind: "project-note", content: "context" });

    expect(listProjects(10)[0]).toMatchObject({ id: projectId, name: "Renamed", last_action: "built" });
    expect(listTasks(10).some((task) => task.id === plan.id)).toBe(true);
    expect(listMemoryItems({ taskId: plan.id, limit: 10 })).toHaveLength(1);
    expect(listMemoryItems({ projectId, limit: 10 })).toHaveLength(2);
  });
});
