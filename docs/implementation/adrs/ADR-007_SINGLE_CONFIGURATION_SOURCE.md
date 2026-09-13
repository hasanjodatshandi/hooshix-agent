# ADR-007 — Single Typed Configuration Source & Production Runbook

**Status:** Accepted  
**Date:** 2026-09-06

## Context
Current source, Docker, watchdog, legacy batch/setup and dead config file disagree on token names, startup behavior and health checks. Non-interactive Node PATH also drifted.

## Decision
One typed immutable `AppConfig` is loaded/validated at infrastructure startup from a canonical `HOOSHIX_*` namespace. Security-sensitive stale variables fail fast; aliases are bounded/deprecated explicitly. `process.env` is not read outside config/bootstrap. One production runbook documents supported local/public paths. Startup logs safe effective configuration and runtime versions.

## Alternatives
- Continue multiple launch scripts with comments: rejected; already produced confirmed drift.
- Keep inert JSON config as convenience: rejected.

## Consequences
Legacy scripts/docs must migrate or be removed; service/watchdog become deterministic; configuration changes become testable.

## Findings
HIGH-11, HIGH-12, MED-15, MED-16, MED-29, LOW-05/12.

## Validation
Stale `MCP_API_KEY` rejection, weak secret rejection, public-base/host/CORS validation, service-like Node/pnpm preflight, docs/config consistency tests.