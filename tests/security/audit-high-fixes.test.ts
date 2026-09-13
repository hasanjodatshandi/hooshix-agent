import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isSensitiveSearchHit,
  searchWorkspaceFiles,
} from "../../src/services/filesystem/filesystem-service.js";
import {
  isUnrestrictedMode,
  setUnrestrictedMode,
} from "../../src/security/workspace-guard.js";
import {
  OAuthProvider,
} from "../../src/mcp/oauth.js";
import {
  runWithPolicyApproval,
} from "../../src/core/governance/policy-decision-point.js";

/**
 * Regression tests for the three open audit HIGH findings:
 *  - HIGH-02: search_files must never return lines from sensitive files
 *  - HIGH-01: enabling unrestricted mode requires policy approval
 *  - HIGH-04: OAuth must issue expiring unique tokens with rotating refresh
 */

const root = path.resolve("tests/audit-high");

afterEach(() => {
  setUnrestrictedMode(false);
});

describe("HIGH-02: search_files sensitive-file denylist", () => {
  it("silently skips sensitive files in the walk (content never leaks)", async () => {
    await fs.mkdir(path.join(root, ".ssh"), { recursive: true });
    await fs.writeFile(path.join(root, "normal.txt"), "needle-in-normal");
    await fs.writeFile(path.join(root, ".env"), "needle-in-env=1");
    await fs.writeFile(path.join(root, ".token"), "needle-in-token");
    await fs.writeFile(path.join(root, ".ssh", "id_rsa"), "needle-in-key");
    await fs.writeFile(path.join(root, "secret.pem"), "needle-in-pem");
    try {
      const result = await searchWorkspaceFiles(root, "needle-in");
      const hitPaths = result.matches.map((m) => m.path.replace(/\\/g, "/"));
      expect(hitPaths).toEqual(["normal.txt"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("isSensitiveSearchHit matches the shared denylist", () => {
    expect(isSensitiveSearchHit("D:/x/.env")).toBe(true);
    expect(isSensitiveSearchHit("D:/x/sub/.env.local")).toBe(true);
    expect(isSensitiveSearchHit("D:/x/.token")).toBe(true);
    expect(isSensitiveSearchHit("D:/x/.ssh/id_rsa")).toBe(true);
    expect(isSensitiveSearchHit("D:/x/.aws/credentials")).toBe(true);
    expect(isSensitiveSearchHit("D:/x/cert.key")).toBe(true);
    expect(isSensitiveSearchHit("D:/x/src/index.ts")).toBe(false);
  });
});

describe("HIGH-01: unrestricted-mode elevation gate", () => {
  it("blocks enabling unrestricted mode on direct calls (no approval context)", () => {
    expect(isUnrestrictedMode()).toBe(false);
    expect(() => setUnrestrictedMode(true)).toThrow(/Approval required/i);
    // state must be unchanged after the rejected elevation
    expect(isUnrestrictedMode()).toBe(false);
  });

  it("disabling unrestricted mode never requires approval", () => {
    expect(() => setUnrestrictedMode(false)).not.toThrow();
    expect(isUnrestrictedMode()).toBe(false);
  });

  it("allows enabling through an approved task-step context", async () => {
    const result = await runWithPolicyApproval("set_workspace", async () => {
      setUnrestrictedMode(true);
      return isUnrestrictedMode();
    });
    expect(result).toBe(true);
    setUnrestrictedMode(false);
  });
});

describe("HIGH-04: OAuth issued-token model", () => {
  const master = "master-token-for-tests";
  const resource = "http://localhost:3001/mcp";
  const redirect = "http://127.0.0.1:9090/callback";
  const clientId = "client-1";

  function newProvider(): OAuthProvider {
    return new OAuthProvider(master);
  }

  /** Create a fresh PKCE authorization code and return [code, verifier]. */
  function codeFor(oauth: OAuthProvider): [string, string] {
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const code = oauth.issueCode(challenge, resource, redirect, clientId);
    return [code, verifier];
  }

  function issuedTable(oauth: OAuthProvider): Map<string, { accessExpiresAt: number }> {
    return (oauth as unknown as { issued: Map<string, { accessExpiresAt: number }> }).issued;
  }

  it("issues unique non-master access tokens that verify", () => {
    const oauth = newProvider();
    try {
      const [code1, v1] = codeFor(oauth);
      const t1 = oauth.exchange(code1, v1, resource, redirect, clientId)!;
      const [code2, v2] = codeFor(oauth);
      const t2 = oauth.exchange(code2, v2, resource, redirect, clientId)!;

      expect(t1.access_token).not.toBe(master);
      expect(t2.access_token).not.toBe(t1.access_token);
      expect(t1.expires_in).toBe(3600);

      expect(oauth.verifyToken(`Bearer ${t1.access_token}`)).toBe(true);
      expect(oauth.verifyToken(`Bearer ${t2.access_token}`)).toBe(true);
      // master token remains valid (bootstrap + local tooling)
      expect(oauth.verifyToken(`Bearer ${master}`)).toBe(true);
      expect(oauth.verifyToken(undefined)).toBe(false);
      expect(oauth.verifyToken("Bearer garbage")).toBe(false);
    } finally {
      oauth.destroy();
    }
  });

  it("rejects an authorization code replay with a different verifier", () => {
    const oauth = newProvider();
    try {
      const [code, v1] = codeFor(oauth);
      expect(oauth.exchange(code, v1, resource, redirect, clientId)).not.toBeNull();
      expect(oauth.exchange(code, v1, resource, redirect, clientId)).toBeNull();
    } finally {
      oauth.destroy();
    }
  });

  it("rotates refresh tokens on every use", () => {
    const oauth = newProvider();
    try {
      const [code, verifier] = codeFor(oauth);
      const first = oauth.exchange(code, verifier, resource, redirect, clientId)!;
      const r1 = first.refresh_token as string;

      const second = oauth.refresh(r1, resource)!;
      expect(second).not.toBeNull();
      expect(second.access_token).not.toBe(first.access_token);
      const r2 = second.refresh_token as string;
      expect(r2).not.toBe(r1);
      expect(oauth.verifyToken(`Bearer ${second.access_token}`)).toBe(true);
    } finally {
      oauth.destroy();
    }
  });

  it("detects refresh-token reuse and revokes the whole chain", () => {
    const oauth = newProvider();
    try {
      const [code, verifier] = codeFor(oauth);
      const first = oauth.exchange(code, verifier, resource, redirect, clientId)!;
      const r1 = first.refresh_token as string;

      const second = oauth.refresh(r1, resource)!; // legitimate rotation
      const attacker = oauth.refresh(r1, resource); // reuse of consumed token
      expect(attacker).toBeNull();
      // successor tokens from the chain are dead too
      expect(oauth.verifyToken(`Bearer ${second.access_token}`)).toBe(false);
      expect(oauth.refresh(second.refresh_token as string, resource)).toBeNull();
    } finally {
      oauth.destroy();
    }
  });

  it("rejects expired access tokens", () => {
    const oauth = newProvider();
    try {
      const [code, verifier] = codeFor(oauth);
      const t = oauth.exchange(code, verifier, resource, redirect, clientId)!;
      const tok = t.access_token as string;
      expect(oauth.verifyToken(`Bearer ${tok}`)).toBe(true);

      const hash = crypto.createHash("sha256").update(tok).digest("hex");
      const entry = issuedTable(oauth).get(hash)!;
      entry.accessExpiresAt = Date.now() - 1000;
      expect(oauth.verifyToken(`Bearer ${tok}`)).toBe(false);
    } finally {
      oauth.destroy();
    }
  });

  it("supports explicit revocation (RFC 7009-style)", () => {
    const oauth = newProvider();
    try {
      const [code, verifier] = codeFor(oauth);
      const t = oauth.exchange(code, verifier, resource, redirect, clientId)!;
      const tok = t.access_token as string;
      expect(oauth.verifyToken(`Bearer ${tok}`)).toBe(true);

      oauth.revoke(tok);
      expect(oauth.verifyToken(`Bearer ${tok}`)).toBe(false);
      // and its refresh token no longer works
      expect(oauth.refresh(t.refresh_token as string, resource)).toBeNull();
    } finally {
      oauth.destroy();
    }
  });
});
