# CI — Master Implementation Plan (Chat Isolation)

**تاریخ:** 2026-10-02
**baseline HEAD:** `93cab47` · tag `pre-ci-backup`
**مرجع طراحی:** بستهٔ `HooshiX_Chat_Isolation_Design_v1` (فایل‌های ۰۱–۱۴)
**اسناد ورودی:** `CI0_BASELINE_AUDIT_2026-10-02.md`، `CIG0_FEASIBILITY_GATE_2026-10-02.md`
**وضعیت:** `IN_PROGRESS` — شروع با مجوز صریح مالک

این پلن برگزیده (leaf-by-leaf) از فایل ۰۸ بستهٔ طراحی است، ولی **به کد واقعی مخزن تطبیق داده شده** — نام فایل‌ها، جدول‌ها، ابزارها و نمادهای موجود، نه نام‌های مفهومی سند. هر leaf شامل: precondition، تغییرات دقیق، تست، و معیار خروجی است.

---

## قواعد اجرایی همهٔ leafها

1. **هیچ mutation روی سرویس فعال بدون runbook و تأیید جداگانه.** restart سرور، migration روی DB تولید، rotate credential، یا تغییر workspace فعالِ سرویس ممنوع است، مگر فاز صریح rollout (CI-8).
2. **هر migration روی کپی DB آزمایشی اول تست می‌شود** (backup rehearsal)، بعد روی DB تولید در زمان تأییدشده.
3. **feature flag خاموش پیش‌فرض:** `CTX_ISOLATION_MODE=OFF` تا CI-8. همهٔ کدهای جدید behind flag و بدون تغییر رفتار پیش‌فرض.
4. **فقط فایل‌های همان leaf stage می‌شوند**؛ commit با مجوز صریح مالک.
5. **پس از هر leaf:** typecheck + build + full vitest + lint باید سبز باشد.
6. **ادعای محرمانگی per-chat تا CI-G7 ممنوع.**

---

## CI-1 — مدل دامنه و قرارداد هویت

**هدف:** existing نهادهای Context/Binding/Grant/Lease/Envelope را به‌صورت pure domain بساز، بدون هیچ وابستگی به MCP/SQLite. **هیچ رفتار فعلی تغییر نمی‌کند** (flag OFF).

### CI-1.01 — نهادهای دامنهٔ Context

**precondition:** CI-G0 برقرار (سند تصمیم).

**تغییرات (فایل‌های جدید، همهٔ additive):**
- `src/domain/context/context.ts` — `ContextId` (UUID)، `ContextState` (`ACTIVE | FROZEN | TRANSFERRING | ARCHIVED`)، `ContextEpoch` (integer ≥ 1)، invariantهای I-01/I-02/I-06.
- `src/domain/context/context-binding.ts` — `BindingId`، `ConnectionId`، `CredentialHash`، `BindingState` (`ACTIVE | REVOKED | EXPIRED`)، invariant I-07 (handoff binding قدیمی برای context جدید معتبر نمی‌ماند).
- `src/domain/context/workspace-grant.ts` — `GrantId`، `CanonicalRoot`، `AccessMode` (`READ_ONLY | READ_WRITE`)، `GrantVersion`.
- `src/domain/context/ownership-lease.ts` — `LeaseDeadline`، `FencingToken`.
- `src/domain/context/transfer-intent.ts` — `IntentId`، `Kind` (`TRANSFER | FORK`)، `IntentState` (`PREPARED | APPROVED | DRAINING | COMMITTED | CANCELLED | EXPIRED | FAILED`)، `TicketHash`، TTL.
- `src/domain/shared/ids.ts` — اضافه‌شدن `ContextId`، `BindingId`، `GrantId`، `ConnectionId` به bransدtyped IDs موجود.

**تست:** `tests/domain/context/context-invariants.test.ts` — state transitionهای مجاز/غیرمجاز، epoch monotonic، rejection rebinding.

