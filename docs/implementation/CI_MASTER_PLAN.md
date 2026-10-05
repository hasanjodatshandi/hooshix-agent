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

۵۴ ابزار موجود (۳۰ step-executable + ۲۴ control). فهرست کامل: `docs/TOOLS.md`. هر handler باید envelope بگیرد و context را re-check کند:
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

- ✅ `TaskExecutionContext` (دازو موجود در `src/application/dto/legacy-task-plan.ts:32`) ستون‌های `contextId`، `workspaceGrantId`، `ownershipEpoch`، `createdByBindingId` می‌گیرد — چهار فیلد اختیاری، همراه با migration 25 که ستون‌های متناظر را روی `tasks` اضافه می‌کند (`context_id`، `workspace_grant_id`، `ownership_epoch`، `created_by_binding_id`).
- ✅ `task_leases` موجود (با fencing version) به ownership_lease متصل می‌شود — `task_leases.context_id` در همان INSERT که lease را acquire می‌کند، از `tasks.context_id` خوانده و نوشته می‌شود.
- ✅ epoch recheck پیش از هر side effect؛ `OUTCOME_UNKNOWN` به‌جای re-run — fence داخل transaction همان receipt STARTED اجرا می‌شود (`assertContextOwnershipForTask`)، تصمیم pure در `domain/context/ownership-fence.ts`، و loop خطای fence را به یک step ترمینال `outcome_unknown` با reason `outcome_unknown_requires_reconciliation` تبدیل می‌کند (هرگز retry نمی‌شود).
- ✅ stress test: ۱۰۰ task هم‌زمان روی ۱۰ context — `tests/ci/ci-g5-task-fencing.test.ts` (۱۹ تست): migration head، persistence ستون‌ها، اتصال task_leases، تصمیم pure fence، receipt تحتOwnership زنده، و پارتیشن‌بندی دقیق fence بر اساس context وقتی نیمی از contextها transfer می‌شوند.
- **توجه:** fencing token عمداً روی Task ذخیره نمی‌شود — با epoch در lockstep می‌چرخد، پس تطابق (epoch, binding) اثبات می‌کند. ذخیره آن یک secret روی ردیفی بود که هر tool write آن را لمس می‌کرد، بدون تضمین اضافه.

**گیت CI-G5:** non-interference پایدار، zero double execution. ✅ — fence پیاده‌سازی و تست شد؛ sections بعدی (durable queue) در CI-G6..G9.

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
| CI-G2 | ✅ **تأیید شد** — CI-2.01 تا CI-2.05 کامل؛ ۹۷۸ تست / ۲۰۸ فایل سبز؛ G1 global + R7 secret policy PASS؛ build تمیز |
| CI-G3 | ✅ **تأیید شد** — SHADOW mode به مسیر درخواست متصل شد؛ تست e2e روی سرور زنده |
| CI-G4 | ✅ **تأیید شد** — PER_CONNECTION enforcement روی مسیر زنده: resolution غیرRESOLVED درخواست را با ۴۰۳ و sentinel ثابت رد می‌کند؛ fail-closed |
| CI-G5 | ✅ **تأیید شد** — Task fencing کامل: migration 25 (ستون‌های `tasks` + `task_leases.context_id`)، اتصال resolution به identity و task creation، epoch fence در transaction receipt، terminal `outcome_unknown` بدون retry؛ ۱۹ تست جدید |
| CI-G6 | ✅ **تأیید شد** — Owner Console و انتقال کنترل: CI-G6a (port + adapter + سرویس دو فازی + rebind اتمیک، ۱۸ تست) و CI-G6b (مسیرهای `/admin/*` با session/CSRF/reauth جدا، ۸ تست live) |

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

### CI-2.02 — انجام‌شده (commit نشده)

