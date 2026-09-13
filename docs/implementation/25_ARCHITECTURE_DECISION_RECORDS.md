# Architecture Decision Records — Index

These ADRs freeze the major design decisions needed to execute the owner-mandated full Hexagonal/Clean redesign. They are normative unless superseded by a later ADR.

| ADR | Decision | Status | Findings / drivers |
|---|---|---|---|
| ADR-001 | Full Hexagonal + Clean dependency architecture | Accepted by owner directive | MED-26/27/28, audit §31 |
| ADR-002 | One Operation Catalog + one ExecuteToolUseCase gateway | Accepted | HIGH-01/02/03, MED-04/06/28 |
| ADR-003 | Explicit execution receipts, `outcome_unknown`, reconciliation; no exactly-once claim | Accepted | HIGH-05/06/07, MED-05 |
| ADR-004 | Retain SQLite for current scale + durable execution lease | Accepted | HIGH-13, MED-17/18/20 |
| ADR-005 | Bootstrap secret separate from issued expiring OAuth access/rotating refresh tokens | Accepted | HIGH-04/11, MED-01/03/29 |
| ADR-006 | Truthful compensation: clean Git rollback + package manifest restore + revision-guarded file restore | Accepted | HIGH-08/09, MED-10/11/12 |
| ADR-007 | One typed configuration source and one production runbook | Accepted | HIGH-11/12, MED-15/16, LOW-05 |
| ADR-008 | Telemetry failure cannot falsify a known business effect outcome | Accepted | MED-02/05/25 |
| ADR-009 | Migrate to MCP TypeScript SDK v2 and make 2026-07-28 modern protocol primary | Accepted target; legacy compatibility window to verify during implementation | MED-22/28/29, HIGH-04, owner latest-doc requirement |
| ADR-010 | Workspace authority is principal/task scoped, never global mutable authorization state | Accepted | HIGH-01/02, MED-04/28 |
| ADR-011 | Strangler migration with mandatory final deletion of legacy duplicate paths | Accepted | MED-26/27/28, LOW-03/05/12, owner architecture directive |

Individual records are stored under `implementation/adrs/`.

---

## ADR governance

An implementing assistant may not silently reverse an accepted decision. If current official documentation or executable evidence makes a decision invalid:

1. create a superseding ADR;
2. cite the new external/current evidence;
3. identify affected findings/docs/tasks/tests;
4. update this index;
5. obtain owner approval when the change alters the explicit full Hexagonal/Clean scope or security guarantee.

Minor implementation details that stay within a decision do not need a new ADR.

---

## Required ADR format

Each ADR contains:
- status/date;
- context;
- decision;
- alternatives considered;
- consequences/tradeoffs;
- migration implications;
- affected audit findings;
- validation/evidence.

---

## Decisions intentionally NOT made

No ADR currently mandates:
- PostgreSQL;
- Redis/message broker;
- microservices;
- CQRS/event sourcing;
- DI container framework;
- Kubernetes;
- true OS sandbox/container-per-command;
- replacing Vitest.

These require future evidence/requirements and are not necessary to satisfy the audit or owner architecture mandate.