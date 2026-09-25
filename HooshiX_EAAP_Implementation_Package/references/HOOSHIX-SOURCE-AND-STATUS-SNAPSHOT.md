# HooshiX audited input — dated source/status and verification pointers

**Snapshot date:** 2026-09-20. Canonical checkout `/home/coder/workspace/Hooshix`, accessible from Windows as `\\wsl.localhost\Ubuntu\home\coder\workspace\Hooshix`. Observed branch `stage9-conversation-activation`, HEAD `f4746b5`, clean state at inspection. Current state may change at any time: **fresh Git/source/ADR review is mandatory**.

## Inspected primary source locations
- `AGENTS.md`: current source priority, critical security invariants, DDD/Hexagonal and microservice boundaries, PR workflow, service DB isolation and required final evidence vocabulary.
- `README.md`: actual running local-integrated vs production-fidelity lanes and honest distinction from Production.
- `docs/architecture/README.md`, `docs/adr/decision-register.md`, `docs/architecture/platform-architecture.md`: effective architecture and product/runtime boundaries.
- `docs/architecture/implementation-status.md`, `docs/architecture/APPLICATION-IMPLEMENTATION-ROADMAP.md`, `docs/architecture/ENGINEERING-HARDENING-ROADMAP.md`: exact source/evidence vs planned targets, current Stage 9 and deferred production track.
- `docs/architecture/services/conversation-service.md`, ADR-0054/0057 and actual `services/conversation-service/` source: first bounded private text Conversation/ModelRun, no general agent/tools/workflow.
- `apps/web-frontend/src/features/conversation/ConversationFlow.tsx`: scoped chat and bounded run polling/cancel; no EAAP workflow canvas.
- `services/conversation-service/src/main/resources/application.yaml`: provider execution disabled by default, canary default zero.
- `services/conversation-service/src/main/java/com/sajtech/conversation/infrastructure/provider/openai/OpenAiResponsesAdapter.java`, `infrastructure/model/GitGovernedModelPolicyProvider.java`, `application/service/ModelRunWorker.java`: fixed OpenAI Responses adapter/no-tools model policy, bounded durable model call worker (not workflow runtime).
- `services/conversation-service/src/main/resources/db/migration/V1__create_conversation_foundation.sql`: tenant-scoped conversation/message/run DB design and RLS.
- `services/identity-service/`, `authorization-service/`, `notification-service/`, `compromised-password-service/`, `web-bff/`, `contracts/protobuf-contracts/`, `infrastructure/`, `deploy/`, `mlops/`, `context/`: existing independent service owners, neutral contracts, production design/verification tools and developer-only Git context.

## Binding HooshiX decisions to preserve
Existing Java 25/Spring Boot 4.1.x microservice architecture with DDD/Hexagonal ports and independent service-owned build, data, Flyway, release; React+TypeScript BFF-only browser contract; exact online Authorization and local owner invariants, forced tenant RLS/secure identity; synchronous gRPC/Protobuf and guarded async Kafka/Outbox/Inbox; current secrets, MFA, JIT admin, edge/WAF, Istio/Calico/Kyverno, telemetry privacy, artifact signing/scan/admission and cold-DR. Initial `production-single-server` only, HA is separately approved expansion. The existing Context/Ops/Desktop developer-host MCP runtime is independently versioned Windows software (ADR-0051), not an enterprise production device mesh. This package does not claim an independent EAAP user-memory implementation merely because Git-native Context Engine exists.

## Fresh verification commands/policy
Run only in authorized current checkout under current project instructions: `git status --short --branch`, `git rev-parse HEAD`, `git log`, review `origin/main`, `make context-verify`, `make context-bootstrap`, `make baseline-verify` and applicable service/frontend/contract tests. Avoid destructive `git reset/clean` or unauthorized direct main commits. If current source disagrees with this dated snapshot, current source wins and package reconciliation/PR is required before any dependent implementation.

## Design vs execution evidence
Local code/integration evidence for current services is meaningful; production deployment/HA/air-gap/complete EAAP lifecycle is NOT VERIFIED by these sources. Do not assign implementation percentage based only on count of files or listed services. Code/test coverage of a feature is distinct from successful live provider use, complete end-to-end application and enterprise release readiness.