- **feature flag** `CTX_ISOLATION_MODE` با چهار حالت `OFF | SHADOW | PER_CONNECTION | HOST_ATTESTED` (طراحی فایل ۱۰ §2). پیش‌فرض `OFF`؛ مقدار نامعتبر **با خطای واضح** رد می‌شود تا یک typo نتواند حالت را خاموش/روشن کند.
- **migration 24** (`ci-binding-principal-id`): ستون NOT NULL `context_binding.principal_id` — زیرا مسیر reuse نیاز دارد principal اصلی Connection را برگرداند.
- **`establishConnection`** (`src/application/services/context-provisioning.ts`): قلب رفع CI-G0. برای هر connection یک `connectionId`، `principalId`، `Context` و `binding` **مجزا** می‌سازد. connection شناخته‌شده Context خود را حفظ می‌کند (دوران credential).
- درخواست پروویژن کردن شامل `principalId` شد (نه principalId به‌عنوان credentialHash — اصلاح طراحی).
- **backup rehearsal اجرا شد:** کپی DB تولید head 22→24، `principal_id` اضافه شد، `integrity_check=ok`، rerun no-op، ۱۱۲۵ task دست‌نخورد.
- `tests/ci/ci-2-02-connection-issuance.test.ts` — ۱۱ تست: flag parsing، four-identity distinctness، credential hash، reuse، double-provision.

### CI-2.05 — انجام‌شده (commit نشده)

- **Context Resolver** (`context-resolver.adapter.ts`): credential hash → `RESOLVED | UNBOUND | INACTIVE | INSUFFICIENT_SCOPE`. تنها ورودی انتخاب‌کننده binding، credential hash است — هیچ `contextId`ای از tool arguments خوانده نمی‌شود (threat T04).
- **deny-by-default (I-06):** credential ناشناخته، binding خالی، یا binding با state غیر ACTIVE همگی `CONTEXT_NOT_BOUND` می‌دهند — هیچ fallbackی به آخرین Context فعال وجود ندارد.
- **I-07:** bindingهای REVOKED/EXPIRED هرگز دوباره فعال نمی‌شوند؛ در مسیر RESOLVED فقط bindingهای ACTIVE ساخته می‌شوند.
- **scope check:** scopeهای موردنیاز قبل از RESOLVE بررسی می‌شوند؛ نقص → `INSUFFICIENT_SCOPE` با لیست scopeهای غایب.
- **legacy bridge:** tokenهای `operator` پس از `pinLegacyContext` به `ctx-legacy-shared-operator` resolve می‌شوند — کاملاً در مسیر مجزا تست شده.
- **resolution ناب:** این ماژول پرچم `CTX_ISOLATION_MODE` را نمی‌خواند؛ همان نتیجه هم برای audit (SHADOW) و هم برای enforcement در دسترس است. تصمیم تبدیل شدن به خطا با caller است.
- `resolveContextWith(db, ...)` برای استفادهٔ درون transaction فراهم است (enforcement در همان transaction با write).
- `tests/ci/ci-2-05-context-resolver.test.ts` — ۱۱ تست: resolution کامل، تفکیک دو Context، unbound، revoked، FROZEN، scope ناکافی، grant مفقود، legacy، resolution درون transaction.

**گیت CI-G2 بسته شد.** همهٔ پایه‌های control plane (schema، صدور، legacy، lease، resolver) آماده‌اند و هنوز پشت پرچم خاموش هستند.

### CI-G3 — انجام‌شده (commit نشده)

- **SHADOW mode به مسیر درخواست متصل شد.** `OAuthProvider.tokenClaimsWithHash` از hash توکن کنار claims برمی‌گرداند؛ hook در `/mcp` بعد از احراز هویت موفق، observer را صدا می‌زند.
- **observer به‌صورت hexagonal تزریق می‌شود** (`createRequestObserver({resolver, auditSink})`): application service فقط پورت‌های CI-1.02 را می‌بیند. SQLite adapters در transport وصل می‌شوند.
- **architecture gate:** حالت پرچم و predicateها به `domain/context/ci-isolation-mode.ts` منتقل شدند تا application به infrastructure وابسته نباشد (G1 global).
- **legacy pin تازه‌سازی در هر resolve:** grantهای minted-since-startup در همان transaction پین می‌شوند (incremental و idempotent).
- **OFF = byte-for-byte رفتار فعلی:** observer در OFF کاملاً no-op است و هیچ ردیف auditی نمی‌نویسد — تست آن جداگانه سبز است.
- **never throws:** شکست observation درخواست را خراب نمی‌کند؛ در `error` برگردانده می‌شود.
- `tests/ci/ci-g3-shadow-mode.test.ts` — ۲ تست e2e روی سرور زنده: ALLOW برای legacy token + سرویس بدون تغییر؛ OFF هیچ auditی نمی‌نویسد.

### CI-G4 — انجام‌شده (commit نشده)

