# CI-0 — Baseline Audit (only-read-only)

**تاریخ:** 2026-10-02
**baseline HEAD:** `93cab47` — `fix(child-env): allowlist LOCALAPPDATA so the Windows Python launcher resolves instead of hanging`
**git tag:** `pre-ci-backup`
**پشتیبان‌ها:**
- کد: کپی working tree در `D:\workspace\hooshix-pre-ci-backup-2026-10-02T13-50` (۵۴۴ فایل) + tag `pre-ci-backup`
- دیتابیس: `data/backups/agent-memory.pre-ci-backup.2026-10-02T13-48-48-609Z.db` (SQLite online backup، `integrity_check = ok`، ۱۱۲۵ task)
**وضعیت تست در baseline:** ۸۸۹ تست / ۱۹۹ فایل سبز
**مرجع طرح:** بستهٔ `HooshiX_Chat_Isolation_Design_v1` (فایل‌های ۰۰ تا ۱۴)

این سند نتیجهٔleafهای CI-0.01 تا CI-0.05 است. **هیچ mutationی روی سرویس واقعی انجام نشده**؛ همهٔ خواندن‌ها فقط‌خواندنی بوده‌اند.

---

## CI-0.01 — وضعیت Workspace، Git و Taskهای pending

### Workspace pool (سراسری و مشترک بین تمام اتصال‌ها)

۱۰ ریشه در یک pool مشترک (`workspace_roots`)، بدون هیچ partitioning بر اساس connection/principal/context:

```
c:\WINDOWS\TEMP
D:\workspace\hooshix-agent          ← خود مخزن (production)
D:\Projects
D:\Projects\hooshixagent
D:\EAAP_Initial_Documentation_v0.1
\\wsl.localhost\Ubuntu\home\coder\workspace\Hooshix
\\wsl$\Ubuntu\home\coder\workspace\Hooshix
D:\workspace\body-game
D:\test
D:\test\university-registration-site
```

**نکتهٔ مهم:** دو مسیر WSL (`wsl.localhost` و `wsl$`) به یک مخزن فیزیکی اشاره می‌کنند — یعنی pool فعلی حتی در سطح identity ریشه هم deduplicate نشده است (همان مشکلی که `sameRootIdentity` برای case-sensitivity ویندوز حل کرد، برای UNC/WSL alias هنوز حل نشده).

### Git

```
main → 93cab47 (clean working tree)
```

### Taskهای غیر‌terminal

```
completed        748
failed           308
cancelled         34
planning          20
waiting_approval  15
```

۳۵ task غیر‌terminal همگی از برنامهٔ R0–R6 باقی‌مانده‌اند (مثل "Stage R6.07 hot-path proof") و هیچ‌کدام در حال اجرا نیستند؛ سرور زنده هیچ Task فعالی ندارد. **هیچ Task در حال اجرایی وجود ندارد که نیاز به drain برای شروع CI باشد.**

---

## CI-0.02 — Inventory تک‌تکی: `file : symbol : entrypoint : mutable_scope : risk`

این جدول طبق فایل ۰۸ (CI-0.02) تمام singletonهای قابل‌تغییر و مسیرهای جهانی را فهرست می‌کند. این لیست **هدف مفهومی** است که باید در CI-3 از بین برود.

### ۱. Workspace سراسری

| فایل | نماد | mutable scope | ریسک |
|---|---|---|---|
| `src/security/workspace-guard.ts:19` | `let workspaceRoots: string[]` | کل پروسه، تمام اتصال‌ها | **HIGH** — pool مشترک تمام چت‌ها |
| `src/security/workspace-guard.ts:20` | `let activeWorkspace: string \| null` | کل پروسه (fallback stdio) | **HIGH** — انتخاب فعال بدون session |
| `src/security/workspace-guard.ts:22` | `workspaceScope: AsyncLocalStorage` | per-call-chain | LOW (درست استفاده شده) |
| `src/security/workspace-guard.ts:25` | `sessionWorkspace: AsyncLocalStorage` | per-HTTP-session | **MEDIUM** — در مسیر modern به‌جای session، به `principalBinding` مشترک key می‌شود (http-server.ts:359) |
| `src/mcp/http-server.ts:87` | `modernContexts: HttpPrincipalContexts` | keyed by `principalBinding` | **CRITICAL** — کلید ثابت برای تمام چت‌ها → `set_workspace` یک چت، چت دیگر را جابه‌جا می‌کند |
| `src/mcp/http-server.ts:84` | `sessions: Map<string, SessionEntry>` | per-legacy-session | MEDIUM (legacy ایزوله است) |
| `src/mcp/http-server.ts:72` | `expensiveInflight: Map` | per-principalBinding | LOW ( concurrency limit ) |

