import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OAuthProvider } from "../../src/mcp/oauth.js";

/** R0 expiry and refresh-family contracts use deterministic time, no real credentials. */
afterEach(() => { vi.useRealTimers(); });

describe("HIGH-04 OAuth expiry and replay pre-fix transport-independent contracts", () => {
  it("enforces issued-token expiry and refresh-token replay revokes the successor", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const provider = new OAuthProvider("fixture-bootstrap-never-used-on-network");
    try {
      const resource = "http://127.0.0.1:12345/mcp";
      const clientId = "r0-client";
      const redirect = "http://127.0.0.1:12346/callback";
      const verifier = crypto.randomBytes(32).toString("base64url");
      const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
      const code = provider.issueCode(challenge, resource, redirect, clientId);
      const grant = provider.exchange(code, verifier, resource, redirect, clientId);
      expect(grant).not.toBeNull();
      const firstAccess = grant!.access_token as string;
      const firstRefresh = grant!.refresh_token as string;
      expect(provider.verifyToken("Bearer " + firstAccess)).toBe(true);
      const successor = provider.refresh(firstRefresh, resource);
      expect(successor).not.toBeNull();
      expect(provider.verifyToken("Bearer " + successor!.access_token)).toBe(true);
      expect(provider.refresh(firstRefresh, resource)).toBeNull();
      expect(provider.verifyToken("Bearer " + successor!.access_token)).toBe(false);
      // Test expiry against a distinct live grant: verifying an expired grant
      // removes that grant from the provider's in-memory index by design.
      const nextCode = provider.issueCode(challenge, resource, redirect, clientId);
      const freshGrant = provider.exchange(nextCode, verifier, resource, redirect, clientId);
      expect(freshGrant).not.toBeNull();
      vi.advanceTimersByTime(3600_001);
      expect(provider.verifyToken("Bearer " + freshGrant!.access_token)).toBe(false);
    } finally { provider.destroy(); }
  });

  it("binds an issued refresh token to its original resource", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const provider = new OAuthProvider("r0-bootstrap");
    try {
      const resource = "http://127.0.0.1:12345/mcp";
      const verifier = "r0-verifier-value";
      const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
      const code = provider.issueCode(challenge, resource, "http://127.0.0.1:12346/callback", "r0-client");
      const grant = provider.exchange(code, verifier, resource, "http://127.0.0.1:12346/callback", "r0-client");
      expect(grant).not.toBeNull();
      expect(provider.refresh(grant!.refresh_token as string, "http://127.0.0.1:9999/other")).toBeNull();
      expect(provider.refresh(grant!.refresh_token as string, resource)).not.toBeNull();
    } finally { provider.destroy(); }
  });
});
