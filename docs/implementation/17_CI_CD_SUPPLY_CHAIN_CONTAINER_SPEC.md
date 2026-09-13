# CI/CD, Supply Chain & Container Security Specification

**Primary findings:** HIGH-10, HIGH-11, HIGH-12, MED-13, MED-14, MED-15, MED-16; supports MED-21/22/25 and LOW hygiene findings.  
**References:** current Docker build best practices; GitHub Actions secure-use guidance; exact pnpm lock/package pinning preserved.

---

## 1. CI objectives

Every push/PR that can reach release branches must prove:
- dependency graph is frozen and reproducible;
- architecture boundaries hold;
- build/typecheck/tests/coverage pass;
- audit regressions pass;
- HTTP/OAuth behavior passes;
- migrations upgrade fixtures safely;
- container builds/runs non-root and health contract works;
- no committed secrets/stale auth configuration;
- Prometheus output is valid;
- generated docs/tool catalog match code.

No release is based solely on a developer-machine green run.

---

## 2. Dependency installation policy

- `pnpm install --frozen-lockfile` only in CI and Docker builds.
- No `|| pnpm install`, no silent fallback.
- packageManager version remains pinned.
- exact dependency versions or approved update policy retained.
- pnpm build-script allowlist retained and reviewed when dependencies change.
- dependency update PRs run full security/release gates.

If MCP SDK v2 migration changes package names, update pin/allowlist tooling accordingly and grep for old `@modelcontextprotocol/sdk` references before removal.

---

## 3. GitHub Actions security baseline

Workflow policy:
- default `permissions: contents: read` or less; elevate per job only when required;
- third-party actions pinned to full commit SHA, with comment noting upstream tag/version for maintainability;
- no untrusted PR data interpolated into shell command strings;
- no secrets exposed to fork PR jobs unnecessarily;
- artifacts contain no `.token`, `.env`, DB, logs or user workspace data;
- timeouts on jobs;
- concurrency cancellation for superseded PR runs where safe;
- release/signing jobs isolated from normal PR jobs.

---

## 4. Proposed workflow stages

### Job A — static/bootstrap
1. checkout pinned action SHA;
2. install configured Node version from `.nvmrc`/canonical config;
3. Corepack/pnpm exact version;
4. frozen install;
5. verify `node --version`, `pnpm --version`;
6. typecheck/build;
7. architecture tests;
8. `git diff --check` equivalent on committed tree as appropriate;
9. config/schema lint.

### Job B — unit/security
- domain/application unit tests;
- audit exploit regressions;
- property tests;
- coverage with critical per-file thresholds.

### Job C — integration/E2E
- SQLite migration/adapter tests;
- filesystem/Git/process fixtures;
- stdio MCP E2E;
- HTTP/OAuth modern MCP E2E;
- failure-injection/crash tests where platform permits.

### Job D — supply chain
- `pnpm audit`;
- secret scanning;
- grep/config gate for forbidden literals (`hooshix-v2-secret`, `MCP_API_KEY`, deprecated package/API names after cutover);
- license policy if project later requires it.

### Job E — container
- build production image from frozen lock;
- verify effective user non-root;
- run container;
- call `/health/live`/`ready` contract;
- authenticated MCP smoke with generated test credentials;
- inspect image for accidental secrets/test data;
- optional vulnerability/image scan if tooling is selected.

### Job F — observability/docs
- generate sample Prometheus metrics -> `promtool check metrics` if available;
- generated `docs/TOOLS.md` diff must be clean;
- documentation link/contract consistency checks;
- MCP protocol/version smoke.

---

## 5. Container target

### Multi-stage build

Builder may include compiler/package tools. Runtime contains only necessary runtime dependencies/artifacts.

### Non-root

Use a dedicated non-root runtime user (or official Node non-root user) with:
- read access to application code;
- write only to configured data/log/temp directories;
- no unnecessary root-owned writable paths.

Explicit UID/GID may be chosen if volume ownership consistency requires it.