### CI-1.02 — VerifiedPrincipal و ExecutionEnvelope

**تغییرات:**
- `src/domain/context/verified-principal.ts` — immutable `VerifiedPrincipal` (`ownerId`، `principalId`، `connectionId`، `credentialBindingId`، `scopes`).
- `src/domain/context/execution-envelope.ts` — immutable `ExecutionEnvelope` (`contextId`، `workspaceGrantId`، `contextEpoch`، `grantVersion`، `traceId`، `requestDeadlineMs`).
- `src/application/ports/outbound/context.port.ts` — پورت‌های `ContextResolver` (deny-by-default، `CONTEXT_NOT_BOUND` اگر binding نباشد)، `AuthorizationPolicy`، `OwnershipRepository`، `Clock`، `AuditSink`.

**تست:** port contract tests با injected fakes.

### CI-1.03 — error taxonomy

**precondition:** `src/core/errors.ts` یک union بسته از `ErrorCode` است (مهم: اضافه‌کردن کد جدید نیازمند توسعهٔ union است).

**تغییرات:**
- افزودن کدهای Context به union: `CONTEXT_NOT_BOUND`، `CONTEXT_INACTIVE`، `RESOURCE_UNAVAILABLE`، `SCOPE_INSUFFICIENT`، `WORKSPACE_DENIED`، `CONTEXT_EPOCH_STALE`، `HANDOFF_APPROVAL_REQUIRED`، `TRANSFER_IN_PROGRESS`، `HANDOFF_TOKEN_EXPIRED`، `WORKTREE_CONFLICT`.
- `src/application/services/handler-failure-classification.ts` — نگاشت این خطاها (به‌تمامی، `RESOURCE_UNAVAILABLE` برای existence-leak).
- **سازگاری:** کدهای قدیمی حفظ می‌شوند؛ کدهای جدید در حالت OFF هیچ‌وقت تولید نمی‌شوند.

**تست:** `tests/application/context-error-taxonomy.test.ts` — هر خطا از کد صحیح عبور می‌کند و `RESOURCE_UNAVAILABLE` برای موجود/موجود نشده یکسان است (anti-enumeration).

### CI-1.04 — injection tests

**تغییرات:** `tests/security/ci-identity-injection.test.ts` — spoofing `contextId` در tool arguments، spoofed `clientInfo`، header جعلی، issuer/audience نامعتبر، grant منقضی. همه باید fail-closed باشند.

**گیت CI-G1:** تمام domain testها سبز؛ union errors بسته است؛ هیچ ابزار قدیمی bypassی ندارد. **بدون تغییر رفتار production (flag OFF).**

---

## CI-2 — Control DB، صدور principal/connection مجزا و Binding

**هدف:** این مهم‌ترین گام سمت سرور است — رفع علت (الف) CI-G0: **هر connection یک principal مجزا و یک Context binding**.

### CI-2.01 — Migration 23: control tables

**precondition:** CI-G1. **اول روی کپی DB آزمایشی.**

**تغییرات:**
- `src/core/memory/database/migrations.ts` — migration `23` (`ci-control-schema`) با جداول:
  - `context_registry(context_id PK, owner_id, project_label, state CHECK, workspace_grant_id, storage_locator UNIQUE, context_epoch, created_at, updated_at)` + `idx_context_owner_state`
  - `context_binding(binding_id PK, owner_id, context_id FK, connection_id, credential_hash UNIQUE, credential_version, scopes_json, state CHECK, created_at, UNIQUE(connection_id, credential_version))` + `idx_binding_context`
  - `workspace_grant(grant_id PK, context_id FK, canonical_root, worktree_locator, access_mode CHECK, lease_id, grant_version, created_at)`
  - `ownership_lease(context_id PK FK, owner_binding_id FK, context_epoch, lease_deadline_ms, fencing_token, updated_at)`
  - `handoff_intent(intent_id PK, source_context_id FK, source_binding_id FK, target_connection_id, target_context_id, kind CHECK, state CHECK, source_epoch, ticket_hash UNIQUE, expires_at, approved_by_owner_id, approved_at, committed_at, created_at, UNIQUE(...))`
  - `security_audit(id PK, owner_id, context_id, binding_id, action, decision, trace_id, occurred_at)` + `idx_audit_context_time`
