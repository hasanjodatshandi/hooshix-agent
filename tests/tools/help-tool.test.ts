import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { USAGE_GUIDE } from "../../src/tools/system/help.js";
import { ALL_REGISTERED_TOOLS } from "../../src/application/services/operation-catalog.js";
import { PACKAGE_MANAGERS } from "../../src/application/services/package-managers.js";
import { supportedManagersFor } from "../../src/services/package/package-service.js";
import { connectInProcessMcp } from "../helpers/in-process-mcp.js";

/**
 * The `help` tool is the only place where an assistant is told the ORDER things
 * must happen in, so its text is a contract like the README's: a guide that
 * still describes a retired flow sends every client on this connector down a
 * dead end. These tests hold it against the live operation catalog.
 */
let client: Client;
let close: () => Promise<void>;

beforeAll(async () => {
  const harness = await connectInProcessMcp();
  client = harness.client;
  close = harness.close;
});

afterAll(async () => {
  await close();
});

function textBlock(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  const block = (content as Array<{ type: string; text?: string }> | undefined)?.find((item) => item.type === "text");
  return block?.text ?? "";
}

/** Every backticked lowercase identifier in the guide — tools and otherwise. */
function backtickedIdentifiers(text: string): string[] {
  return [...text.matchAll(/`([a-z_]+)`/g)].map((match) => match[1]);
}

describe("help tool — the operating manual", () => {
  it("answers a direct call with the Markdown guide and no side effects", async () => {
    const result = await client.callTool({ name: "help", arguments: {} });
    expect(result.isError).toBeFalsy();
    const text = textBlock(result);
    expect(text.startsWith("# HooshiX MCP")).toBe(true);
    expect(text).toBe(USAGE_GUIDE);
    // Markdown, not a JSON blob: an escaped newline document is unreadable.
    expect(text).toContain("\n## ");
  });

  it("maps every registered operation and names nothing that is not registered", () => {
    const map = USAGE_GUIDE.split("## Full tool map")[1];
    expect(map, "the guide must end with the full tool map").toBeTruthy();
    const documented = [...map.matchAll(/^- `([a-z_]+)` — /gm)].map((match) => match[1]);
    expect(documented.length).toBe(ALL_REGISTERED_TOOLS.length);
    expect(documented.sort()).toEqual([...ALL_REGISTERED_TOOLS].sort());
    // A name in the map twice would pass a set comparison and still confuse a reader.
    expect(new Set(documented).size).toBe(documented.length);
  });

  it("never cites a tool-shaped name that the gateway does not register", () => {
    const registered = new Set(ALL_REGISTERED_TOOLS as readonly string[]);
    // Not operations: a task status and the denial reasons quoted in sections 1,
    // 2 and 7 — each is a literal from the runtime (approval flow, project-handles
    // gate in registry.ts, authorization-service.ts).
    const runtimeVocabulary = new Set([
      "pending_approval",
      "project_required",
      "project_handle_expired",
      "project_handle_unknown",
      "workspace_missing_or_ungranted",
      "principal_scope_insufficient",
    ]);
    const unknown = [...new Set(backtickedIdentifiers(USAGE_GUIDE))]
      .filter((name) => name.includes("_"))
      .filter((name) => !registered.has(name) && !runtimeVocabulary.has(name));
    expect(unknown, `guide cites unknown operations: ${unknown.join(", ")}`).toEqual([]);
  });

  it("teaches the current architecture, in the order the server enforces it", () => {
    // Grant before touch, handle before call, approval before effect: the guide
    // must present the rules in the order a client actually hits them, because
    // that sequence is what a fresh connector fails to guess.
    const grant = USAGE_GUIDE.indexOf("## 1. Workspace first, then access");
    const handle = USAGE_GUIDE.indexOf("## 2. One connector, many conversations");
    const shell = USAGE_GUIDE.indexOf("## 3. Two doors to the shell");
    const approver = USAGE_GUIDE.indexOf("## 6. The human is the approver");
    expect(grant).toBeGreaterThan(-1);
    expect(handle).toBeGreaterThan(grant);
    expect(shell).toBeGreaterThan(handle);
    expect(approver).toBeGreaterThan(shell);
    for (const fact of [
      "project=<handle>",
      "HOOSHIX_EXEC_ENABLED=1",
      "execute_command",
      "chat_isolation_probe",
      "duplicateOf",
      "memory_update",
      "task_step_risks",
      "task_reconcile",
      "task_append_steps",
      "restore_file",
    ]) {
      expect(USAGE_GUIDE, `guide must cover ${fact}`).toContain(fact);
    }
  });

  it("quotes package-manager support from the service that runs it", () => {
    // The schema enum accepts 22 names and no action implements all of them, so
    // any hand-copied manager list in the guide is the drift this test forbids.
    for (const action of ["install", "remove", "update"] as const) {
      const supported = supportedManagersFor(action);
      const missing = PACKAGE_MANAGERS.filter((manager) => !supported.includes(manager));
      const expected = `${action}: ${supported.length} of ${PACKAGE_MANAGERS.length}${missing.length > 0 ? ` (not ${missing.join(", ")})` : ""}`;
      expect(USAGE_GUIDE, `guide must state ${action} support`).toContain(expected);
    }
  });

  it("names the approval round-trip as the human's decision, not the assistant's", () => {
    expect(USAGE_GUIDE).toMatch(/task_approve[^\n]*human/i);
    expect(USAGE_GUIDE).toContain("The human is the approver, not you");
  });
});
