# HooshiX Release Process

The implementer may recommend a release candidate but must not perform public production deployment without explicit owner instruction.

## 1. Preflight (read-only)

```bash
node scripts/release-preflight.mjs
```

Never tags, commits or deploys. Checks: clean worktree (`DIRTY_WORKTREE` blocker), Node ≥24, pnpm matching the `packageManager` pin (11.24.0), and that `dist/index.js` + `dist/index-http.js` exist. Emits a JSON verdict (`NO_GO` / `LOCAL_SOURCE_GATES_PASS`) together with the HEAD sha, sha256 digests of `package.json`, `pnpm-lock.yaml`, `migrations.ts` and the dist bundles, the `@modelcontextprotocol/sdk` version, `expectedToolInventory: 53`, and the list of outstanding manual gates.

## 2. Gates

All of the following must be green:

- `pnpm run typecheck` (both `tsconfig.json` and `tsconfig.r1.json`)
- `pnpm run build`
- `node scripts/verify-g1-global.mjs --strict`
- `node scripts/verify-runtime-versions.mjs`
- `node scripts/r7-secret-policy-check.mjs`
- `pnpm audit --prod --audit-level=high`
- The full test suite, serially and in repeated parallel runs
- `git diff --check` (also asserted inside the suite)

## 3. Migration rehearsal

```bash
node scripts/release-db-rehearsal.mjs
```

Copies the live DB, migrates it, verifies integrity/FK/row-count and performs a restore drill. The release must not proceed on a FAIL.

## 4. Traceability

Every HIGH/MED/LOW finding in `docs/implementation/20_FINDINGS_TRACEABILITY_MATRIX.md` (54 rows) must be resolved. The release checklist `docs/implementation/27_RELEASE_READINESS_CHECKLIST.md` must be completed section by section, with each `[x]` naming its executing test and each blocked item naming its blocker.

## 5. Record

The sign-off block in the checklist records: release candidate commit, date, Node/pnpm versions, MCP SDK packages, DB schema version, container image digest, findings closed, per-gate PASS/FAIL, known residual limitations, the implementer recommendation and the **owner production decision**.

## Known blockers (environment)

These cannot be closed from this environment and remain explicit `BLOCKED`:

- **Docker daemon unreachable** — the real non-root container runtime, the image health smoke and the authenticated MCP container smoke are never executed. The Dockerfile's `USER node` and `HEALTHCHECK` are statically asserted only.
- **No GitHub Actions runner** — the hosted clean-checkout CI run is never executed. A local clean clone is the substitute.
- **No POSIX host** — the `0600` permission branch cannot run on Windows.

A release candidate therefore requires a POSIX host with Docker and CI before the owner can approve public exposure.
