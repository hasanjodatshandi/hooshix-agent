import { describe, expect, it } from "vitest";
import { auditToolCall } from "../../src/core/memory/tool-audit.js";
import { getRecordedToolNames } from "../../src/adapters/outbound/persistence/sqlite/repositories/dashboard-tool-names.adapter.js";

describe("R1 HTTP dashboard SQLite read-model adapter", () => {
  it("returns distinct, ordered recorded tool names without SQL in HTTP transport", async () => {
    expect(getRecordedToolNames()).toEqual([]);
    await auditToolCall("write_file", "r1-dashboard-names", undefined, () => "ok");
    await auditToolCall("read_file", "r1-dashboard-names", undefined, () => "ok");
    await auditToolCall("read_file", "r1-dashboard-names", undefined, () => "ok");
    expect(getRecordedToolNames()).toEqual(["read_file", "write_file"]);
  });
});
