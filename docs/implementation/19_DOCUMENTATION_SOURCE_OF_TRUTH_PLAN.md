# Documentation Source-of-Truth Plan

**Primary findings:** HIGH-11, HIGH-12, MED-16, MED-28, LOW-05/11/12; resolves the audit's documentation-authority problem.  
**Goal:** shipped documentation is generated/verified from the same contracts that drive implementation wherever practical.

---

## 1. Final documentation hierarchy

After cutover the repository should expose:

```text
README.md
  concise product overview, local development, links

docs/
  ARCHITECTURE.md
  SECURITY.md
  OPERATIONS.md
  TOOLS.md                 # generated from operation catalog/schema metadata
  PROTOCOL_COMPATIBILITY.md
  MIGRATIONS.md
  RELEASE.md
  audits/
    HOOSHIX_AUDIT_CONSOLIDATED_FINAL.md (or preserved authoritative audit)
  implementation/
    ... this implementation package, retained as design/provenance ...
```

Existing consolidated audit stays immutable/provenance-oriented; operational docs must describe the actual shipping code.

---

## 2. Authority rules

1. Runtime/domain/application contracts are implementation reality.
2. Generated artifacts derived from canonical code metadata are authoritative for inventories such as tools/scopes.
3. `ARCHITECTURE.md`, `SECURITY.md`, `OPERATIONS.md` are manually maintained but CI-checked against configuration/catalog/protocol tests.
4. Audit documents are evidence, not runtime instructions.
5. Deprecated docs/scripts are deleted or clearly moved under archival history; they must not remain alongside current instructions without warning.

---

## 3. `docs/ARCHITECTURE.md` required contents

- target Hexagonal/Clean layers and dependency rule;
- source tree;
- inbound/outbound ports/adapters;
- composition/bootstrap flow;
- direct MCP and Task flow meeting at `ExecuteToolUseCase`;
- authorization/workspace boundary;
- task execution/reconciliation/lease model;
- persistence and migration boundary;
- HTTP/OAuth and MCP modern protocol topology;
- observability model;
- ADR index;
- architecture enforcement rules.

No aspirational statements marked as current until implementation gate passes.

---

## 4. `docs/SECURITY.md` required contents

- threat model/trust boundaries;
- permission levels and OAuth scopes;
- operation risk/approval semantics;
- workspace/session/principal/task scope model;
- unrestricted-mode exact prerequisites;
- sensitive path policy;
- subprocess boundary: unsandboxed OS account unless separate sandbox adapter introduced;
- command allowlist/approval rules;
- OAuth access/refresh/bootstrap token distinctions;
- token lifetime/rotation/revocation;
- query-string token prohibition;
- host/origin/rate-limit/session policy;
- audit/log redaction policy;
- incident/token compromise response;
- safe handling of outcome_unknown/reconciliation.

Security docs must not claim controls not backed by regression tests.

---

## 5. `docs/OPERATIONS.md` required contents

Derived from document 18:
- supported operating modes;
- canonical env/config table;
- startup commands;
- Docker deployment (public exposure delegated to the external deployment project);
- liveness/readiness;
- token generation/rotation;
- database backup/migration;
- recovery/reconciliation operations;
- logs/metrics/dashboard;
- incident response;
- upgrade/rollback procedure.

Only one production runbook.

---

## 6. `docs/TOOLS.md` generated artifact

Generate from canonical `OperationDescriptor` + inbound schema registry.

For each operation include:
- operation/tool ID;
- title/description;
- permission;
- OAuth scopes;
- risk/effect class;
- approval policy;
- workspace behavior;
- input schema summary;
- idempotency/revision capabilities;
- side-effect/reconciliation notes;
- protocol availability if transport-specific.

CI runs generator and fails if working tree diff appears, proving docs/catalog are synchronized.

Do not hand-maintain duplicate tool inventories in README.

---

## 7. `docs/PROTOCOL_COMPATIBILITY.md`

Document:
- MCP SDK package/version;
- supported protocol revisions/eras;
- modern 2026-07-28 HTTP serving behavior;
- legacy 2025 compatibility window if retained;
- stdio serving behavior;
- auth opt-ins/issuer/scope-step-up behavior;
- deprecated MCP capabilities/features not used;
- HooshiX Task tools are application tools, not reliance on removed/experimental protocol task wire methods unless explicitly chosen.

Keep this generated/verified against protocol configuration tests where possible.

---

## 8. Configuration reference generation

Maintain one typed config schema with metadata:
- name;
- type;
- default;
- required environments;
- secret flag;
- deprecated aliases;
- description.

Generate a configuration table section for OPERATIONS/README from metadata or verify via snapshot test. This prevents `MCP_API_KEY`/`MCP_ACCESS_TOKEN` drift class.

---

## 9. ADR documentation

`25_ARCHITECTURE_DECISION_RECORDS.md` is the index. Individual ADRs under `implementation/adrs/` record high-impact decisions.

ADR format:
- status/date;
- context;
- decision;
- alternatives;
- consequences;
- audit findings affected;
- verification.

Changing a non-negotiable architecture/security decision requires new superseding ADR, not silent edits.

---

## 10. Finding closure documentation

`20_FINDINGS_TRACEABILITY_MATRIX.md` is authoritative remediation ledger at design time; `29_IMPLEMENTATION_PROGRESS_LEDGER.md` records execution evidence.

Each finding closes only with:
- implementation task/reference;
- changed components;
- regression/acceptance test;
- command result/CI evidence;
- documentation update if user-facing contract changes.

No “not applicable” closure without written rationale and review.

---

## 11. Documentation tests

CI should validate:
- all links between package docs resolve;
- operation IDs in docs match catalog;
- config names in docs exist in schema;
- forbidden legacy terms/literals absent after cutoff (`MCP_API_KEY`, `hooshix-v2-secret`, old direct-auto-approve semantics, old package rollback wording);
- tool docs generator clean;
- documented commands syntactically/smoke-valid where feasible;
- README does not claim HTTP/OAuth coverage or rollback behavior beyond tests;
- protocol version docs match server supported versions.

---

## 12. Migration from current docs

During R9:
1. preserve consolidated audit and implementation package.
2. inventory every current README/docs/scripts markdown instruction.
3. classify: migrate, archive, delete.
4. create final ARCHITECTURE/SECURITY/OPERATIONS/PROTOCOL docs.
5. generate TOOLS/config reference.
6. update README to point to them.
7. remove/deprecate conflicting setup documents.
8. run documentation consistency tests.

Do not delete audit provenance.

---

## 13. Versioning policy

Operational docs version with code in Git. Audit/design docs may carry dates/status.

Generated tool/config docs should include:
- source commit/tool catalog schema version;
- generation note;
- “do not hand edit” marker if fully generated.

No manually future-dated documents; use actual generation date/commit metadata.

---

## 14. Definition of done

- one current architecture document;
- one current security contract;
- one current operations runbook;
- generated/verified tool and config references;
- protocol compatibility documented for MCP 2026 migration;
- legacy conflicting docs removed/archived;
- audit evidence preserved separately;
- CI detects tool/config/protocol/documentation drift before merge.