- `LATEST_MIGRATION_VERSION` 22 → 23.
- **قانون تازه (از درس migration 22):** هر جدولی که به base schema اضافه شود باید یک `migrate()` هم داشته باشد — در `docs/MIGRATIONS.md` ثبت می‌شود.

**تست:** `tests/core/ci-control-schema-migration.test.ts` + upgrade path روی DB قدیمی (الگوی `r6-idempotency-responses-upgrade.test.ts`) + backup rehearsal.

### CI-2.02 — صدور principal مجزا per connection

**precondition:** CI-2.01.

**تغییرات (این قلب رفع CI-G0):**
- `src/mcp/oauth.ts` — `issueCode` و `issueGrant` باید یک `connectionId` و `principalId` مجزا تولید/ذخیره کنند: یک principal در ازای هر (client_id، connection)؛ credential hash در `context_binding.credential_hash`.
- `src/mcp/http-server.ts:648` — پاس‌دادن connection identity به `issueCode`.
- `oauth_access_tokens` / `oauth_refresh_tokens` — ستون `connection_id` (migration 24).
- `principalBinding` باید به `sha256(principalId|connectionId|resource)` تغییر کند تا per-connection شود.

**سازگاری:** grantهای موجود (principal="operator") به یک **LEGACY Context** map می‌شوند (CI-2.03) — هیچ invalidate خودکار نمی‌شود (ADR-CI-007).

**تست:** `tests/mcp/ci-distinct-connection-principal.test.ts` — دو client DCR مجزا → دو principal مجزا → دو binding مجزا؛ refresh همان principal را حفظ می‌کند.

### CI-2.03 — Legacy Context پین‌شده

**تغییرات:**
- در زمان اولین باز شدن migration 23، یک Context `LEGACY` با owner_id یکتای تولید فعلی ساخته می‌شود و تمام grantهای موجود با principal="operator" به آن bind می‌شوند.
- **هیچ fallback به LEGACY برای connection جدیدی وجود ندارد** (I-06: unbound → `CONTEXT_NOT_BOUND`، نه آخرین workspace).
- Workspace فعلی (تک‌ریشهٔ فعال یا pool) به‌صراحت در Legacy Context pin می‌شود.

**تست:** `tests/core/ci-legacy-context-binding.test.ts` — رفتار production تغییری نمی‌کند (flag OFF) ولی mapping legacy معتبر است.

### CI-2.04 — Ownership lease با CAS

**تغییرات:** `src/adapters/outbound/persistence/sqlite/repositories/ownership-lease.adapter.ts` — `UPDATE ownership_lease SET context_epoch=context_epoch+1 WHERE context_id=? AND context_epoch=? AND owner_binding_id=?` با assert `changes===1` در همان transaction (الگوی `task-lease.adapter.ts` موجود).

**تست:** `tests/core/ci-ownership-lease-cas.test.ts` — رقابت هم‌زمان، crash/reopen idempotency.

### CI-2.05 — Context Resolver (deny-by-default)

**تغییرات:** `src/application/services/context-resolver.ts` — از credential hash → `(context_id, context_epoch, scopes, grant_version)`؛ unbound → `CONTEXT_NOT_BOUND`. در flag OFF فقط audit log می‌نویسد (SHADOW)؛ در ON اجرا می‌کند.

**گیت CI-G2:** دو binding متمایز به دو DB temp، هیچ cross-query؛ migration روی کپی DB با counts/hash برابر؛ **DB تولید دست‌نخورده**.

---

