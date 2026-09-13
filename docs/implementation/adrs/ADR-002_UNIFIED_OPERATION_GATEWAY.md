# ADR-002 — Unified Operation Catalog and ExecuteTool Gateway

**Status:** Accepted  
**Date:** 2026-09-06

## Context
Authorization, permissions, approval and tool metadata are duplicated across MCP registrations, task executor handlers, capability maps and services. Confirmed exploits exist because callers can choose paths with different enforcement.

## Decision
Every externally invokable operation has one canonical `OperationDescriptor`. All effectful execution tools enter one `ExecuteToolUseCase` before any outbound adapter call. Direct MCP and durable Task execution share that gateway. Authorization, workspace/sensitive-path constraints, approval/effect/idempotency policy derive from the canonical catalog/application policy.

Control-plane operations also use the same AuthorizationService even when they have dedicated use cases.

## Alternatives
- Add missing permission calls to current handlers only: rejected as insufficient against future drift.
- Put all policy in MCP middleware: rejected because Task/internal callers could bypass transport middleware.

## Consequences
Existing direct tool handlers and task executor handlers become thin inbound mappings/application handlers; duplicate capability/approval maps are removed.

## Findings
HIGH-01, HIGH-02, HIGH-03, MED-04, MED-06, MED-28.

## Validation
Catalog completeness test; no inbound->outbound shortcut; actual direct and Task regressions prove identical authorization behavior.