- **اولین enforcement واقعی روی مسیر زنده.** تا CI-G3 resolution فقط observe و audit می‌شد؛ از CI-G4 به بعد، وقتی پرچم در یک enforcement mode باشد (`PER_CONNECTION` یا `HOST_ATTESTED`)، هر resolution غیر از `RESOLVED` درخواست را واقعاً رد می‌کند.
- **یک نقطهٔ resolution، یک audit.** observer همان resolution را برمی‌گرداند که enforcement از آن تصمیم می‌گیرد (`context-isolation-enforcer.ts`)، پس ردیف audit همیشه با تصمیم واقعی تطابق دارد. تکرار مجدد resolver حذف شد.
- **fail-closed (I-06):** اگر خود resolution شکست بخورد (observer `error`، کنترل‌پلین در دسترس نیست)، enforcement آن را به‌عنوان `context_not_bound` رد می‌کند — قطع شدن control plane هرگز به‌معنای «اجازه داده شد» خوانده نمی‌شود.
- **تضاد της ضد-enumeration (T07):** بدنهٔ ۴۰۳ `{error:"context_denied", reason:<sentinel>}` با sentinelهای ثابت و بستهٔ CI-1.03 است (`context_not_bound` / `context_inactive` / `scope_insufficient`)؛ هیچ Context id، binding id یا مسیری در پاسز نشت نمی‌کند.
- **OFF و SHADOW رفتار تغییر نمی‌کنند:** `decideEnforcement` در این دو حالت همیشه `{allowed:true}` برمی‌گرداند (SHADOW فقط audit می‌نویسد).
- **رد در لبه:** درخواست قبل از هر session، concurrency، limiter یا tool work می‌میرد — complete mediation بدون هیچ side effect.
- `src/application/services/context-isolation-enforcer.ts` — تابع تصمیم pure، فقط به domain + ports وابسته.
- `tests/ci/ci-g4-enforcement.test.ts` — ۹ تست واحد: جدول تصمیم کامل (OFF/SHADOW/PER_CONNECTION/HOST_ATTESTED × RESOLVED/UNBOUND/INACTIVE/INSUFFICIENT_SCOPE/null) + عدم نشت id.
- `tests/ci/ci-g4-live-enforcement.test.ts` — ۳ تست e2e روی سرور زنده: legacy token همچنان ALLOW می‌ماند (ADR-CI-007)؛ credential غیرقابل resolve با ۴۰۳ + sentinel رد می‌شود و DENY audit با Context خالی ثبت می‌شود؛ همان credential در SHADOW همچنان serve می‌شود (یعنی رد کردن از enforcement است نه resolution).

**گیت CI-G4 بسته شد.** اولین بار است که isolation policy رفتار زنده را تغییر می‌دهد — و فقط وقتی اپراتور صریحاً پرچم را بچرخاند.

### CI-G5 — انجام‌شده (commit نشده)

- **اتصال Context به Task در زمان ایجاد.** CI-G4 resolution را محاسبه کرد و سپس دور می‌ریخت. CI-G5 آن را در `ResolvedContext` روی `TrustedInboundIdentity` نگه می‌دارد، از طریق هر دو مسیر session/moderator در `http-server.ts` عبور می‌کند، و در `task-runtime-service.create()` به‌عنوان چهار فیلد immutable روی `TaskExecutionContext` ذخیره می‌شود. یک Task برای همیشه به Contextی که آن را تأیید کرده متصل است.
- **Persistence authoritative.** migration 25 (`ci-task-context-binding`) چهار ستون nullable روی `tasks` اضافه می‌کند و `task_leases.context_id` را برای اتصال per-task lease به ownership_lease. `acquireTaskLease` context را در همان INSERT از `tasks` می‌خواند.Hydrate ستون‌ها را روی JSON merge می‌کند تا fence همیشه از ستون‌ها بخواند نه از blob.
- **epoch recheck پیش از هر side effect.** تصمیم pure در `domain/context/ownership-fence.ts` (`checkOwnershipFence`) داخل transaction همان receipt STARTED در `assertContextOwnershipForTask` اجرا می‌شود — epoch check و effect claim atomically commit می‌شوند، پس workerی که Contextش جابجا شده حتی intent هم نمی‌تواند ثبت کند.
- **`OUTCOME_UNKNOWN` به‌جای re-run.** loop خطای fence را قبل از dispatch می‌گیرد (چون داخل receipt شلیک شده)، step را ترمینال `outcome_unknown` می‌کند، plan را failed می‌کند و `outcome_unknown_requires_reconciliation` برمی‌گرداند — هرگز retry نمی‌شود. این خودِ "zero double execution" است.
- **fail-closed اما opt-in.** Task با Context ضبط‌شده که lease row ندارد fenced می‌شود (یا قبل از اولین acquisition است یا بعد از release صریح، هیچ‌کدام side effect را مجاز نمی‌کند). Task بدون Context (هر pre-CI task، و هر taskی که با flag OFF ساخته شده) بدون سرو untouched عبور می‌کند.
- fencing token عمداً ذخیره نمی‌شود — با epoch در lockstep می‌چرخد (acquire/advance آن را regenerate می‌کنند، renewal نگه می‌دارند)، پس تطابق (epoch, binding) اثبات می‌کند. ذخیره آن یک secret روی ردیفی بود که هر tool write لمس می‌کرد.
- `tests/ci/ci-g5-task-fencing.test.ts` — ۱۹ تست: migration head 25، persistence چهار ستون، اتصال task_leases، تصمیم pure fence (epoch/binding/deadline/missing)، receipt تحت ownership زنده (allow / epoch-stale / lease-released / unbound-no-op)، و **stress: ۱۰۰ task روی ۱۰ context** که نیمی transfer می‌شوند و fence دقیقاً بر اساس context پارتیشن می‌شود (۵۰ fenced / ۵۰ allowed).

