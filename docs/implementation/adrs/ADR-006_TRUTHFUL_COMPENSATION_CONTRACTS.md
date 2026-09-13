# ADR-006 — Truthful Compensation Contracts

**Status:** Accepted  
**Date:** 2026-09-06

## Context
Current Git rollback can destroy dirty pre-task work, package rollback restores manifests but reports full rollback, and file restore can overwrite newer state or change semantics on repeated absent-state restores.

## Decision
Compensation APIs claim only provable guarantees:
- Git snapshot/rollback initially supports clean repositories only.
- Package compensation is named/typed manifest restore unless installed environment reversal is verified.
- File backup snapshot state is immutable; target is canonical absolute path; normal restore requires post-mutation revision match; historical overwrite is explicit high-risk approved operation.

## Alternatives
- Capture arbitrary dirty Git tree now: possible but large scope; not needed for first truthful release.
- Keep old names with warning: rejected because state/status consumers still misinterpret success.

## Consequences
Some previously accepted operations are rejected or renamed/deprecated; stronger integrity and clearer recovery.

## Findings
HIGH-08, HIGH-09, MED-10, MED-11, MED-12, MED-07.

## Validation
Dirty repo rejection, clean rollback verification, manifest-only package result, revision-conflict restore, repeated absent restore, absolute-target tests.