## CI-3 — حذف workspace سراسری و پوشش همهٔ ابزارها

**هدف:** T01/T02/T07 را ببندد. **این گام رفتار قابل‌مشاهده دارد** و نیازمند rollout می‌شود.

### CI-3.01 — از بین بردن `activeWorkspace` سراسری

**precondition:** CI-G2. **بزرگ‌ترین تغییر خطرناک برنامه.**

**تغییرات:**
- `src/security/workspace-guard.ts` — حذف `let activeWorkspace` و `let workspaceRoots` به‌نفع یک `ContextScopedWorkspaceRegistry` که با `envelope.contextId` key می‌شود.
- `src/mcp/http-server.ts` — `modernContexts` به‌جای `principalBinding`، به `contextId` key شود (و در نتیجه per-connection).
- `set_workspace` به یک عملیات محلی روی `workspace_grant` (نسخهٔ جدید grant) تبدیل می‌شود؛ precondition: هیچ Task متصل به grant قدیمی در حال اجرا نباشد.
- **fallback:** در flag OFF، رفتار قدیمی حفظ می‌شود.

**تست:** `tests/core/ci-cross-workspace-interference.test.ts` — ۱۰۰۰ درخواست interleaved در ۲ context؛ هیچ cross result/side effect.

### CI-3.02 — تمام ابزارها از envelope عبور می‌کنند

۵۳ ابزار موجود (۲۹ step-executable + ۲۴ control). فهرست کامل: `docs/TOOLS.md`. هر handler باید envelope بگیرد و context را re-check کند:
- File tools (`read_file`، `write_file`، `create_file`، `modify_file`، `delete_file`، `restore_file`، `search_files`، `list_directory`) — از `filesystem-service.ts` که canonical root را از grant می‌خواند.
- Git tools (`git_status`...`git_init`) — repo از Context resolve.
- `execute_command` — cwd از grant.
- `task_*` / `project_*` / `memory_*` — repository filter با `context_id` (در کنار `principal_id` موجود).
- `restore_file` — ownership + capability version قبل از restore.

**تست:** traversal و existence-leak tests برای هر handler.

### CI-3.03 — Repositoryها context-bound

**تغییرات:**
- ستون `context_id` به جداول حساس (migration 25): `tasks`، `task_steps`، `projects`، `memory_items`، `approval_requests`، `file_backups`، `agent_checkpoints`، `recovery_events`، `executions`، `tool_calls`، `idempotency_responses`.
- الگوی `principalScopedMemory` موجود به `contextScopedRecord` تعمیم می‌یابد: `WHERE id=? AND context_id=?`.
- **هیچ naked `WHERE id=?`ای نباید باقی بماند** — static review در gate.

**تست:** `tests/security/ci-idor-matrix.test.ts` — برای هر ابزار: B با ID معروف A → `RESOURCE_UNAVAILABLE` یکسان با ID ناموجود + state A ثابت.

### CI-3.04 — cache/log/metrics per-context

- کلید cache شامل `contextId` + `grantVersion`؛ TTL ≤ lifetime binding.
- `agent_metrics` و logها context-scoped.

### CI-3.05 — multi-process test

**تست:** `tests/e2e/ci-two-process-isolation.test.ts` — ۲ worker واقعی، ۱۰۰۰ درخواست interleaved، no global root switching.

**گیت CI-G3:** ۱۰۰٪ handler coverage؛ spoof-ID، path traversal، concurrent root-switch tests PASS.

---

## CI-4 — OS Worker و Git/Data isolation

### CI-4.01 تا CI-4.05

- per-context filesystem + DB locator (layout `<data-root>/contexts/<context-A>/...`).
- **PLATFORM SPIKE (ADR-CI-006):** ویندوز restricted token/Job Object؛ لینوکس/WSL uid+mount namespace. این نیاز به تحقیق روی نسخهٔ ویندوز دارد و ممکن است BLOCKED شود — در آن صورت محدودهٔ ادعا به logical isolation محدود می‌شود (صادقانه).
- repo strategy: worktree جدا برای جداسازی اجرایی، clone مستقل برای محرمانگی history.
- negative tests: NTFS junction/UNC/symlink، `node -e` خواندن DB دیگر، concurrent commits.

