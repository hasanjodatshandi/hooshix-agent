import { describe, expect, it } from "vitest";
import { listMemoryItems, listProjects, listTasks, saveMemoryItem, saveProject, updateMemoryItem, getMemoryItem } from "../../src/core/memory/task-repository.js";
import { createTaskPlan } from "../../src/core/planner/task-planner.js";
import { saveTaskPlan } from "../../src/core/memory/task-repository.js";

describe("project and contextual memory repository", () => {
  it("creates and updates projects, then filters durable memory", () => {
    const projectId = saveProject({ name: "One", path: "D:/workspace/project", nextAction: "test" });
    // Same path again should fail — duplicate path is rejected
    expect(() => saveProject({ name: "Renamed", path: "D:/workspace/project", lastAction: "built" })).toThrow();
    // Update by ID works
    expect(saveProject({ id: projectId, name: "Renamed", path: "D:/workspace/project", lastAction: "built" })).toBe(projectId);

    const plan = createTaskPlan("memory task", [{ action: "inspect", tool: "read_file", arguments: { path: "README.md" } }]);
    saveTaskPlan(plan);
    saveMemoryItem({ projectId, taskId: plan.id, kind: "note", content: { durable: true } });
    saveMemoryItem({ projectId, kind: "project-note", content: "context" });

    expect(listProjects(10).items[0]).toMatchObject({ id: projectId, name: "Renamed", last_action: "built" });
    expect(listTasks(10).some((task) => task.id === plan.id)).toBe(true);
    expect(listMemoryItems({ taskId: plan.id, limit: 10 }).items).toHaveLength(1);
    expect(listMemoryItems({ projectId, limit: 10 }).items).toHaveLength(2);
  });

  it("binds a task plan to a project and lists it back scoped", () => {
    const projectId = saveProject({ name: "Scoped", path: "D:/workspace/scoped" });
    const bound = createTaskPlan("bound task", [{ action: "inspect", tool: "read_file", arguments: { path: "README.md" } }]);
    bound.projectId = projectId;
    saveTaskPlan(bound);
    const loose = createTaskPlan("loose task", [{ action: "inspect", tool: "read_file", arguments: { path: "README.md" } }]);
    saveTaskPlan(loose);

    const scopedIds = listTasks(50, projectId).map((row) => row.id);
    expect(scopedIds).toContain(bound.id);
    expect(scopedIds).not.toContain(loose.id);
    // The unfiltered list still shows both, and the bound row exposes project_id.
    const allRows = listTasks(50);
    expect(allRows.some((row) => row.id === bound.id)).toBe(true);
    const boundRow = allRows.find((row) => row.id === bound.id);
    expect(boundRow?.project_id).toBe(projectId);
  });

  it("updates a memory record in place and refuses another owner's row", () => {
    const projectId = saveProject({ name: "Upd", path: "D:/workspace/upd" });
    const id = saveMemoryItem({ projectId, kind: "note", content: "before" });

    const result = updateMemoryItem({ id, content: "after", kind: "progress" });
    expect(result).toEqual({ id, updated: true });
    const got = getMemoryItem(id);
    expect(got?.content).toBe("after");
    expect(got?.kind).toBe("progress");
    expect(got?.updated_at).toBeTruthy();

    // An unknown id reports nothing-changed rather than inserting.
    expect(updateMemoryItem({ id: 999999, content: "nope" })).toEqual({ id: 999999, updated: false });
  });

  it("never lets one principal update another's memory", () => {
    const projectId = saveProject({ name: "Owned", path: "D:/workspace/owned" });
    const id = saveMemoryItem({ projectId, kind: "note", content: "owner data", principalId: "principal-a" });

    // A different principal cannot touch it.
    expect(updateMemoryItem({ id, content: "tampered", principalId: "principal-b" })).toEqual({ id, updated: false });
    expect(getMemoryItem(id, "principal-a")?.content).toBe("owner data");
  });
});
