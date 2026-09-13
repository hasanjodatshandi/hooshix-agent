# ADR-001 — Full Hexagonal + Clean Architecture

**Status:** Accepted  
**Date:** 2026-09-06

## Context
The audit classifies current architecture as only partially Clean/Hexagonal, with concrete core-to-service/persistence/security dependencies and duplicated inbound tool paths. The owner explicitly requires full-project Hexagonal Architecture + Clean Architecture even if a complete restructure is necessary.

## Decision
Adopt enforceable inward dependency rules:
- Domain is pure and infrastructure-free.
- Application depends only on Domain and application-owned ports.
- Inbound adapters depend on application use cases only.
- Outbound adapters implement application-owned ports.
- Infrastructure/bootstrap composes dependencies.
- Architecture tests make forbidden dependency edges CI failures.

Temporary legacy coexistence is allowed only during strangler migration; final state is not hybrid.

## Alternatives considered
- Incremental fixes inside current layer structure: evidence says sufficient minimum, rejected by owner scope.
- DI framework-heavy redesign: rejected; explicit composition root is preferred.
- Microservices: rejected; unrelated to audited problems.

## Consequences
Large file/module movement and API refactoring; stronger testability and boundary enforcement; migration risk managed by R0-R10 gates.

## Findings
MED-26, MED-27, MED-28 plus root causes A/G.

## Validation
Architecture import tests, zero forbidden edges at R9, all direct/Task routes converge through application use cases.