**گیت CI-G4:** cross-context read در worker واقعی FAIL CLOSED.

---

## CI-5 — Plan/Task/Approval fencing و Durable Queue

- `TaskExecutionContext` (دازو موجود در `src/application/dto/legacy-task-plan.ts:32`) ستون‌های `contextId`، `workspaceGrantId`، `ownershipEpoch`، `createdByBindingId` می‌گیرد.
- `task_leases` موجود (با fencing version) به ownership_lease متصل می‌شود.
- epoch recheck پیش از هر side effect؛ `OUTCOME_UNKNOWN` به‌جای re-run.
- stress test: ۱۰۰ task هم‌زمان روی ۱۰ context.

**گیت CI-G5:** non-interference پایدار، zero double execution.

---

## CI-6 — Owner Console و انتقال کنترل

- APIهای `/admin/*` (هیچ‌گاه به‌عنوان MCP tool منتشر نمی‌شوند) با session جدا، CSRF، reauth، one-time ticket.
- `context_request_handoff` فقط intent می‌سازد؛ ticket secret هرگز به مدل داده نمی‌شود.
- Transfer دوفازی: prepare → approve → freeze+epoch → drain → atomic rebind → audit.
- Fork: snapshot sanitized بدون secret/approval/lease.

**گیت CI-G6:** چت سقف‌خورده → Owner Console transfer → چت جدید از checkpoint ادامه می‌دهد؛ چت قدیمی deny.

---

## CI-7 — ChatGPT اتصال واقعی

- دو connection مستقل واقعی (مدل C) یا host attestation (مدل H).
- فقط پس از CI-2، روی endpoint آزمایشی مجزا.
- ثبت نتیجهٔ نهایی: سطح A / B / C.
- **در اینجا است که سؤال اصلی فایل ۰۱ پاسخ داده می‌شود.**

**گیت CI-G7:** دو چت واقعی، ۲ connection معتبر، ۱۰۰٪ request context match.

---

## CI-8 — Shadow rollout و rollout محدود

- `CTX_ISOLATION_MODE=OFF|SHADOW|PER_CONNECTION|HOST_ATTESTED` (فایل ۱۰ §2).
- SHADOW فقط policy جدید را محاسبه + audit می‌کند، اجرا نمی‌کند.
- rollout روی یک project غیرحساس اول؛ rollback rehearsal پیش از cutover.

**گیت CI-G8:** rollback اجرا و تأییدشده.

---

## CI-9 — تحویل نهایی

- full suite، ۲ OS هدف، benchmark قبل/بعد.
- مستندات نهایی: API/schema/runbook/migration ledger.
- امضای مالک برای فعال‌سازی سطح A.

**گیت CI-G9:** owner acceptance ثبت شده.

---

## وابستگی‌ها و مسیر بحرانی

```text
CI-1 (domain) ──► CI-2 (control DB + principal مجزا) ──► CI-3 (workspace/tool scoping)
                                      │                            │
                                      └──► CI-5 (task fencing) ─────┘
                                                                   │
                          CI-4 (OS isolation — parallel/spike)    │
                                                                   ▼
                                                        CI-6 (Owner Console + transfer)
                                                                   │
                                                                   ▼
                                                        CI-7 (real ChatGPT test) ← سؤال اصلی
                                                                   │
                                                        CI-8 (rollout) → CI-9 (delivery)
```

**مسیر بحرانی:** CI-1 → CI-2 → CI-3 → CI-7. CI-4 و CI-5 موازی هستند.

