import { describe, expect, it } from "vitest";
import * as legacy from "../../src/core/state/task-state-machine.js";
import * as domain from "../../src/domain/task/legacy-task-state-machine.js";

describe("R1 Task state-machine migration", () => {
  it("keeps legacy exports as exact domain implementation aliases", () => {
    expect(legacy.canTransition).toBe(domain.canTransition);
    expect(legacy.transitionTask).toBe(domain.transitionTask);
  });

  it("preserves shipped transition behavior while moving implementation inward", () => {
    expect(domain.canTransition("created", "planning")).toBe(true);
    expect(domain.canTransition("completed", "planning")).toBe(true);
    expect(domain.canTransition("created", "completed")).toBe(false);
    expect(domain.transitionTask("verifying", "completed")).toBe("completed");
    expect(() => domain.transitionTask("created", "completed")).toThrow("Invalid transition created -> completed");
  });
});