### ۲. دیتابیس سراسری

| فایل | نماد | mutable scope | ریسک |
|---|---|---|---|
| `src/core/memory/database/connection.ts` | اتصال تک‌تک `agent-memory.db` | کل پروسه | **CRITICAL** — یک DB مشترک برای تمام چت‌ها؛ هیچ `context_id`ی وجود ندارد |
| `src/core/memory/database/index.ts:22` | `let migrationsApplied` | کل پروسه | LOW |

### ۳. هویت / session

| فایل | نماد | mutable scope | ریسک |
|---|---|---|---|
| `src/core/runtime/r2-trusted-inbound-identity.ts:12` | `inbound: AsyncLocalStorage` | per-request | LOW (درست) — ولی محتوای آن مشکل دارد (↓) |
| `src/mcp/oauth.ts:44` | `pending: Map<codeHash, CodeRecord>` | کل پروسه | LOW (کد یک‌بارمصرف) |
| `src/mcp/oauth.ts:94` | `issueCode(..., principalId="operator")` | پیش‌فرض ثابت | **CRITICAL** — تمام grantها یک principal می‌شوند (تأییدشده در CI-0.03) |

### ۴. اجرای Task / loop

| فایل | نماد | mutable scope | ریسک |
|---|---|---|---|
| `src/core/loop/closed-agent-loop.ts` | حلقهٔ اجرا | per-Task | LOW — workspace را از `executionContext` immutable می‌خواند (خوب) |
| `src/core/executor/local-tool-executor.ts:101` | `captureWorkspaceScope` | per-Task | LOW |

### جمع‌بندی inventory

مرکز ثقل مشکل **دو متغیر سراسری** (`workspaceRoots`، `activeWorkspace`) + **یک کلید اشتراکی** (`principalBinding`) + **یک DB مشترک** بدون ستون context است. `AsyncLocalStorage`ها به‌خودی‌خاطر مشکل نیستند؛ طرز استفاده از آن‌ها در مسیر modern مشکل دارد.

---

## CI-0.03 — نسخهٔ MCP/SDK، ادعای auth و وضعیت واقعی ChatGPT

### نسخه‌ها

- MCP protocol: مسیر `2026-07-28` (stateless، بدون session پروتکلی) در `http-server.ts:339` پیاده‌سازی شده، در کنار مسیر legacy با `Mcp-Session-Id`.
- SDK: `@modelcontextprotocol/typescript` (از طریق `StreamableHTTPServerTransport`).
- OAuth: PKCE S256، DCR (`/oauth/register`)، refresh rotation با `rotated_to_hash`، revocation family — همهٔ این‌ها واقعی و کار می‌کنند (migration 16).

### شواهد عملی هویت — **بدون اجرای تست روی سرویس واقعی**

```sql
SELECT DISTINCT principal_id FROM oauth_access_tokens;
-- [{ principal_id: 'operator' }]   ← تنها یک principal
```

```sql
SELECT DISTINCT principal_id FROM tasks;      -- local-stdio, operator
SELECT DISTINCT principal_id FROM projects;   -- local-stdio, operator
```

```text
active access tokens : 1
refresh tokens       : 42
registered clients   : 9
```

**نتیجهٔ قطعی در سطح سرور:** هر اتصال OAuth که با bootstrap PIN یکسانی احراز شده، principal یکسانی (`operator`) گرفته است. `issueCode` در `http-server.ts:648` بدون `principalId` صدا زده می‌شود و پیش‌فرض `oauth.ts:94` یعنی `"operator"`.

در مسیر modern، session identity هم مشترک است:

```js
// http-server.ts:313
principalBinding = sha256(principalId + "|" + clientId + "|" + resource)
// http-server.ts:363
sessionId = principalBinding as SessionId
```

چون هر سه ورودی ثابت است، tuple هویتی `(principalId="operator", sessionId=<hash ثابت>)` برای **تمام چت‌ها یکسان** است. بنابراین در مسیر modern:
- چک مالکیت ۳-عاملی تسک در `r2-runtime-gateway.ts:77` (`principal + session + origin`) همیشه عبور می‌کند → تسک‌ها بین چت‌ها ایزوله **نیستند**.
- `modernContexts` با کلید مشترک → `set_workspace` یک چت، چت دیگر را منحرف می‌کند.

### آنچه هنوز قابل‌اجازه نیست

طبق فایل ۰۱ (§4) و ۱۳ (§2)، تستfeasibility نهایی **باید روی دو چت واقعی ChatGPT با اتصال مستقل انجام شود**. این بررسی به حساب مالک و یک endpoint آزمایشی نیاز دارد و **تا زمانی که Owner Console آزمایشی (CI-2) و یک connection دومی ساخته نشود، ممکن نیست**. CI-G0 (سند بعدی) این پیش‌شرط را رسمی می‌کند.

