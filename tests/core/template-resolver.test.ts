import { describe, expect, it } from "vitest";
import { buildStepContext, resolveTemplates, hasTemplates } from "../../src/core/runtime/template-resolver.js";
import type { TaskStep } from "../../src/core/planner/task-planner.js";

function makeStep(id: number, output: unknown, status = "completed" as const): TaskStep {
  return { id, action: `step ${id}`, status, output };
}

describe("template-resolver", () => {
  describe("buildStepContext", () => {
    it("builds context from completed steps", () => {
      const steps = [
        makeStep(1, { path: "file.txt" }),
        makeStep(2, { backupId: "abc-123" }),
      ];
      const ctx = buildStepContext(steps);
      expect(ctx.get("step1")?.output).toEqual({ path: "file.txt" });
      expect(ctx.get("step2")?.output).toEqual({ backupId: "abc-123" });
    });

    it("includes status and error", () => {
      const steps = [makeStep(1, null, "failed")];
      steps[0].error = "ENOENT";
      const ctx = buildStepContext(steps);
      expect(ctx.get("step1")?.status).toBe("failed");
      expect(ctx.get("step1")?.error).toBe("ENOENT");
    });
  });

  describe("resolveTemplates", () => {
    it("resolves simple output field reference", () => {
      const ctx = buildStepContext([makeStep(1, { path: "test.txt" })]);
      const args = { path: "{{step1.output.path}}" };
      const resolved = resolveTemplates(args, ctx);
      expect(resolved).toEqual({ path: "test.txt" });
    });

    it("resolves nested field reference", () => {
      const ctx = buildStepContext([makeStep(1, { result: { items: [{ id: 42 }] } })]);
      const args = { id: "{{step1.output.result.items[0].id}}" };
      const resolved = resolveTemplates(args, ctx);
      expect(resolved).toEqual({ id: 42 });
    });

    it("resolves entire output reference", () => {
      const ctx = buildStepContext([makeStep(1, "hello world")]);
      const args = { content: "{{step1.output}}" };
      const resolved = resolveTemplates(args, ctx);
      expect(resolved).toEqual({ content: "hello world" });
    });

    it("resolves status reference", () => {
      const ctx = buildStepContext([makeStep(1, null, "completed")]);
      const args = { status: "{{step1.status}}" };
      const resolved = resolveTemplates(args, ctx);
      expect(resolved).toEqual({ status: "completed" });
    });

    it("resolves error reference", () => {
      const steps = [makeStep(1, null, "failed")];
      steps[0].error = "File not found";
      const ctx = buildStepContext(steps);
      const args = { error: "{{step1.error}}" };
      const resolved = resolveTemplates(args, ctx);
      expect(resolved).toEqual({ error: "File not found" });
    });

    it("preserves non-template strings", () => {
      const ctx = buildStepContext([]);
      const args = { path: "literal/path.txt" };
      const resolved = resolveTemplates(args, ctx);
      expect(resolved).toEqual({ path: "literal/path.txt" });
    });

    it("preserves missing references as original string", () => {
      const ctx = buildStepContext([]);
      const args = { path: "{{step99.output.path}}" };
      const resolved = resolveTemplates(args, ctx);
      expect(resolved).toEqual({ path: "{{step99.output.path}}" });
    });

    it("resolves templates in arrays", () => {
      const ctx = buildStepContext([makeStep(1, { file: "test.ts" })]);
      const args = { files: ["{{step1.output.file}}", "other.ts"] };
      const resolved = resolveTemplates(args, ctx);
      expect(resolved).toEqual({ files: ["test.ts", "other.ts"] });
    });

    it("resolves templates in nested objects", () => {
      const ctx = buildStepContext([makeStep(1, { backupId: "bk-123" })]);
      const args = { meta: { backup: "{{step1.output.backupId}}" } };
      const resolved = resolveTemplates(args, ctx);
      expect(resolved).toEqual({ meta: { backup: "bk-123" } });
    });

    it("handles mixed template and literal in string", () => {
      const ctx = buildStepContext([makeStep(1, { path: "file.txt" })]);
      const args = { message: "File is at {{step1.output.path}}" };
      const resolved = resolveTemplates(args, ctx);
      expect(resolved).toEqual({ message: "File is at file.txt" });
    });
  });

  describe("hasTemplates", () => {
    it("detects templates in strings", () => {
      expect(hasTemplates("{{step1.output.path}}")).toBe(true);
    });

    it("detects no templates in plain strings", () => {
      expect(hasTemplates("hello world")).toBe(false);
    });

    it("detects templates in objects", () => {
      expect(hasTemplates({ path: "{{step1.output.path}}" })).toBe(true);
    });

    it("detects templates in arrays", () => {
      expect(hasTemplates(["{{step1.output.path}}"])).toBe(true);
    });

    it("returns false for non-string values", () => {
      expect(hasTemplates(42)).toBe(false);
      expect(hasTemplates(null)).toBe(false);
      expect(hasTemplates(true)).toBe(false);
    });
  });
});
