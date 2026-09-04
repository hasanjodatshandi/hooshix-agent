import crypto from "node:crypto";

const ACCESS_TOKEN_TTL_MS = 3600_000; // 1 hour
const AUTH_CODE_TTL_MS = 300_000; // 5 minutes

interface AuthCodeEntry {
  codeChallenge: string;
  resource: string;
  redirectUri: string;
  clientId: string;
  expiresAt: number;
}

export class OAuthProvider {
  private accessToken: string;
  private codes = new Map<string, AuthCodeEntry>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
    // Clean up expired codes every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }

  /** Verify a Bearer token */
  verifyToken(authorization: string | undefined): boolean {
    if (!authorization) return false;
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    // timingSafeEqual requires same length buffers — check first
    if (token.length !== this.accessToken.length) return false;
    return crypto.timingSafeEqual(
      Buffer.from(token),
      Buffer.from(this.accessToken),
    );
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

    return this.tokenResponse(resource);
  }

  /** Refresh an access token */
  refresh(
    refreshToken: string | undefined,
    resource: string,
  ): Record<string, unknown> | null {
    if (!resource || !refreshToken) return null;
    const expected = this.refreshTokenValue(resource);
    if (!crypto.timingSafeEqual(Buffer.from(refreshToken), Buffer.from(expected))) {
      return null;
    }
    return this.tokenResponse(resource);
  }

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
  }
}
