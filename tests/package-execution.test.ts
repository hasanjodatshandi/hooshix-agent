import { afterEach, describe, expect, it, vi } from "vitest";

const { execaMock } = vi.hoisted(() => ({ execaMock: vi.fn() }));
vi.mock("execa", () => ({ execa: execaMock }));

import { managePackage } from "../src/services/package/package-service.js";

afterEach(() => execaMock.mockReset());

describe("package execution and verification", () => {
  it("returns success only after the package is verified", async () => {
    execaMock
      .mockResolvedValueOnce({ exitCode: 0, stdout: "installed", stderr: "", timedOut: false })
      .mockResolvedValueOnce({ exitCode: 0, stdout: '{"dependencies":{"zod":{"version":"4.5.4"}}}', stderr: "", timedOut: false });

    const result = await managePackage({ manager: "npm", action: "install", name: "zod", correlationId: "package-verified" });
    expect(result.verified).toBe(true);
    expect(execaMock).toHaveBeenCalledTimes(2);
    expect(execaMock.mock.calls.every((call) => call[2].shell === false)).toBe(true);
  });

  it("verifies removal when the package is absent", async () => {
    execaMock
      .mockResolvedValueOnce({ exitCode: 0, stdout: "removed", stderr: "", timedOut: false })
      .mockResolvedValueOnce({ exitCode: 1, stdout: "{}", stderr: "missing", timedOut: false });
    expect((await managePackage({ manager: "npm", action: "remove", name: "zod" })).verified).toBe(true);
  });

  it("reports operation and verification failures", async () => {
    execaMock.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "install failed", timedOut: false });
    await expect(managePackage({ manager: "npm", action: "install", name: "zod" })).rejects.toThrow("install failed");

    execaMock
      .mockResolvedValueOnce({ exitCode: 0, stdout: "installed", stderr: "", timedOut: false })
      .mockResolvedValueOnce({ exitCode: 1, stdout: "{}", stderr: "missing", timedOut: false });
    await expect(managePackage({ manager: "npm", action: "install", name: "zod" })).rejects.toThrow("verification failed");
  });
});
