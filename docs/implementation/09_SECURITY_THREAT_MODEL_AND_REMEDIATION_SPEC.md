# Security Threat Model & Remediation Specification

**Baseline:** `HOOSHIX_AUDIT_CONSOLIDATED_FINAL.md`  
**Security objective:** remove confirmed exploit chains and make authorization/security boundaries architectural rather than handler conventions.

---

## 1. Assets

Protect at minimum:

- host filesystem data and source code;
- `.env`, private keys, cloud/package/Git credentials;
- HooshiX bootstrap/operator secrets;
- OAuth access/refresh tokens;
- Task plans, approvals, execution history and workspace scopes;
- SQLite durable state/backups;
- child-process authority of the server OS account;
- deployment configuration and production credentials;
- audit logs/metrics from secret leakage or tampering;
- Git dirty work and package/environment state.

---

## 2. Threat actors / threat sources

1. Unauthenticated Internet client against HTTP/OAuth endpoints.
2. Authenticated but least-privileged MCP client.
3. Compromised/stolen OAuth access token.
4. Prompt-injected or malicious model output controlling tool arguments.
5. Legitimate user accidentally approving misleading destructive action.
6. Local process/user with access to token/log files.
7. Fault/crash/timeout that creates confused-deputy style retry behavior.
8. Deployment/configuration drift causing intended control not to exist in running artifact.
9. Malicious/compromised dependency/build input.

---

## 3. Trust boundaries

### TB-01 HTTP caller -> authentication
Controls:
- OAuth resource server validation;
- token expiry/audience/scope;
- rate limits;
- CORS/public-base validation.

### TB-02 Principal/model -> operation authorization
Controls:
- single `AuthorizationService`;
- canonical operation descriptor;
- server ceiling + principal scopes;
- approval policy.

### TB-03 Operation -> workspace/filesystem
Controls:
- session/task WorkspaceScope;
- path canonicalization/realpath;
- SensitivePathPolicy;
- authorized paths.

### TB-04 Operation -> process/Git/package
Controls:
- authorized cwd;
- strict command policy;
- `shell:false`;
- sanitized env;
- approval;
- output/time/concurrency limits.

### TB-05 Persisted Task state -> external reality
Controls:
- ExecutionReceipt;
- outcome_unknown;
- termination acknowledgement;
- reconciliation;
- idempotency;
- execution lease.

### TB-06 Application -> persistence
Controls:
- repository ports;
- parameterized SQL;
- migrations;
- atomic CAS operations;
- canonical mappers.

### TB-07 Build/config -> production runtime
Controls:
- frozen dependency install;
- one typed config;
- CI/container tests;
- artifact/schema provenance smoke.

---

## 4. Required security properties

### SP-01 Complete mediation
Every externally invokable operation is authorized exactly once at the application boundary before any side effect. Adapter/service path choice cannot bypass it.

### SP-02 Least privilege
Effective authority is the intersection of server ceiling, principal scopes/role, workspace scope and operation-specific policy.

### SP-03 Explicit privilege elevation
Workspace scope expansion and unrestricted mode are explicit, auditable, ADMIN-gated and approval-bound.

### SP-04 Secret non-disclosure
Sensitive files are not read by search; bearer/bootstrap/refresh values do not enter URLs/logs/metrics/tool outputs.

### SP-05 Token boundedness
Access tokens expire; refresh tokens rotate; audience/resource/client/scope validated; revocation is enforceable.

### SP-06 No unsafe implicit retry
Unknown side effects are not replayed automatically.

### SP-07 Fail closed for configuration/build security
Unknown/stale auth variables, lockfile inconsistency and invalid public HTTP config fail loudly rather than silently falling back.

### SP-08 Audit without outcome corruption
Security events are recorded best-effort/durably, but post-effect telemetry failure cannot misreport a known successful side effect as failed.

---

## 5. HIGH finding remediation requirements

