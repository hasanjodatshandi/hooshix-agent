# HooshiX Documentation Index

This file is the map of the documentation hierarchy and establishes which
documents are **authoritative** versus **historical**. When a document and the
executable tests disagree, the tests are correct (see `ARCHITECTURE.md` and
`SECURITY.md`).

## Authoritative (shipped, kept current)

These are the source of truth for their subject. Update them when behavior
changes.

| Document | Subject |
|---|---|
| `README.md` (repo root) | Entry point, quickstart, tool summary |
| `ARCHITECTURE.md` | Deployed architecture and layering |
| `SECURITY.md` | Security model, workspace authority, permission levels |
| `OPERATIONS.md` | Canonical operations runbook (startup, health, recovery) |
| `TOOLS.md` | Generated tool inventory — regenerate with `node scripts/generate-tools-doc.mjs` |
| `RELEASE.md` | Release process and provenance |
| `MIGRATIONS.md` | Database migration history (one entry per released version) |
| `PROTOCOL_COMPATIBILITY.md` | MCP protocol compatibility surface |
| `implementation/20_FINDINGS_TRACEABILITY_MATRIX.md` | Audit finding status (single source for open/closed) |
| `implementation/adrs/ADR-00*` | Architecture decision records (immutable once accepted) |

## Implementation specs (`implementation/NN_*.md`)

Numbered design specs `00`–`32`. These define the intended design phase by
phase. They are reference material: where the shipped code and a spec diverge,
the code plus `ARCHITECTURE.md` wins, and the divergence should be recorded as
an ADR or a note in the spec.

## Historical / point-in-time evidence

Dated reports (`implementation/R0_*`, `R1_*`, `R6_*`, `R7_*`,
`*_YYYY-MM-DD.md`) are **frozen evidence snapshots** from a phase or audit. They
are not maintained after the fact; their conclusions are carried forward by the
specs above and by the traceability matrix.

| Document | Status |
|---|---|
| `FULL_AUDIT_2026-10-01.md` | Latest full audit (evidence-based, project-audit-skill); all 5 findings remediated in-session |
| `FULL_AUDIT_2026-09-30.md` | Prior full audit; finding status mirrored in the traceability matrix |
| `HOOSHIX_AUDIT_CONSOLIDATED_FINAL.md` | Earlier consolidated audit (superseded by the above for status) |
| `RELEASE_HARDENING_2026-09-19.md` | Early hardening pass evidence |
| `implementation/R7_LOCAL_OPERATIONS_RUNBOOK_2026-09-23.md` | Authoritative implementation runbook referenced by `OPERATIONS.md` |

## Release provenance

Released versions are recorded in `MIGRATIONS.md` (schema) and `RELEASE.md`
(process). The git history is the final provenance record: release commits
follow the `close <id>: <description>` convention so each finding closure is
traceable to a commit.