---

## CI-0.04 — تصمیم مستند feasibility (CI-G0)

وضعیت فعلی در دستهٔ سوم قرار می‌گیرد:

```text
NO_VERIFIABLE_CHAT_ID (فعلی)
  evidence: تمام grantها principal_id="operator"؛ principalBinding ثابت برای همه چت‌ها؛
            هیچ connection_id/context_idای ذخیره نمی‌شود؛ سرور هیچ تمایزی بین چت‌ها نمی‌بیند.
  claim: هیچ محرمانگی per-chat قابل ادعا نیست. حتی جداسازی per-connection هم اجرا نمی‌شود،
         چون binding connection→context وجود ندارد.
```

**اما یک نکتهٔ کلیدی:** برخلاف فرض فایل ۰۱، مشکل فعلی **محصول ChatGPT نیست** — مشکل **پیاده‌سازی سرور** است. سرور هنوز `principal_id` مجزا per-connection صادر نمی‌کند، حتی اگر ChatGPT دو connection مستقل بفرستد. بنابراین پیش از هر آزمون میزبانی، باید **پیش‌نیاز سمت سرور** برطرف شود: صدور principal/connection مجزا و binding آن. این کار در CI-2 انجام می‌شود و **بدون هیچ وابستگی به محصول ChatGPT** قابل اجراست.

سند کامل تصمیم: `CIG0_FEASIBILITY_GATE_2026-10-02.md`.

---

## CI-0.05 — Freeze مدل تهدید، permission tooling، schema و وضعیت R-program

### وضعیت R-program در زمان شروع CI

گزارش `E2E_AUDIT_REMEDIATION_2026-10-02.md` (بخش ۷) نشان می‌دهد تمام ایرادهای ممیزی E2E بسته شده‌اند. موارد بازِ صرفاً پیشنهادی هستند:
- ADR رسمی برای «control-plane deletes مستقیم‌اجرا هستند» (توصیه‌ای، نه گیت).
- cleanup دو record آزمایشی باقی‌مانده در تولید (housekeeping).

**وضعیت موردنظر مالک برای شروع CI تأمین است.**

### Permission tooling فعلی

- ۴ سطح permission: `READ_ONLY`، `PROJECT_ACCESS`، `DEVELOPER_MODE`، `ADMIN_MODE` (`permission-config.ts`).
- OAuth scopeها: `hooshix:read`، `hooshix:execute`، `hooshix:project:write`، `hooshix:task:manage`، `hooshix:workspace:manage`، `hooshix:monitoring:read`، `hooshix:admin`، `offline_access`.
- ۵۳ ابزار: ۲۹ step-executable + ۲۴ control (فهرست کامل در `docs/TOOLS.md`).
- approval policy: `approval: "never" | "on-risk" | "always"` در `operation-catalog.ts`.
- risk classes: `read`، `workspace_scope`، `process`، `task_control`، `non_idempotent_mutation`.

### Schema فعلی (migration head = 22)

۱۳ جدول base + ۹ جدول migration-created. **هیچ `context_id`، `connection_id`، `workspace_grant_id`، `ownership_epoch`ای وجود ندارد.** توزیعprincipal_id: `tasks`، `memory_items`، `projects`، `approval_requests` (همگی با fallback `"local-stdio"`).

### مدل تهدید (baseline برای CI)

تهدیدهای T01–T12 در فایل ۰۲ **همگی در حال حاضر پذیرفته هستند** (به‌تفصیل در `CIG0_FEASIBILITY_GATE_2026-10-02.md`). به‌طور خلاصه: T01 (شناسایی ID خارجی)، T02 (سوییچ workspace سراسری)، T03 (توکن مشترک)، T04 (تزریق contextId)، T07 (حدس ID) همگی در مسیر modern کاملاً باز هستند.

---

## گیت CI-G0

| شرط | وضعیت |
|---|---|
| هویت قابل اعتبارسنجی per chat یا محدودیت صریح محصول | **BLOCKED روی میزبان**، ولی **رفتنی سمت سرور** (صدور principal مجزا) |
| گزارش audit فاقد اسرار | ✅ هیچ token/secret در این سند نیست |
| هیچ mutation روی سرویس واقعی | ✅ فقط خواندن |

**تصمیم:** CI-1 (domain model) و CI-2 (صدور principal/connection مجزا + binding) را می‌توان **بدون منتظر ماندن برای feasibility میزبان** شروع کرد، چون این بخش‌ها زیرساخت سمت سرور هستند و شرط لازم (نه کافی) برای هر سه مدل H/C/P هستند. ادعای محرمانگی per-chat تا CI-G7 معلق می‌ماند.
