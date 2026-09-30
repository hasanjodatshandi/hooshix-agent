import { describe, expect, it } from "vitest";
import * as facade from "../../src/core/state/task-state-machine.js";
import * as domain from "../../src/domain/task/task-state-machine.js";

describe("Task state-machine convergence", () => {
  it("keeps the facade as an exact alias of the canonical domain machine", () => {
    expect(facade.canTransition).toBe(domain.canTransition);
    expect(facade.transitionTask).toBe(domain.transitionTask);
  });

  it("preserves shipped transition behavior on the canonical aggregate", () => {
    expect(domain.canTransition("planning", "executing")).toBe(true);
    expect(domain.canTransition("completed", "planning")).toBe(true);
    expect(domain.canTransition("planning", "completed")).toBe(false);
    expect(domain.transitionTask("verifying", "completed")).toBe("completed");
    expect(() => domain.transitionTask("planning", "completed")).toThrow("Invalid transition planning -> completed");
  });
});