**توقف‌های اجباری:** CI-G7 (تأیید میزبان) و CI-G8 (rollback rehearsal) بدون رد شدن، rollout ممنوع است.

---

## وضعیت فعلی و قدم بعدی

| گیت | وضعیت |
|---|---|
| CI-G0 | ✅ تصمیم سندبندی شده (`SERVER_SIDE_READY / HOST_VERIFICATION_PENDING`) |
| CI-G1 | ✅ **تأیید شد** — CI-1.01 تا CI-1.04 کامل؛ ۹۳۴ تست / ۲۰۳ فایل سبز؛ G1 global + R7 secret policy PASS؛ build تمیز |
| CI-G2 | 🔄 در حال اجرا — CI-2.01 کامل، بعدی CI-2.02 |
| CI-G3..CI-G9 | ⬜ NOT_STARTED |

### CI-1 — انجام‌شده (commit نشده)

| leaf | خروجی | فایل‌ها |
|---|---|---|
| CI-1.01 | نهادهای دامنهٔ Context، Binding، WorkspaceGrant، OwnershipLease، TransferIntent + typed IDs | `src/domain/context/{context,context-binding,workspace-grant,ownership-lease,transfer-intent}.ts`، `src/domain/shared/ids.ts` |
| CI-1.02 | VerifiedPrincipal، ExecutionEnvelope، پورت‌های ContextResolver/AuthorizationPolicy/OwnershipRepository/GrantRepository/AuditSink با discriminated union deny-by-default | `src/domain/context/{verified-principal,execution-envelope}.ts`، `src/application/ports/outbound/context.port.ts` |
| CI-1.03 | ۱۰ کد خطای CI + کلاس‌های sentinel + نگاشت در classifier (با anti-enumeration) | `src/core/errors.ts`، `src/application/services/handler-failure-classification.ts` |
| CI-1.04 | تست‌های تزریق: spoofed contextId، cross-Context envelope، replayed epoch، FROZEN fallback، scope denial | `tests/ci/ci-1-04-identity-injection.test.ts` |

تست‌ها: `tests/ci/ci-1-0{1,2,3,4}-*.test.ts` — ۴۵ تست.

### CI-2.01 — انجام‌شده (commit نشده)

- migration `23` (`ci-control-schema`) با شش جدول: `context_registry`، `context_binding`، `workspace_grant`، `ownership_lease`، `handoff_intent`، `security_audit` — با CHECKهای state، UNIQUEهای binding، FKها و indexها.
- **طراحی:** جداول فقط در migration ساخته می‌شوند (نه base-schema) تا fresh-only gap نباشد؛ `runMigrations` روی DB تازه و قدیمی هر دو اجرا می‌شود.
- **additive:** هیچ مسیر تولیدی‌ای این جداول را نمی‌خواند تا `CTX_ISOLATION_MODE=OFF` است.
- **backup rehearsal اجرا شد:** migration روی کپی دیتابیس تولید (۱۱۲۵ task واقعی) اعمال شد — head 22→23، شش جدول ایجاد شد، `integrity_check=ok`، `foreign_key_check=[]`، re-run no-op، هیچ row موجودی دست‌نخورد.
- `LATEST_MIGRATION_VERSION` 22 → 23 و `docs/MIGRATIONS.md` به‌روز شد.
- تست مسیر upgrade در `tests/core/r6-idempotency-responses-upgrade.test.ts` برای شبیه‌سازی head قبل از 22 به‌روز شد (اثر جانبی طبیعی اضافه‌شدن migration).
- `tests/ci/ci-2-01-control-schema-migration.test.ts` — ۸ تست (fresh، upgrade، idempotent، PKها، FK، CHECK، UNIQUE).

**leaf بعدی:** **CI-2.02** — صدور principal/connection مجزا per connection. این قلب رفع CI-G0 است: `issueCode`/`issueGrant` یک `connectionId` و `principalId` مجزا تولید و در `context_binding` ذخیره می‌کنند.
