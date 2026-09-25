# Web UI, API, accessible product journeys and versioned authoring

**Requirements:** P-01/02/04/06/14/21/22. Existing React+TypeScript frontend and Web BFF remain; no direct browser-to-service/model/device/provider path.

## Navigation map
Use existing authenticated shell, tenant selection, MFA/session and localization foundations. Add owned routes/surfaces incrementally (names illustrative): Chat & task handoff; Workflow Library/Designer/Versions; Run Timeline/Execution Detail; Digital Workforce (workers/schedules/permissions/budgets); Action Center (human approvals and exceptions); Tools/Connections; Devices/VM Pools/Capabilities; Memory Manager; Models/Policies; Tenant Admin/Retention/Audit; Operations/Alerts. Every view scopes to selected tenant, masks secret/evidence and supports explicit loading, empty, offline, error, permission denied and stale-version states. Feature flags default off until BFF/owner contracts and authorization ready.

## Workflow designer contract
Visual editor is a UI for the **canonical versioned workflow definition** in 07, never independently runnable client-side logic. Editing creates draft with optimistic version; server validates graph/cycles/typed branches/authorization and publishes immutable version after required review. Display node location SERVER/DEVICE/AUTO and required capabilities, memory/tool/model policies, data-classification and effect severity. Explain read vs mutation, deadlines/retry/idempotency and human approval. Test-run sandbox cannot accidentally target Production connectors/VMs; promote reviewed definition references across Dev/Test/Prod without raw credentials.

## Digital Worker and device UI
Show explicit human owner, agent/non-human identity type, granted vs effective permissions, allowed devices and compatible OS/session states, connection status, memory scope and spend/step ceilings; no "run as administrator" default. VM guest may be unavailable while hypervisor host online; show guest identity and session separately. Clear Stop/Cancel and Revoke controls with warning that prior external effects may be irreversible. Distinguish operational approval from agent output review.

## Action Center
Display summary/redacted input, provenance, effect, exact resource and current authorization policy, requester worker/human, approver identity, expiry, expected version and decision evidence. Approval requires fresh human authentication/assurance per policy; CSRF protection and one-attempt AuthZ; no approval via impersonated callback. A decision is once-only; duplicate submission returns prior record, stale approval rejects, suspending owner invalidates future mutations.

## Chat integration
Existing Conversation text-only ModelRun remains intact. New 'execute task' request flows through BFF to Workflow/Agent owner only after reviewed contracts; chat UI presents run ID, progress stream/poll with bounded backoff and cancellation, approval item link, summarized result/evidence references. Never show model-only assertion as verified task completion. Sanitized model text rendering and no untrusted HTML/markdown execution; keep abort cleanup and per-tab isolation.

## Localization/accessibility/privacy
Retain existing bilingual Persian/English and RTL/LTR infrastructure. Keyboard-based workflow edit/inspect (non-drag fallback), semantic labels and error focus, WCAG-oriented test gates, IANA timezone for schedules, clearly disambiguated agent vs human labels, dark-mode/contrast where current design permits. No raw prompt/screenshot/token in URL, localStorage, analytics, telemetry labels or error toasts. Evidence preview requires short-lived authorized URL and redaction before external display.

## Browser APIs (illustrative; publish in existing BFF OpenAPI)
```text
POST /workflows/drafts                  (create draft)
POST /workflows/{id}/publish             (expectedVersion, approvalRef)
POST /executions                        (requestId, definitionId, version)
GET  /executions/{runId}                 (timeline/cursor)
POST /executions/{runId}/cancel          (idempotency key)
GET  /digital-workers                    (tenant-scoped)
POST /digital-workers/{id}/run            (policy-checked)
GET  /action-center                      (owner/approver-scoped)
POST /approvals/{id}/decide              (decision, expectedVersion, fresh proof)
GET  /devices                            (capabilities/session state)
GET  /memory                             (owner-scoped)
```
Endpoints/names are contract candidates; no route is implemented or promised by this document. Every route has BFF-owned schema, generated TS types, origin/CSRF/session/audience enforcement, bounded pagination, safe errors and API backward compatibility.

## UI testing
React component and RTL behavior tests, Playwright E2E for both locales, keyboard and axe scans; static generated API parity, auth+tenant switching, expired session/approval, duplicate publish/run, worker revoked mid-poll, offline VM, cancel/race, redacted screenshot, provider-disallowed error, low bandwidth/network interruption. No UI-only permission gate.
