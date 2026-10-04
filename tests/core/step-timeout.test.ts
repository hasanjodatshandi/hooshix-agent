import { describe, expect, it } from "vitest";
import {
  effectiveStepTimeout,
  DEFAULT_STEP_TIMEOUT_MS,
  COMMAND_TIMEOUT_CAP_MS,
  COMMAND_TIMEOUT_MARGIN_MS,
} from "../../src/core/loop/step-timeout.js";

describe("effectiveStepTimeout", () => {
  it("uses an explicitly declared step timeout as-is", () => {
    expect(effectiveStepTimeout({ timeout: 300, tool: "execute_command", arguments: { timeout: 120000 } })).toBe(300);
    expect(effectiveStepTimeout({ timeout: 0 })).toBe(0);
  });

  it("falls back to the tool's requested timeout (plus margin) when the step declares none", () => {
    expect(effectiveStepTimeout({ tool: "execute_command", arguments: { timeout: 120000 } }))
      .toBe(COMMAND_TIMEOUT_CAP_MS + COMMAND_TIMEOUT_MARGIN_MS);
    expect(effectiveStepTimeout({ tool: "execute_command", arguments: { timeout: 45000 } })).toBe(50000);
  });

  it("defaults to 30s when neither the step nor the tool declares a timeout", () => {
    expect(effectiveStepTimeout({ tool: "execute_command", arguments: {} })).toBe(DEFAULT_STEP_TIMEOUT_MS);
    expect(effectiveStepTimeout({ tool: "execute_command" })).toBe(DEFAULT_STEP_TIMEOUT_MS);
    expect(effectiveStepTimeout({})).toBe(DEFAULT_STEP_TIMEOUT_MS);
  });

  it("ignores non-positive tool timeouts", () => {
    expect(effectiveStepTimeout({ tool: "execute_command", arguments: { timeout: 0 } })).toBe(DEFAULT_STEP_TIMEOUT_MS);
    expect(effectiveStepTimeout({ tool: "execute_command", arguments: { timeout: -5 } })).toBe(DEFAULT_STEP_TIMEOUT_MS);
  });

  it("only derives from execute_command arguments", () => {
    // A non-shell tool has no `timeout` argument contract.
    expect(effectiveStepTimeout({ tool: "read_file", arguments: { timeout: 120000 } })).toBe(DEFAULT_STEP_TIMEOUT_MS);
  });
});
