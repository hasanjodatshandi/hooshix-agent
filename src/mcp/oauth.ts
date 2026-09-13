import crypto from "node:crypto";

const ACCESS_TOKEN_TTL_MS = 3600_000; // 1 hour
const AUTH_CODE_TTL_MS = 300_000; // 5 minutes
const REFRESH_TTL_MS = 30 * 24 * 3600_000; // 30 days
const MAX_ISSUED_TOKENS = 100; // cap in-memory issued-token state

interface AuthCodeEntry {
  codeChallenge: string;
  resource: string;
  redirectUri: string;
  clientId: string;
  expiresAt: number;
}

interface IssuedToken {
  accessTokenHash: string; // SHA-256 — raw tokens are never stored
  refreshTokenHash: string;
  resource: string;
  clientId: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  rotatedFrom: string | null; // hash of the refresh token this one replaced
  consumed: boolean; // refresh reuse marker — revokes the chain on detection
  createdAt: number;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export class OAuthProvider {
  private accessToken: string; // bootstrap master token (PIN + legacy API)
  private codes = new Map<string, AuthCodeEntry>();
  private issued = new Map<string, IssuedToken>(); // keyed by access token hash
  private byRefresh = new Map<string, string>(); // refresh hash → access hash
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
    // Clean up expired codes every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }

  /** Verify a Bearer token (issued token or the bootstrap master token) */
  verifyToken(authorization: string | undefined): boolean {
    if (!authorization) return false;
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    if (!token) return false;
    // Master token still verifies directly (bootstrap + local tooling).
    if (timingSafeStringEqual(token, this.accessToken)) return true;
    const entry = this.issued.get(sha256(token));
    if (!entry) return false;
    if (entry.accessExpiresAt < Date.now()) {
      this.issued.delete(sha256(token)); // expired → drop it
      return false;
    }
    return true;
  }

  /** Issue an authorization code (PKCE S256) */
  issueCode(
    codeChallenge: string,
    resource: string,
    redirectUri: string,
    clientId: string,
  ): string {
    const code = crypto.randomBytes(24).toString("base64url");
    this.codes.set(code, {
      codeChallenge,
      resource,
      redirectUri,
      clientId,
      expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    });
    return code;
  }

  /** Exchange authorization code for tokens */
  exchange(
    code: string,
    codeVerifier: string | undefined,
    resource: string,
    redirectUri: string,
    clientId: string,
  ): Record<string, unknown> | null {
    const entry = this.codes.get(code);
    if (!entry || entry.expiresAt < Date.now()) {
      this.codes.delete(code);
      return null;
    }
    this.codes.delete(code);

    if (!resource || !redirectUri || !clientId) return null;
    if (resource !== entry.resource) return null;
    if (redirectUri !== entry.redirectUri) return null;
    if (clientId !== entry.clientId) return null;

    // Verify PKCE S256
    if (entry.codeChallenge) {
      if (!codeVerifier) return null;
      const digest = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");
      if (digest !== entry.codeChallenge) return null;
    }

    return this.issueTokenGrant(resource, clientId, null);
  }

  /**
   * Refresh an access token. Refresh tokens are single-use: each successful
   * refresh issues a NEW refresh token and invalidates the old one. Presenting
   * a consumed refresh token signals theft — the entire token chain is
   * revoked (RFC 6749 §10.4 / RFC 6819 §5.2.2.3).
   */
  refresh(
    refreshToken: string | undefined,
    resource: string,
  ): Record<string, unknown> | null {
    if (!resource || !refreshToken) return null;
    const refreshHash = sha256(refreshToken);
    const entry = this.byRefresh.get(refreshHash);
    if (!entry) {
      // Legacy HMAC refresh token from the pre-issued-token model — still
      // accepted but does not rotate (it is a pure function of the master
      // token, so rotation is meaningless for it). Remove after clients migrate.
      const legacy = this.refreshTokenValue(resource);
      if (
        refreshToken.length === legacy.length &&
        timingSafeStringEqual(refreshToken, legacy)
      ) {
        return this.tokenResponse(resource);
      }
      return null;
    }

    const issued = this.issued.get(entry);
    if (!issued || issued.refreshExpiresAt < Date.now()) {
      this.byRefresh.delete(refreshHash);
      this.issued.delete(entry);
      return null;
    }

    if (issued.consumed) {
      // Reuse of an already-rotated refresh token → revoke the whole chain.
      this.revokeChain(entry);
      return null;
    }

    if (issued.resource !== resource) return null;

    // Mark consumed, then issue the successor grant (linked to this grant's
    // access hash so reuse detection can revoke the whole descendant chain).
    issued.consumed = true;
    return this.issueTokenGrant(resource, issued.clientId, entry);
  }

  /** Revoke an access token (RFC 7009-style; also drops its refresh token). */
  revoke(accessToken: string): void {
    const hash = sha256(accessToken);
    const entry = this.issued.get(hash);
    if (!entry) return;
    this.issued.delete(hash);
    if (entry.refreshTokenHash) this.byRefresh.delete(entry.refreshTokenHash);
  }

  /**
   * Revoke a rotation chain: the given grant and every grant rotated from it,
   * computed as a fixed-point closure over the rotatedFrom links.
   * `rotatedFrom` always holds the predecessor's access-token hash.
   */
  private revokeChain(accessHash: string): void {
    const doomed = new Set<string>([accessHash]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [hash, t] of this.issued) {
        if (!doomed.has(hash) && t.rotatedFrom && doomed.has(t.rotatedFrom)) {
          doomed.add(hash);
          grew = true;
        }
      }
    }
    for (const hash of doomed) {
      const t = this.issued.get(hash);
      if (t?.refreshTokenHash) this.byRefresh.delete(t.refreshTokenHash);
      this.issued.delete(hash);
    }
  }

