# Deprecated: historical Node.js MCP setup notes

This file describes a legacy setup flow and is **not** an active operations guide. In particular, old instructions for bootstrap secrets used as bearer tokens, query-string credentials and authenticated liveness probes are invalid for the current OAuth HTTP server.

Use the current local/Compose configuration, healthcheck, credential migration, and rollback boundaries in:

- `docs/implementation/R7_LOCAL_OPERATIONS_RUNBOOK_2026-09-23.md`
- `docs/implementation/18_CONFIGURATION_OPERATIONS_RUNBOOK_SPEC.md` (target contract)
- `docs/implementation/22_ACCEPTANCE_GATES_DEFINITION_OF_DONE.md` (G7/G10 acceptance)

The R9 documentation cutover will replace remaining legacy README/runbook sections. Do not restart or redeploy an active server solely because this historical note has changed.
