import { describe, expect, it } from "vitest";
import { registerTools } from "../../src/mcp/registry.js";
import {
  ALL_REGISTERED_TOOLS, TOOL_NAMES, OPERATION_CATALOG, TOOL_CAPABILITIES, TOOL_CATEGORY_MAP,
  getOperationDescriptor, operationDescriptorPort,
} from "../../src/application/services/operation-catalog.js";
import {
  ALL_REGISTERED_TOOLS as LEGACY_TOOLS,
  TOOL_CAPABILITIES as LEGACY_CAPABILITIES,
  validateToolName,
} from "../../src/application/services/legacy-tool-orchestrator.js";
import { assertLegacyToolPermission } from "../../src/application/services/legacy-permission-policy.js";
import type { ToolId } from "../../src/domain/shared/ids.js";

describe("R2.01 canonical exhaustive operation catalog", () => {
  it("matches every actual MCP registration, including control-plane, with no duplicate or missing descriptor", () => {
    const registered: string[] = [];
    registerTools({ registerTool(name: string) { registered.push(name); } } as never);
    expect(registered).toHaveLength(55);
    expect(new Set(registered).size).toBe(registered.length);
    expect(new Set(ALL_REGISTERED_TOOLS).size).toBe(ALL_REGISTERED_TOOLS.length);
    expect(registered.slice().sort()).toEqual([...ALL_REGISTERED_TOOLS].sort());
    expect(Object.keys(OPERATION_CATALOG).sort()).toEqual(registered.slice().sort());
    for (const id of registered) {
      const descriptor = getOperationDescriptor(id);
      expect(descriptor, id).not.toBeNull();
      expect(descriptor?.id).toBe(id);
      expect(descriptor?.securityClass).toBeTruthy();
      expect(descriptor?.capabilities).toBeDefined();
      expect(descriptor?.category).toBe(TOOL_CATEGORY_MAP[id as keyof typeof TOOL_CATEGORY_MAP]);
    }
  });

  it("denies unknown and prototype-looking operations instead of inheriting properties", () => {
    for (const id of ["missing", "toString", "__proto__", "constructor", "package_manage"]) {
      expect(getOperationDescriptor(id)).toBeNull();
      expect(operationDescriptorPort.get(id as ToolId)).toBeNull();
      expect(() => validateToolName(id)).toThrow("Unknown tool");
    }
  });

  it("keeps old dispatcher-facing metadata as projections of the same catalog", () => {
    expect(LEGACY_TOOLS).toBe(ALL_REGISTERED_TOOLS);
    expect(LEGACY_CAPABILITIES).toBe(TOOL_CAPABILITIES);
    for (const id of TOOL_NAMES) {
      const d = OPERATION_CATALOG[id];
      expect(TOOL_CAPABILITIES[id].risk).toBe(d.risk);
      expect(TOOL_CAPABILITIES[id].capabilities).toBe(d.capabilities);
      expect(TOOL_CAPABILITIES[id].requiredArguments).toBe(d.requiredArguments);
    }
    expect(getOperationDescriptor("task_reconcile")?.securityClass).toBe("task_control");
    expect(getOperationDescriptor("add_workspace_roots")?.workspaceScope).toBe("scope_mutation");
    expect(getOperationDescriptor("read_file")?.requiredPermission).toBe("READ");
    expect(getOperationDescriptor("write_file")?.requiredPermission).toBe("PROJECT_ACCESS");
    expect(getOperationDescriptor("execute_command")?.requiredPermission).toBe("DEVELOPER");
  });

  it("keeps the four-level permission ceiling and fails closed on unknown names", () => {
    expect(() => assertLegacyToolPermission("write_file", "READ_ONLY")).toThrow();
    expect(assertLegacyToolPermission("write_file", "PROJECT_ACCESS")).toBe(true);
    expect(() => assertLegacyToolPermission("execute_command", "PROJECT_ACCESS")).toThrow();
    expect(assertLegacyToolPermission("execute_command", "DEVELOPER_MODE")).toBe(true);
    expect(assertLegacyToolPermission("package_manage", "DEVELOPER_MODE")).toBe(true);
    expect(() => assertLegacyToolPermission("unknown", "DEVELOPER_MODE")).toThrow();
    expect(() => assertLegacyToolPermission("__proto__", "DEVELOPER_MODE")).toThrow();
  });

  it("marks mutation approvals without pretending the R2 gateway is already deployed", () => {
    expect(getOperationDescriptor("delete_file")).toMatchObject({approval:"always",effect:"non_idempotent_mutation"});
    expect(getOperationDescriptor("git_commit")).toMatchObject({approval:"always",requiredPermission:"DEVELOPER"});
    expect(getOperationDescriptor("get_workspace")).toMatchObject({approval:"never",effect:"read_only"});
  });
});