  private issueTokenGrant(
    resource: string,
    clientId: string,
    rotatedFrom: string | null,
  ): Record<string, unknown> {
    const accessToken = `hx_${crypto.randomBytes(32).toString("base64url")}`;
    const refreshToken = `hxr_${crypto.randomBytes(32).toString("base64url")}`;
    const now = Date.now();

    const issued: IssuedToken = {
      accessTokenHash: sha256(accessToken),
      refreshTokenHash: sha256(refreshToken),
      resource,
      clientId,
      accessExpiresAt: now + ACCESS_TOKEN_TTL_MS,
      refreshExpiresAt: now + REFRESH_TTL_MS,
      rotatedFrom,
      consumed: false,
      createdAt: now,
    };
    this.issued.set(issued.accessTokenHash, issued);
    this.byRefresh.set(issued.refreshTokenHash, issued.accessTokenHash);
    this.enforceIssuedCap();

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_MS / 1000,
      refresh_token: refreshToken,
      scope: "offline_access",
    };
  }

  /** Keep in-memory issued-token state bounded (local single-tenant server). */
  private enforceIssuedCap(): void {
    if (this.issued.size <= MAX_ISSUED_TOKENS) return;
    const sorted = [...this.issued.values()].sort((a, b) => a.createdAt - b.createdAt);
    const toEvict = sorted.slice(0, this.issued.size - MAX_ISSUED_TOKENS);
    for (const victim of toEvict) {
      this.issued.delete(victim.accessTokenHash);
      if (victim.refreshTokenHash) this.byRefresh.delete(victim.refreshTokenHash);
    }
  }

  /** Legacy response shape: master token + derived refresh token (deprecated). */
  private tokenResponse(resource: string): Record<string, unknown> {
    return {
      access_token: this.accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_MS / 1000,
      refresh_token: this.refreshTokenValue(resource),
      scope: "offline_access",
    };
  }

  private refreshTokenValue(resource: string): string {
    const digest = crypto
      .createHmac("sha256", this.accessToken)
      .update(`hooshix-oauth-refresh-v2:${resource}`)
      .digest("base64url");
    return `hxr_${digest}`;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [code, entry] of this.codes) {
      if (entry.expiresAt < now) this.codes.delete(code);
    }
    for (const [hash, t] of this.issued) {
      if (t.accessExpiresAt < now && t.refreshExpiresAt < now) {
        this.issued.delete(hash);
        if (t.refreshTokenHash) this.byRefresh.delete(t.refreshTokenHash);
      }
    }
  }
}
