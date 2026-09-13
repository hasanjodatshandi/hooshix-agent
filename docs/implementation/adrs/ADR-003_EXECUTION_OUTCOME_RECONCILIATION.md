# ADR-003 — Explicit Execution Outcomes and Reconciliation

**Status:** Accepted  
**Date:** 2026-09-06

## Context
Timeout/crash/audit failure can make persisted Task state disagree with real external side effects. Exactly-once execution cannot be guaranteed across filesystem/process/Git/package/network boundaries.

## Decision
HooshiX explicitly models execution receipts and outcomes: succeeded, failed-known, blocked, approval-required, outcome-unknown, reconciled-succeeded, reconciled-failed. A non-idempotent unknown outcome blocks automatic retry. Timeout requests termination and waits for bounded acknowledgement; crash recovery converts uncertain mutating work to unknown. Reconciliation is a real use case, automatic only where adapter evidence can prove state.

## Alternatives
- Blind at-least-once retry: rejected due duplicate side effects.
- Pretend exactly-once through SQLite transaction: impossible across external effects.
- Disable retries entirely: rejected; safe read/idempotent retries remain valuable.

## Consequences
More explicit state/receipt persistence and operator recovery workflow; truthful failure semantics; safer retries.

## Findings
HIGH-05, HIGH-06, HIGH-07, MED-05, MED-08/09 related lifecycle integrity.

## Validation
Crash-after-marker, cancellation race, all-fields hydration, reconciliation and audit-degradation tests.