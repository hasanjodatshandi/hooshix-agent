import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateWSLFileResponse } from "../src/security/wsl-workspace-client.js";
import type { WSLWorkspaceBinding } from "../src/security/wsl-workspace-binding.js";

const binding: WSLWorkspaceBinding = {
  uri: "wsl://Ubuntu/home/coder/workspace/Hooshix",
  distro: "Ubuntu",
  linuxRoot: "/home/coder/workspace/Hooshix",
  label: "Hooshix",
  ownerWindowsRoot: "D:\\workspace\\hooshix-agent",
};
const check = (value: unknown, operation: "probe" | "read" | "list" | "search", hash = false) =>
  validateWSLFileResponse(JSON.stringify(value), binding, operation, hash);

describe("WSLFS worker response contract", () => {
  it("requires an attested Linux root on a successful probe", () => {
    expect(check({ ok: true, distro: "Ubuntu", linuxRoot: binding.linuxRoot }, "probe").ok).toBe(true);
    // The Go broker emits null for unused collections in successful probes.
    expect(check({ ok: true, distro: "Ubuntu", linuxRoot: binding.linuxRoot,
      entries: null, detailedEntries: null, matches: null }, "probe").ok).toBe(true);
    expect(() => check({ ok: true, distro: "Other", linuxRoot: binding.linuxRoot }, "probe"))
      .toThrow(/enrolled_root_mismatch/);
  });
  it("rejects a missing or incorrect read digest and accepts an empty UTF-8 file", () => {
    const sha = createHash("sha256").update("").digest("hex");
    expect(check({ ok: true, content: "", sha256: sha }, "read", true).content).toBe("");
    expect(() => check({ ok: true, content: "" }, "read", true)).toThrow(/sha256_mismatch/);
    expect(() => check({ ok: true, content: "updated", sha256: sha }, "read", true))
      .toThrow(/sha256_mismatch/);
    expect(() => check({ ok: true }, "read")).toThrow(/missing_content/);
  });
  it("requires complete directory metadata, including empty directories", () => {
    expect(check({ok:true, entries:[], detailedEntries:[]}, "list").ok).toBe(true);
    expect(() => check({ok:true}, "list")).toThrow(/missing_directory_entries/);
    expect(() => check({ok:true, entries:["x"], detailedEntries:[]}, "list"))
      .toThrow(/missing_directory_entries/);
  });
  it("accepts valid zero-match searches when truncated is omitted by Go's omitempty", () => {
    expect(check({ok:true, matches:[]}, "search").ok).toBe(true);
    expect(check({ok:true, matches:[], truncated:true}, "search").truncated).toBe(true);
  });
  it("rejects tampered, oversized, or escaping search results", () => {
    for (const matches of [
      [{path:"../secret", line:1, text:"x"}],
      [{path:"/etc/passwd", line:1, text:"x"}],
      [{path:"src/main.ts", line:0, text:"x"}],
      [{path:"src/main.ts", line:1.5, text:"x"}],
      [{path:"src/main.ts", line:1, text:"x".repeat(2049)}],
    ]) expect(() => check({ok:true,matches}, "search")).toThrow(/invalid_search_results/);
    expect(() => check({ok:true}, "search")).toThrow(/missing_search_results/);
    expect(() => check({ok:true,matches:null}, "search")).toThrow(/missing_search_results/);
  });
});
