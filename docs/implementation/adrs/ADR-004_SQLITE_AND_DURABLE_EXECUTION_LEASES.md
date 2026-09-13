# ADR-004 — Retain SQLite at Current Scale; Add Durable Execution Leases

**Status:** Accepted  
**Date:** 2026-09-06

## Context
SQLite WAL is fast and appropriate for the current local/single-agent scale, but it permits one writer at a time and does not prevent two processes from executing the same external Task effects. Current same-task protection is a process-local Set.

## Decision
Retain SQLite as the persistence adapter for the current supported deployment. Add a durable Task execution lease with atomic acquire/renew/release and expiry/heartbeat. Treat the lease as correctness, while WAL/busy timeout remain storage concurrency controls. Re-evaluate client/server DB only after measured high-concurrent-write requirements.

## Alternatives
- Replace SQLite immediately with PostgreSQL: rejected as unsupported by current measured need and migration risk.
- Rely on process-local Set/WAL locks: rejected; neither is cross-process execution ownership.
- Add Redis lock: rejected; unnecessary new infrastructure for current topology.

## Consequences
New lease table/repository and two-process tests. Multi-process correctness improves without speculative distributed architecture.

## Findings
HIGH-13, MED-17, MED-18, MED-20; performance root cause E.

## Validation
Two independent OS processes race same Task, one lease winner; expiry takeover tested; SQLite benchmarks remain acceptable.