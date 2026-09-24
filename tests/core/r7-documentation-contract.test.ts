import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_REGISTERED_TOOLS } from "../../src/application/services/operation-catalog.js";

/**
 * R7.10 — documentation/tool-catalog contract. The README is the public tool
 * reference; it must never advertise a tool the gateway does not actually
 * register, because a stale entry would mislead an integrator into calling a
 * non-existent operation.
 *
 * R9.04 — completeness: the reverse direction is now ALSO enforced. A README
 * that silently omits newly registered tools hides them from integrators, and
 * that is how the original five-tool gap (project_get/delete/archive,
 * memory_get/delete) went unnoticed. The catalog is the single source of truth:
 * these tests read the SAME ALL_REGISTERED_TOOLS the MCP `tools/list` response
 * is generated from, so the README is checked against the runtime reality
 * rather than a hand-copied list.
 */
describe("R7.10 README tool catalog contract", () => {
  it("every tool named in README is really registered (no stale documentation)", () => {
    const readme = fs.readFileSync("README.md", "utf8");
    const registered = new Set(ALL_REGISTERED_TOOLS as readonly string[]);
    const mentioned: string[] = [];
    for (const match of readme.matchAll(/`([a-z_]+)`/g)) {
      const name = match[1];
      // Only identifiers that look like tool calls are in scope; skip words that
      // merely coincide with a tool name (e.g. a config variable or prose term).
      if ((ALL_REGISTERED_TOOLS as readonly string[]).includes(name)) mentioned.push(name);
    }
    expect(mentioned.length, "README must reference at least the core tool set").toBeGreaterThan(0);
    const stale = [...new Set(mentioned)].filter((name) => !registered.has(name));
    expect(stale).toEqual([]);
  });

  it("R9.04 every registered tool is documented in the README (no silent omissions)", () => {
    const readme = fs.readFileSync("README.md", "utf8");
    const mentioned = new Set([...readme.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]));
    const unlisted = (ALL_REGISTERED_TOOLS as readonly string[]).filter((t) => !mentioned.has(t));
    // The README tool list is the public contract. A tool that ships but is not
    // listed is invisible to an integrator reading the docs; the five-tool gap
    // fixed in R9.04 is exactly how this regresses.
    expect(unlisted, `README omits registered tools: ${unlisted.join(", ")}`).toEqual([]);
  });

  it("README command allowlist matches the executable allowlist in code", () => {
    const readme = fs.readFileSync("README.md", "utf8");
    const policy = fs.readFileSync("src/application/services/legacy-command-policy.ts", "utf8");
    const schema = fs.readFileSync("src/tools/shell/execute-command.ts", "utf8");
    // The README documents the executable allowlist as a backtick-quoted list.
    const readmeAllowlist = readme.match(/\*\*فرمان‌های مجاز `execute_command`:\*\*\s*(.*?)\./);
    expect(readmeAllowlist).not.toBeNull();
    const documented = (readmeAllowlist?.[1] ?? "")
      .split(",")
      .map((s) => replaceBackticksAndTrim(s))
      .filter(Boolean);
    expect(documented.length).toBeGreaterThan(0);
    // Every documented executable must appear in BOTH code allowlists (the
    // policy set and the zod schema), which must themselves agree.
    for (const exe of documented) {
      expect(policy, `documented executable "${exe}" must exist in the policy allowlist`).toContain(`"${exe}"`);
      expect(schema, `documented executable "${exe}" must exist in the zod schema`).toContain(`"${exe}"`);
    }
  });

  it("R9.06 docs/TOOLS.md matches the catalog in both directions", () => {
    // docs/TOOLS.md is the generated tool reference. It must list every
    // registered tool and name none the gateway does not register.
    const toolsDoc = fs.readFileSync("docs/TOOLS.md", "utf8");
    const mentioned = new Set([...toolsDoc.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]));
    const registered = new Set(ALL_REGISTERED_TOOLS as readonly string[]);

    const stale = [...mentioned].filter((name) => !registered.has(name));
    expect(stale, `TOOLS.md names tools that are not registered: ${stale.join(", ")}`).toEqual([]);

    const unlisted = (ALL_REGISTERED_TOOLS as readonly string[]).filter((t) => !mentioned.has(t));
    expect(unlisted, `TOOLS.md omits registered tools: ${unlisted.join(", ")}`).toEqual([]);
  });
});

function replaceBackticksAndTrim(value: string): string {
  return value.replace(/[`*]/g, "").trim();
}
