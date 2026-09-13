# ADR-008 — Observability Failure Cannot Falsify Known Effect Outcome

**Status:** Accepted  
**Date:** 2026-09-06

## Context
Audit proved post-effect logging failure can return caller-visible failure after a side effect succeeded, potentially triggering duplicate retries. Redaction and metrics-format gaps also exist.

## Decision
Business/effect outcome and observability sink outcome are separate axes. Required pre-effect compliance intent may block an effect if configured, but post-effect audit/metrics failure cannot convert known success to failed. Application emits one sanitized event model to ports; adapters persist/render it. Degradation is observable and does not recursively fail the operation.

## Alternatives
- Swallow all telemetry failures silently: rejected; loses incident visibility.
- Treat audit failure as operation failure: rejected after confirmed false-failure PoC.

## Consequences
Result envelopes include observability-degraded state; Task retry logic ignores post-effect telemetry failure; audit adapters share centralized redaction.

## Findings
MED-02, MED-05, MED-18/19/20/25 related observability integrity.

## Validation
Audit sink failure after effect -> success + degraded; opaque secret redaction; Prometheus grammar; retention/session bounds.