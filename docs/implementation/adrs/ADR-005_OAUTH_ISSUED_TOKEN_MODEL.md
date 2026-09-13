# ADR-005 — Separate Bootstrap Secret from Issued OAuth Tokens

**Status:** Accepted  
**Date:** 2026-09-06

## Context
Current OAuth returns the long-lived master/bootstrap token as client access token, advertises expiry without enforcing it, and derives reusable refresh tokens. Monitoring also accepts the same bearer in URLs.

## Decision
Bootstrap/operator secret is only operator authentication/bootstrap authority. OAuth clients receive distinct high-entropy opaque access tokens stored by hash with enforced expiry, resource/audience, scopes, client/principal binding and revocation. Refresh tokens are opaque, hashed, family/generation tracked, one-time rotating with replay detection. Query-string bearer use is prohibited.

## Alternatives
- JWT access tokens: not required; opaque tokens simplify immediate revocation and fit SQLite scale.
- Keep master token + add timestamp: rejected; still over-couples operator and client authority.

## Consequences
New token persistence/migrations, reauthorization at cutover, fake-clock OAuth tests, updated dashboard/session model.

## Findings
HIGH-04, HIGH-11, MED-01, MED-03, MED-29, LOW-07.

## Validation
Access != bootstrap, expiry 401, wrong audience/scope, refresh rotation/replay, no query bearer, raw tokens absent from storage/logs.