**گیت CI-G5 بسته شد.** non-interference در سطح Task تثبیت شد: یک worker stale هرگز side effect جدیدی commit نمی‌کند و هرگز دوباره اجرا نمی‌شود.

**leaf بعدی:** شروع گیت **CI-G6** — Owner Console و انتقال کنترل (CI-6): APIهای `/admin/*` با session جدا/CSRF/reauth/one-time ticket، transfer دوفازی prepare → approve → freeze+epoch → drain → atomic rebind → audit، و fork snapshot sanitized.

---

### CI-G6a — انجام‌شده (commit نشده)

**هدف:** زیرساخت انتقال کنترل — repository intent، صدور بلیط یک‌بارمصرف، و commit اتمیک دوفازی. بدون HTTP endpoints (آنها CI-G6b هستند).

- **Port `TransferRepository`** در `application/ports/outbound/context.port.ts` — قرارداد hexagonal شامل: `mintTicket`/`hashTicket` (بلیط هرگز از مرز عبور نمی‌کند)، `insertIntent`/`getIntent`، `getLease`، `hasOpenIntent`، `approveIntent` (CAS روی `id, PREPARED, ticketHash`)، `commitTransfer` (rebind اتمیک)، `terminateIntent`، `listOpenIntents`.
- **آداپتور SQLite** در `adapters/.../handoff-intent.adapter.ts` — پیاده‌سازی port به‌عنوان یک object literal. CHECK constraint های migration 23 خود دامنه را اجرا می‌کنند: ماشین هفت‌حالته، `kind` CHECK، `ticket_hash` UNIQUE (replay تصادف می‌کند نه اینکه بی‌صدا مصرف شود).
- **سرویس application** در `application/services/context-transfer.ts` — `prepareHandoff` (PREPARED + بلیط یک‌بارمصرف)، `approveHandoff` (APPROVED + ثبت approver)، `commitHandoff` (rebind اتمیک)، `cancelHandoff`، `describeHandoff`. `randomId` inject می‌شود تا تست‌ها deterministic باشند (همان الگوی `establishConnection`).
- **`transferContextOwnership`** در `context-lease.adapter.ts` — primitive اتمیک rebind: برخلاف `advanceOwnershipEpoch` (renewal زیر همان binding)، binding مالک را عوض می‌کند و epoch را در یک CAS bump می‌کند. epoch bump همان چیزی است که chat قدیمی را در CI-G5 fence می‌کند.
- **pre-flight بیرون از transaction** — stale intent (lease بین prepare و commit حرکت کرده) در transaction خودش FAILED می‌شود، نه داخل transaction اصلی. اگر داخل آن بود، rollback کل transaction اثر FAILED را هم برگشت می‌کرد و intent برای همیشه در APPROVED گیر می‌کرد.
- **domain additions** — `rehydrateContext` (context.ts)، `rehydrateTransferIntent` (transfer-intent.ts)، `rehydrateOwnershipLease` (ownership-lease.ts): reconstruction سطر persist شده که از transition table عبور نمی‌کند (هرگز نباید یک سطر TRANSFERRING/APPROVED را illegal بنامد). `context-errors.ts` سه کلاس خطای CI را به domain منتقل کرد چون G1 `application/` را از import `core/` منع می‌کند.
- **تست‌ها** — `tests/ci/ci-g6a-context-transfer.test.ts`، ۱۸ تست: migration head، CHECK constraint هفت‌حالته، prepare (موفق / بدون lease / target همسان / intent دوم)، approve (موفق / بلیط اشتباه / replay / منقضی)، commit (rebind اتمیک + epoch bump / بدون approve / commit مجدد / stale → FAILED / Context در ACTIVE باقی می‌ماند)، cancel (باز / committed)، و concurrency.

