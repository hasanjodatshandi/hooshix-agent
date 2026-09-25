# Retained EAAP v0.1 product scope — frozen standalone input summary

**Original source inspected:** D:\EAAP_Initial_Documentation_v0.1 (README, product vision/capability map, platform/agent/workflow/device/model/integration/memory/security/data/scale/testing docs, phase roadmap, and the later explicit `virtual-execution-and-digital-workers.md`). This is a **self-contained derived capability baseline** to hand to the implementer instead of the old independent architecture. Source timestamp in original README: 2026-08-19; virtual-endpoint clarification added 2026-09-20. Preserve original EAAP docs in place; the present folder governs only the new integration proposal.

## Product intent
Self-hosted enterprise agentic automation: human employees and AI-powered digital employees collaborate on business tasks across web chat, deterministic workflows, APIs, MCP, databases/SaaS, server-only workers, browsers and registered Windows/macOS/Linux physical and virtual computers. The platform, not the model, is orchestrator, memory, policy, budget and execution manager. Supports per-user/worker persistent memory, local/private AI first class, optional organization-approved external specialist models, teach by demonstration, RPA/computer use, human approvals, IDP, process/task mining, audit/replay, controlled scale and fully air-gapped deployment. Initial product name EAAP is working label.

## User and workflow promises
A user can request real work in chat; different user agents retain scoped memory across conversations; workflow designer schedules reusable versioned processes; a Digital Worker runs without an active chat; per-step policy and approval controls all side effects. Server-only workflows need no device. Device workloads can target authorized physical PC, VM guest or virtual desktop with an actual suitable OS/UI session; VM support is explicit and has unique guest identity. Hybrid server↔device flows remain durable across offline and human waits. External agent/workflow (e.g., NSN where a real compatible interface is documented) is a governed non-human principal, not a fake employee login or approver.

## Distinct feature groups
1. Core: organizations/users, chat/conversation, permanent memory, Digital Workers, tool registry, model gateway, definitions/scheduler/execution/audit/approvals, device/integration registry.
2. Enterprise automation: attended/unattended RPA, semantic desktop/accessibility/vision fallback, file/office/browser, action verification, record/replay/Teach Mode, dynamic agent planning/multi-agent delegation and bounded recovery.
3. Integrations: versioned typed REST/gRPC/MCP/webhook/database/SaaS connectors, external agent task handoff and validated callbacks.
4. Intelligence: local/private inference, model routing with external specialists, embeddings/RAG, OCR/IDP, knowledge, skill learning, process/task mining.
5. Governance: RBAC+ABAC, SSO, tenant isolation, egress/DLP, credentials, model/tool/device policies, HITL/dual control, audited version/promotion, quota/cost/eval, retention and replay.
6. Deployment: on-prem connected/restricted/air-gap, offline image/model/update bundles, production readiness and eventually independently scaled worker/gateway/inference/HA profiles.

## EAAP original roadmap retained as feature-trace tracks
0 foundation, 1 core/server automation, 2 memory+digital workers+workflow designer, 3 Windows RPA (physical and VM), 4 hybrid and external agent integrations, 5 macOS/Linux+enterprise hardening/air-gap/HA, 6 IDP/mining/multi-agent intelligence, 7 demand-led ecosystem/scale. Original fixed calendar/team figures were **planning estimates for a different greenfield architecture**, not dates for HooshiX adaptation.

## Original EAAP architecture proposals deliberately **not** transferred as mandates
Java modular-monolith Control Plane, single canonical PostgreSQL table ownership, Temporal runtime, Rust native agent, C# bridge, Swift bridge, llama.cpp, pgvector, S3, HA Kubernetes topology and particular versions were old *candidate implementation choices*. The user has explicitly directed that **existing HooshiX microservice architecture and technology/security baseline take precedence**. Preserve product outcomes and desired user scenarios; decide technology/ownership compatibility under effective HooshiX ADRs. A proposed EAAP runtime or monolith may not be installed merely by appearing in an old list.

## Detailed governing specifications within this package
Use 02 for normative requirement IDs P-01..P-24, 04 for target ownership/topology, 05/06 for delivery dependencies, 07–14 for domain design, 15–18 for security/data/testing/Production, 19/20 for execution/decisions. This snapshot is explanatory and is not a second conflicting implementation authority.