### HIGH-01 workspace authorization
Required controls:
- remove direct workspace mutation calls from MCP adapters;
- session-scoped WorkspaceContextRepository;
- operation descriptor + AuthorizationService;
- expansion approval;
- unrestricted requires server capability + ADMIN + exact approval;
- no production auto-approve bypass.

Security test: attempt each workspace mutation under all permission levels/direct/task modes.

### HIGH-02 sensitive search
Required controls:
- application SensitivePathPolicy checked before read/stat content operation;
- sensitive directories pruned during traversal;
- root must be a directory;
- aggregate bytes budget;
- regression for `.env`, `.token`, `.ssh/id_rsa`, cloud credentials and filename/case variants.

### HIGH-03 Git diff no-index
Required controls:
- generic safe command parser denies/approval-gates `git diff --no-index`;
- auto-safe commands must validate cwd/path-bearing args;
- dedicated `git_diff` adapter supports only repository diff semantics.

### HIGH-04 OAuth expiry
Required controls:
- raw bootstrap/operator secret never becomes client access token;
- access token random >=256-bit equivalent entropy, hashed at rest;
- issuedAt/expiresAt checked on each request;
- resource/audience and scopes checked;
- refresh tokens random/hashed/rotating;
- consumed refresh replay detection;
- revocation.

### HIGH-05 timeout execution reality
Required controls:
- request cancellation;
- bounded termination confirmation;
- if termination/effect uncertain -> outcome_unknown;
- no retry until reconciliation;
- no second process starts while first may still be live.

### HIGH-06 crash replay
Required controls:
- startup converts running side-effecting steps to outcome_unknown;
- read-only may be classified safe retry;
- idempotent mutation requires durable matching receipt/key;
- non-idempotent requires reconciliation/manual decision.

### HIGH-07 incomplete hydration
Required controls:
- one Task mapper;
- recovery queries only Task IDs then canonical `get`;
- round-trip test for every persisted field.

### HIGH-08 dirty Git rollback
Required controls:
- snapshot refuses dirty tree with explicit error until full dirty backup feature exists;
- rollback verifies repo root/HEAD/snapshot binding;
- docs/tool response says clean-tree rollback.

### HIGH-09 package rollback overclaim
Required controls:
- API/status uses `manifest_restored` / `manifest_restore_failed`;
- no `rolled_back` claim for installed state without verified reverse operation;
- winget/choco compensation unsupported by default and reported truthfully.

### HIGH-10 frozen-lock fallback
Required control: Docker build has only frozen lock install; any failure stops build.

### HIGH-11 auth contract drift/static secret
Required controls:
- one canonical bootstrap auth variable/file contract;
- `MCP_API_KEY` set => startup error with migration guidance;
- remove `hooshix-v2-secret` everywhere;
- secret patterns CI gate;
- runtime effective config identifies token source name only.

### HIGH-12 health/auth conflict
Required control: minimal unauthenticated liveness/readiness endpoints or authenticated probe with safely supplied secret. Preferred: minimal unauthenticated health endpoints.

### HIGH-13 process-local task exclusion
Required control: SQLite-backed atomic lease if same DB can be opened by more than one runtime; startup advertises single-instance mode if lease system unavailable.

---

## 6. MEDIUM security-related remediation

### MED-01 query bearer
Remove `?token=` completely for MCP/monitoring long-lived bearer. Tests assert query token fails.

### MED-02 log redaction
Redaction algorithm recognizes sensitive option names and redacts the following argv item; supports `--key=value`; never logs token contents. Property tests generate opaque values.

### MED-03 rate limits/session bounds
Application/adapter rate limiter; per-IP public OAuth and per-principal authenticated limits; expensive tool concurrency budget; session idle/absolute TTL and per-principal session cap.

### MED-04 shell cwd
Canonicalize/authorize before execution; outside cwd denied for any auto-approved command.

