import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createHandlerDispatcher } from "../../src/core/executor/handlers/index.js";
import type { ToolHandler } from "../../src/core/executor/handlers/tool-handler.js";

describe("R1 legacy handler composition boundary", () => {
  it("dispatches through injected fake handlers without constructing a concrete service", async () => {
    let handled = 0;
    const handler: ToolHandler = {
      canHandle: name => name === "read_file",
      async handle({ input }) { handled++; return { echo: input.path }; },
    };
    const dispatch = createHandlerDispatcher([handler]);
    expect(await dispatch("read_file", { path: "fixture" }, "fixture-correlation"))
      .toEqual({ echo: "fixture" });
    expect(handled).toBe(1);
    expect(() => dispatch("git_status", {}, "fixture-correlation"))
      .toThrow(/No handler/);
  });

  it("constructs legacy concrete handlers only in the explicit composition module", () => {
    const index = fs.readFileSync(path.resolve("src/core/executor/handlers/index.ts"), "utf8");
    const composition = fs.readFileSync(
      path.resolve("src/infrastructure/composition/legacy-tool-handler-composition.ts"), "utf8"
    );
    expect(index).not.toMatch(/\bnew\s+\w+ToolHandler\s*\(/);
    for (const name of [
      "SystemToolHandler", "FileToolHandler", "GitToolHandler",
      "PackageToolHandler", "ShellToolHandler", "TaskSnapshotToolHandler",
    ]) expect(composition).toContain(`new ${name}()`);
  });
});
