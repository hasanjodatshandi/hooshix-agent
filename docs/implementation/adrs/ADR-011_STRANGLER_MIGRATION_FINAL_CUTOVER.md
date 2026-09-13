# ADR-011 — Strangler Migration With Final Legacy Deletion

**Status:** Accepted  
**Date:** 2026-09-06

## Context
The owner requires a full Hexagonal/Clean redesign, while the current repository contains a heavily dirty working tree and several validated implementation primitives that must be preserved. A big-bang rewrite would increase the probability of destroying pre-existing work or regressing known-good controls.

## Decision
Use a staged internal strangler migration:

1. create Domain/Application/Ports beside legacy code;
2. wrap proven-safe legacy primitives behind temporary outbound compatibility adapters where necessary;
3. migrate vertical slices through the new application boundary;
4. run regressions and the relevant acceptance gate;
5. prove the old route has zero production references;
6. delete the old route;
7. repeat until all behavior uses the new architecture;
8. final release contains no hybrid legacy/new execution architecture.

Temporary routing flags may exist only during migration, must be typed and documented, must have explicit removal criteria, and can never bypass the new authorization boundary.

## Alternatives considered
- Big-bang rewrite in one changeset: rejected because of dirty baseline and regression risk.
- Permanent dual legacy/new modes: rejected because dual execution paths are an audited root cause.
- Reset/rebuild from branch HEAD: rejected because the current working tree is the intended baseline and contains pre-existing user work.

## Consequences
- Migration is slower but reviewable and safer.
- Temporary duplication is allowed but tracked as debt with an owner/removal phase.
- Final R9/R10 gates become mandatory to prevent compatibility paths from surviving indefinitely.

## Findings / drivers
MED-26, MED-27, MED-28, LOW-03/05/12, plus owner architecture directive.

## Validation
R9 proves zero legacy direct execution references, architecture rules pass, no compatibility routing remains without an explicit superseding decision, and final R10 validation is run from the intended reproducible build path.