### Reproducible base

Use trusted Node image and controlled pinning policy. For stronger reproducibility, pin tag + digest and update via reviewed automation. Do not manually freeze forever without update process.

### Runtime filesystem

- application code read-only where deployment supports it;
- `/app/data` or configured DB directory writable;
- logs externalized/volume or bounded local policy;
- token/bootstrap secret via secret/config mechanism, not baked into image.

---

## 6. Dockerfile rules

Forbidden:
- unfrozen dependency fallback;
- `ENV`/`ARG` containing real secrets;
- default root runtime when not required;
- copying `.env`, `.token`, local DB/logs/tests due bad context;
- healthcheck depending on undocumented secret query parameter.

Required:
- `.dockerignore` verified;
- frozen install;
- build gate;
- non-root runtime;
- healthcheck on final liveness endpoint;
- production `NODE_ENV`;
- explicit start command using built artifact and deterministic path.

---

## 7. Healthcheck contract

Container health uses `GET /health/live` (or final documented equivalent):
- unauthenticated;
- no sensitive output;
- succeeds whenever process/server alive.

Readiness can be separate and may check DB/migrations/reconciliation initialization.

CI verifies both exact routes and response shapes.

---

## 8. Secret/config gates

CI fails on:
- literal `hooshix-v2-secret`;
- active `MCP_API_KEY` use after deprecation cutoff;
- access/bootstrap token values in source/docs/examples outside clearly fake placeholders;
- `.token`/`.env*` tracked;
- private key material patterns;
- raw token output in test snapshots.

Use a maintained secret scanner if available plus small deterministic project-specific grep tests for known legacy strings.

---

## 9. Node/pnpm bootstrap reproducibility

Fix MED-15 by defining one runtime contract:
- supported Node major/minor policy;
- `.nvmrc`/engines aligned;
- service/watchdog scripts locate exact Node/Corepack/pnpm reliably;
- startup preflight logs versions and fails if unsupported;
- CI mirrors production version.

Do not depend on interactive shell PATH/NVM initialization.

---

## 10. Release artifacts/provenance

For release candidate:
- record commit SHA;
- record Node/pnpm versions;
- record dependency lock hash;
- record container image digest;
- record migration schema version;
- record supported MCP protocol versions;
- attach test/coverage/audit summary;
- no secrets in metadata.

Optionally add SBOM/provenance attestation after core CI is stable; useful but not a substitute for required gates.

---

## 11. Branch/PR protection recommendation

Release branch requires:
- all CI checks;
- no direct push if repository policy permits;
- review for security/architecture-sensitive changes;
- PR template requires finding IDs/ADR/test evidence.

Architecture/security changes should not be combined with unrelated formatting cleanup.

---

## 12. Dependency update policy

- automated or scheduled update PRs acceptable;
- Docker base digest/tag updates reviewed through CI;
- MCP SDK migration follows document 31 and ADR-009;
- major dependency upgrades require explicit compatibility test and changelog review;
- no `latest` runtime dependency ranges in production manifest unless project policy explicitly changes.

---

## 13. Required CI checks by finding

- HIGH-10: Dockerfile static test + real frozen image build.
- HIGH-11: config test + secret scan + legacy variable rejection.
- HIGH-12: container liveness test.
- MED-13: image user check.
- MED-14: workflow itself plus branch policy.
- MED-15: version preflight in CI/container/service fixture.
- MED-16: docs/config consistency check.
- MED-21/22/25: security/HTTP/Prometheus jobs.

---

## 14. Definition of done

- a clean checkout can execute complete CI without manual PATH fixes;
- Docker cannot fall back to unfrozen dependency resolution;
- runtime image is non-root;
- healthcheck is aligned with final HTTP contract;
- legacy secret/env guidance cannot re-enter unnoticed;
- actions use least privilege and pinned immutable SHAs;
- full security/architecture/E2E gates run before release;
- release metadata identifies exactly what was built/tested.