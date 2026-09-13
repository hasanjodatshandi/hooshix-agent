import { describe, expect, it } from "vitest";
import { runClosedAgentLoop } from "../../src/core/loop/closed-agent-loop.js";
import { restoreInterruptedTasks } from "../../src/core/recovery/startup-recovery.js";
import { createRuntimeDependencies } from "../../src/core/runtime/composition-root.js";
import { PersistentRecoveryRepository } from "../../src/core/trace/recovery-repository.js";

describe("advanced recovery", () => {
  it("bounds repeated transient recoveries", async () => {
    let attempts = 0;
    const provider = {
      analyzeFailure: () => ({ reason: "network timeout", source: "execution" }),
      decideRecovery: () => ({ type: "retry" as const, reason: "transient failure" }),
      executeRecovery: () => true,
      recordLifecycle: () => {}
    };
    const result = await runClosedAgentLoop({
      id: "multi-failure", task: "retry", steps: [{ id: 1, action: "read", tool: "read_file", arguments: { path: "README.md" }, status: "pending" }]
    }, async () => { attempts++; throw new Error("network timeout"); }, 2, 0, undefined, provider);
    expect(result.status).toBe("failed");
    expect(attempts).toBe(3);
  });

  it("closes a recovery lifecycle interrupted by a process crash", () => {
    const repository = new PersistentRecoveryRepository();
    repository.save({ recoveryId: "crashed-recovery", correlationId: "crashed-correlation", action: "retry", reason: "timeout", retryCount: 1, startedAt: new Date().toISOString(), status: "started" });
    restoreInterruptedTasks(createRuntimeDependencies().recoveryProvider, repository);
    expect(repository.findByCorrelationId("crashed-correlation").at(-1)?.status).toBe("failed");
  });
});
