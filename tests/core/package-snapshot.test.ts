import { describe, expect, it, vi } from "vitest";

const { execaMock } = vi.hoisted(() => ({ execaMock: vi.fn() }));
vi.mock("execa", () => ({ execa: execaMock }));

import { managePackage } from "../../src/services/package/package-service.js";
import { withAgentDatabase } from "../../src/core/memory/database.js";
import { runWithPolicyApproval } from "../../src/core/governance/policy-decision-point.js";

function approvedManage(input: Parameters<typeof managePackage>[0]) {
  const tool = `${input.action === "install" ? "install" : input.action === "remove" ? "remove" : "update"}_package`;
  return runWithPolicyApproval(tool, () => managePackage(input));
}

describe("package snapshot lifecycle", () => {
  it("records committed snapshot on successful install", async () => {
    execaMock
      .mockResolvedValueOnce({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '{"dependencies":{"zod":{"version":"4.5.4"}}}', stderr: "", timedOut: false });

    const result = await approvedManage({ manager: "npm", action: "install", name: "zod", correlationId: "snap-commit" });
    expect(result.snapshotId).toBeDefined();

    const snapshot = withAgentDatabase((db) => db.prepare("SELECT * FROM package_snapshots WHERE id = ?").get(result.snapshotId) as any);
    expect(snapshot.status).toBe("committed");
    expect(snapshot.manager).toBe("npm");
    expect(snapshot.action).toBe("install");
    expect(snapshot.package_name).toBe("zod");
  });

  it("records rolled_back snapshot on verification failure", async () => {
    execaMock
      .mockResolvedValueOnce({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false })
      .mockResolvedValueOnce({ exitCode: 1, stdout: "{}", stderr: "missing", timedOut: false });

    await expect(approvedManage({ manager: "npm", action: "install", name: "zod", correlationId: "snap-rollback" })).rejects.toThrow();

    const snapshots = withAgentDatabase((db) => db.prepare("SELECT * FROM package_snapshots WHERE correlation_id = ?").all("snap-rollback") as any[]);
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].status).toBe("rolled_back");
    expect(snapshots[0].restored_at).toBeDefined();
  });
});