### MED-05 audit failure
Known operation outcome preserved; record `telemetryDegraded`; fallback stderr/security health signal redacted; never retry just because logging failed.

### MED-29 Host/CORS
- public HTTP mode requires configured canonical `MCP_PUBLIC_BASE_URL`/new config equivalent;
- do not construct OAuth issuer from untrusted Host headers;
- strict origin allowlist for browser-facing HTTP;
- MCP non-browser clients unaffected by CORS policy but server responses should not expose wildcard unnecessarily.

### LOW-07 token file mode
On POSIX create/check bootstrap token file mode 0600; reject/warn on permissive existing file according to config.

---

## 7. Process security hardening

Preserve no-shell execution and add:
- environment allowlist; remove server bootstrap/access token and unrelated secrets;
- executable path resolution from trusted configured PATH;
- no newline/NUL args;
- maximum arg count/length;
- timeout/output bounds;
- per-principal/global process concurrency limits;
- child process tree termination;
- command policy exact-match approach;
- cwd authorization;
- never claim OS filesystem sandboxing unless a true sandbox adapter exists.

High-risk process execution remains human-approved.

---

## 8. File security hardening

- canonical root comparisons are platform-aware;
- existing ancestor and target realpaths rechecked against scope;
- symlink/junction escape tests on Windows/POSIX where CI environment supports;
- file type restrictions: reject special devices/FIFOs where not intended;
- file size limits before read;
- search aggregate byte/file/time budget;
- sensitive path evaluation before opening a file;
- absolute paths returned to untrusted client only if explicitly required; prefer workspace-relative path.

This also resolves LOW-01 host path leak by defaulting search results to relative path and keeping absolute path only in internal receipts.

---

## 9. Security event logging requirements

Aligned with OWASP ASVS security logging principles:

Log without secrets/content:
- authentication success/failure;
- OAuth code/token issuance metadata (token ID only);
- token expiry/revocation/refresh replay;
- authorization denial and approval requirement;
- approval approve/consume/revoke/expire;
- workspace scope expansion/unrestricted attempts;
- sensitive path denial;
- command block/rate limit;
- outcome_unknown/reconciliation decisions;
- deployment config validation failures.

Event metadata:
- timestamp with UTC/offset;
- correlation ID;
- principal ID/type;
- operation/tool ID;
- task/step ID if present;
- decision/result category;
- no raw arguments when they may contain secrets; use sanitized summary/fingerprint.

---

## 10. Security test catalog

Mandatory suites:

### Authorization matrix
For each permission level and representative operation class, assert allow/deny/approval.

### Prompt/tool misuse simulations
Feed model-controlled arguments attempting:
- workspace root expansion;
- unrestricted mode;
- `../`/absolute/symlink paths;
- sensitive search;
- git no-index;
- shell outside cwd;
- package scripts;
- approval substitution.

### OAuth
- expired token 401;
- wrong resource/audience 401;
- missing scope 403;
- refresh rotation works;
- old refresh replay fails/revokes family;
- query token rejected;
- code reuse rejected;
- PKCE wrong verifier rejected;
- redirect/client/resource mismatch rejected;
- Host header cannot change issuer;
- CORS allowlist.

### Logging
- opaque separated secret not logged;
- recognized prefixes not logged;
- auth failures log metadata without credential;
- file contents never in audit.

### Rate/resource exhaustion
- 429/retry behavior;
- expensive tool concurrency cap;
- session eviction;
- search byte budget.

---

## 11. Security closure gate

A security finding is closed only when:
- old exploit regression exists;
- regression failed on old behavior or is demonstrably equivalent to the recorded PoC;
- new architecture implementation passes it;
- no bypass exists through the other inbound path (direct vs Task);
- threat model row and finding matrix updated;
- audit/security docs updated;
- full security/E2E suite green.

Do not mark a finding closed from code inspection alone when a safe automated regression can exist.