**گیت CI-G6a بسته شد.** انتقال کنترل حالا یک capability است که فقط owner می‌تواند بازیدم کند، و commit آن یک Context را در یک transaction جابجا می‌کند.

**leaf بعدی:** **CI-G6b** — مسیرهای `/admin/*` HTTP با session جدا، CSRF، reauth، one-time ticket endpoint، و تست live gate (چت سقف‌خورده → transfer → چت قدیمی deny).

---

### CI-G6b — انجام‌شده (commit نشده)

**هدف:** Owner Console روی سرور زنده — مسیرهای `/admin/*` با session جدا، CSRF، reauth، و تست live gate.

- **مسیرها در `handleAdminRequest`** (`src/mcp/http-server.ts`) — هرگز به‌عنوان MCP tool منتشر نمی‌شوند؛ dispatch کامل جدا از `/mcp`، قبل از fallthrough ۴۰۴. چهار کنترل لایه‌ای روی هر mutation:
  1. **Reauth** — `/admin/login` فقط با bootstrap secret از طریق `oauth.verifyBootstrapSecret` (timing-safe).
  2. **Session جدا** — `hx_admin` cookie با store دوم `OperatorWebSessions` (cap جدا `HOOSHIX_ADMIN_SESSION_LIMIT`، default ۸). کوکی operator به این سطح نمی‌رسد (تست pin شده).
  3. **CSRF** — فیلد فرم `csrf` باید با server-stored secret مطابق باشد؛ SameSite=Strict + چک Origin تو در تو.
  4. **Origin strict** — هر mutation باید origin برابر با public base URL داشته باشد.
- **سه فاز transfer روی HTTP** — `POST /admin/transfer/prepare` (ticket یک‌بارمصرف در response)، `/approve` (redeem)، `/commit` (rebind اتمیک)، `/cancel`، و `GET /admin/transfer/:id` فقط با cookie (بدون CSRF، مثل `/metrics`). خطاها با `ContextError.code` روی status map می‌شوند (۴۰۴/۴۰۹/۴۰۳) — بدنه فقط sentinel، هرگز Context/binding detail (T07).
- **Ticket هرگز persist نمی‌شود** — `prepare` plaintext را یک‌بار برمی‌گرداند؛ `approve` فقط hash مقایسه می‌کند. تایید در تست live: `ticket_hash` ردیف شامل plaintext ticket نیست.
- **تست‌ها** — `tests/ci/ci-g6b-owner-console.test.ts`، ۸ تست live server (PER_CONNECTION): login موفق/ناموفق، mutation بدون session (۴۰۱)، cross-origin (۴۰۳ `origin_not_allowed`)، transfer کامل prepare→approve→commit (lease به binding جدید + epoch ۲، Context در ACTIVE)، ticket replay (۴۰۹ `CONTEXT_INACTIVE`)، CSRF اشتباه (۴۰۳ + هیچ intent ساخته نشد)، inspection فقط-cookies (بدون echo ticket hash)، و رد کوکی operator به سطح admin.

**گیت CI-G6 بسته شد.** انتقال کنترل حالا یک پروتکل owner-approved است که روی سرور زنده از طریق یک سطح جدا اجرا می‌شود، و epoch bump داخل commit چت قدیمی را برای CI-G5 fence می‌کند.

**leaf بعدی:** شروع گیت **CI-G7** — ChatGPT اتصال واقعی (CI-7): دو connection مستقل واقعی (مدل C) یا host attestation (مدل H)، فقط پس از CI-2، روی endpoint آزمایشی مجزا، و ثبت سطح نهایی A/B/C.
