# HooshiX Agent — ممیزی جامع کد (Full Source Audit)

**تاریخ:** ۲۰۲۶-۰۹-۳۰
**محدوده:** کل سورس کد (`src/`، `scripts/`، `config/`، `tests/`، manifست‌ها، داکیومنت)
**روش:** ۵ ممیزی موازی تخصصی (امنیت ×۲، تکراری/مرده، معماری/پیچیدگی، تست، کانفیگ/استقرار) + بررسی دستی
**خط پایه:** `docs/HOOSHIX_AUDIT_CONSOLIDATED_FINAL.md` (۲۰۲۶-۰۹-۰۶) با ۱۳ HIGH و ۲۹ MEDIUM

---

## ۰-ب. وضعیت اصلاح (Remediation Log) — جلسه ۲۰۲۶-۰۹-۳۰

تمام یافته‌های P0 و بخش عمده‌ای از P1/P2 برطرف شدند. Build تمیز، **۸۵۶ تست / ۱۹۴ فایل همه پاس**.

| اولویت | یافته | اقدام | وضعیت |
|---|---|---|---|
| P0 | N-1 — نبود rate limit پیش از auth در `/mcp` | `publicLimiter` بر `remoteIp` قبل از ارسال ۴۰۱ اعمال شد (۱۴۲۹ محدود می‌کند lookup نامحدود SHA-256+SQLite) | ✅ برطرف |
| P0 | N-2 — `/metrics` و `/dashboard` cross-principal | `principalId` از OAuth claims به `getAgentMetrics` در هر دو endpoint ارسال می‌شود؛ session اپراتور نمای کامل را نگه می‌دارد | ✅ برطرف |
| P0 | N-3 — chunked body بدون cap در مسیر مدرن | شمارش بایت روی stream + `req.destroy()` هنگان تجاوز از `MAX_MCP_BODY_BYTES` | ✅ برطرف |
| P0 | SCRIPT-1 — `mcp-token.ps1` در تضاد با مدل امنیتی | بازنویسی کامل: مدل OAuth-only برای کلاینت، راز اپراتور فقط برای login/consent، انحصار نوشتن (`wx`)، حداقل ۳۲ بایت، عضو gate `r7-secret-policy-check.mjs` | ✅ برطرف |
| P1 | تست `package-handler.ts` (۰% branch) | ۵ تست رفتاری واقعی (نصب npm `left-pad`، شکست بسته ناموجود، validation schema) | ✅ برطرف |
| P1 | نشت SDK به `src/mcp/` نامرئی برای گارد | گارد در `r1-strict-boundary.test.ts` اکنون کل درخت `src` را اسکن می‌کند؛ لایه transport (`mcp/` + `adapters/inbound/mcp/`) به‌صورت صریح مجاز | ✅ برطرف |
| P1 | دور باطل core↔composition | ۱۰ ماژول دامینی که به اشتباه زیر `infrastructure/composition/` بودند به `core/{governance,executor,runtime,planner}/` منتقل شدند؛ تنها ریشه‌های واقعی composition باقی ماندند | ✅ برطرف |
| P1 | تکرار rotation logic | `audit-log-rotation.ts` مشترک؛ کپی بایت‌به‌بایت در `command-audit`/`file-audit` حذف | ✅ برطرف |
| P1 | TaskState رقیب (canonical ۱۰حالت vs legacy ۱۱حالت) | **برطرف شد** — `LegacyTaskState` حذف، ماشین حالت روی `task-state-machine.ts` با ۱۰ حالت canonical بازنویسی، migration 20 مقادیر legacy را بازنویسی می‌کند (`created`→`planning`، `checkpointing`/`resuming`→`executing`) | ✅ برطرف |
| P2 | کد مرده: `getDatabase()` | حذف (صفر فراخوانی) | ✅ حذف |
| P2 | `config/config.json` (مرده، مقدار `DEVELOPER` نامعتبر) | حذف | ✅ حذف |
| P2 | `.freebuff/project-id` (آرتيفکت تصادفی committed) | حذف | ✅ حذف |
| P2 | `scripts/mcp-dashboard/` (یتیم، پورت ۸۸۹۹ موجود نیست) | حذف | ✅ حذف |
| P2 | ۳۷ دایرکتوری خالی `tests/runtime-files-*` | حذف | ✅ حذف |
| P2 | دایرکتوری‌های خالی `src/application/handlers/*` و `use-cases/{auth,monitoring}` و `application/ports/inbound` | حذف | ✅ حذف |
| P2 | ~۷۳۰ فایل scratch در `data/` (test-agent-memory-*, test-logs-*, release-validation) | حذف؛ داده زنده (`agent-memory.db` سرور در حال اجرا + WAL + backups) دست‌نخورده | ✅ حذف |
| P2 | DOC-1 — default permission اشتباه در docs | `README.md` و `docs/OPERATIONS.md` به `READ_ONLY` (fail-safe واقعی) اصلاح + نام کامل مقادیر env | ✅ برطرف |
| — | تست `r7-deployment-security` شکست‌خورده در ویندوز (CRLF) | regex تطبیق line-ending/indent | ✅ برطرف |

**کاهش خالص:** ۵۱ فایل تغییر، −۴۵۱/+۲۰۸ خط.

**گسترش جلسه دوم (استخراج صفحه + floorها):**
- **پیچیدگی monolith**: ~۵۷۰ خط HTML از `http-server.ts` استخراج شد → ماژول `src/mcp/pages.ts` (pure، قابل تست). `http-server.ts`: ۱۲۹۳ → ۷۲۳ خط (−۴۴٪).
- **XSS واقعی پیدا و اصلاح شد**: dropdown فیلتر ابزار در dashboard مقدار `<option value="${t}">` را escape نمی‌کرد. این مورد هنگون نوشتن تست برای ماژول استخراج‌شده کشف شد و اکنون escape می‌شود (همچنین ریسک/required args/capabilities در `toolsPage`).
- **تست اضافه**: ۱۰ تست unit برای renderers (`tests/core/pages-renderers.test.ts`) که بدون spawn کردن سرور قابل اجراست.
- **floorهای پوچ**: دو floor روی facadeهای ۲ و ۱۰ خطی (`task-lease.ts`، `command-permission.ts`) که پوشش ۱۰۰٪شان بی‌معنی بود، با floor روی ماژول‌های واقعی جایگزین شد (`task-lease.adapter.ts`، `legacy-command-policy.ts`) و choke-pointهای گمشده اضافه شد (`spawn.ts`، `policy-decision-point.ts`، `local-tool-executor.ts`، `task-workspace.ts`).
- **نکته**: `http-server.ts` به‌صورت عمدی از V8 coverage excluded است (E2E آن را child process اجرا می‌کند) — رفتار آن با `tests/security/r5-*` گارد می‌شود، نه عدد coverage.

**مجموع نهایی: ۸۶۶ تست / ۱۹۵ فایل، build تمیز.**

**تصمیمات نهایی کاربر:**
- **EAAP package حذف شد** — ۲۰ فایل spec با `git rm` (دایرکتوری کاملاً پاک شد).
- **سرور MCP ری‌استارت شد** (PID 37884 → 32780) و تأییدهای زنده:
  - `/health/live` → ۲۰۰ (محلی + tunnel عمومی `https://mcp.hooshix.com`)
  - **N-1 زنده**: ۶۰ درخواست bad-token → ۴۰۱، درخواست ۶۱ام → ۴۲۹ (rate limit pre-auth فعال)
  - `/mcp` challenge: `WWW-Authenticate: Bearer resource_metadata=...` درست
  - **pages.ts زنده**: dynamic client registration OK، صفحه consent `/oauth/authorize` → ۲۰۰ (عنوان RTL فارسی، PKCE hidden field، grant checkboxes)
  - `/dashboard` و `/metrics` بدون session → ۴۰۱ (fail-closed درست)

---

---

## ۰. خلاصه اجرایی (Executive Summary)

**خبر خوب:** پروژه از نظر امنیتی جهش بزرگی داشته است. تمام ۱۳ یافته HIGH ممیزی قبلی در سورس برطرف شده و **هیچ کد مخرب، بک‌دور، phone-home یا نشت داده‌ای وجود ندارد**.

**خبر بد:** معماری همچنان ناقص است (۶.۵/۱۰) و سه یافته MEDIUM **جدید** روی لایه HTTP پیدا شده است که ناشی از کار نیمه‌تمام remediation است.

### جدور خلاصه (Scorecard)

| حوزه | امتیاز | وضعیت |
|---|---|---|
| امنیت (Malicious/Backdoor) | **عالی** | کاملاً تمیز — صفر یافته مخرب |
| امنیت (Vulnerabilities) | **خوب** | ۱۳ HIGH قبلی همه بسته؛ ۳ MEDIUM جدید |
| کیفیت تست | **۸.۵/۱۰** | فوق‌العاده بهبود (۳۴۲→۸۲۱ تست) |
| معماری | **۶.۵/۱۰** | لایه داخلی تمیز، مرزها ضعیف |
| کد مضاعف/مرده | **متوسط** | یک تکرار واقعی + ~۱۵ مورد مرده |
| کانفیگ/استقرار | **خوب** | HIGH-10/11/12 بسته، drift داکیومنت |

### حکم نهایی
- **Local stdio (سیستم شما):** آماده استفاده production مشروط (Conditional)
- **HTTP عمومی (از طریق tunnel):** سه یافته MEDIUM جدید باید قبل از production πραγμα برطرف شوند (به‌ویژه N-1)

---

## ۱. کدهای مخرب و مشکوک — **تمیز (CLEAN)**

بررسی کامل انجام شد و **هیچ موردی یافت نشد**:

| بررسی | نتیجه |
|---|---|
| `eval(` / `new Function(` | ۰ مورد در `src/` |
| شبکه خروجی (fetch/axios/http.request/WebSocket) | ۰ مورد — سرور هرگز تماس خروجی برقرار نمی‌کند |
| URL خارجی در `src/` | فقط ۲ مورد خنثی (مثال در description، loopback default) |
| رشته‌های مبهم/obfuscated | ۰ مورد |
| Prototype pollution | دسترسی‌ها با `Object.hasOwn` محافظت شده‌اند |
| `require` پویا | ۰ مورد |
| بک‌دور/کردنشال Harding شده | صفر — `hooshix-v2-secret` حذف و gate CI آن را اجبار می‌کند |
| `.freebuff/project-id` | فقط یک UUID، ۰ ارجاع در کل ریپو (آرتيفکت خارجی تصادفی) |

**نکته سازنده:** طراحی single-spawn choke-point در `src/services/spawn.ts` واقعاً محکم است: `execa` فقط در یک فایل import شده، `env` تماس‌گیرنده حذف و allowlist جایگزین می‌شود، `extendEnv:false` اجباری است.

---

## ۲. امنیتی — یافته‌های **جدید** (MEDIUM)

این یافته‌ها در جریان کار remediation ایجاد شده‌اند یا باقی مانده‌اند:

### N-1 — MEDIUM: درخواست‌های احراز‌هویت‌نشده `/mcp` از rate limiter عبور می‌کنند
**فایل:** `src/mcp/http-server.ts:152-156, 305-311`

`publicLimiter` فقط مسیرهای `/oauth/`، `/.well-known/`، `/operator/` را پوشش می‌دهد. `principalLimiter` **بعد از** احراز هویت اجرا می‌شود. پس یک سیل درخواست با توکن نامعتبر فقط یک هش SHA-256 + یک کوئری SQLite انجام می‌دهد — **بدون هیچ محدودیتی**.

```typescript
// L152: publicLimiter فقط این مسیرها
if(path.startsWith("/oauth/")||path.startsWith("/.well-known/")||path.startsWith("/operator/")){...}

// L305: 401 بدون چک rate limit
if(!grant){ sendJSON(res,401,{error:"invalid_token"}); return; }
// L311: principalLimiter بعد از auth
```

**تأثیر:** DoS سوکت/CPU/DB از طریق یک اصل ناشناس (یا یک اصل مسدود شده). شدیدترین یافته جدید.

### N-2 — MEDIUM: `/metrics` و `/dashboard` داده‌های همه principals را نشان می‌دهند
**فایل:** `src/mcp/http-server.ts:202-213, 227-235`

هر دو endpoint `getAgentMetrics()` را **بدون** `principalId` صدا می‌زنند، در حالی که ابزار MCP `agent_metrics` بر اساس principal محدود شده است (migration 19). هر کلاینتی که scope `hooshix:monitoring:read` گرفته باشد، ترافیک همه principals را می‌بیند. این یک **regression** نسبت به_intent R6 (principal scoping) است.

### N-3 — MEDIUM: محدودیت حجم بدنه در مسیر modern فقط Content-Length است
**فایل:** `src/mcp/http-server.ts:348-351`

مسیر پروتکل جدید (`mcp-protocol-version: 2026-07-28`) فقط با `Content-Length` حجم را محدود می‌کند. یک درخواست `Transfer-Encoding: chunked` بدون Content-Length محدود نمی‌شود و SDK آن را کامل buffer می‌کند. (ممزی امنیتی این مورد را تایید کرد.)

### یافته‌های LOW جدید
| # | فایل | یافته |
|---|---|---|
| N-4 | `git-service.ts:65-68` | `gitAdd` مسیرها را بدون validation workspace به `git add --` می‌دهد (برخلاف clone/init) |
| N-5 | `http-server.ts:174` | `/operator/login` چک Origin را با نبودن هدر دور می‌زند |
| N-6 | `http-server.ts:765,770` | dashboard `/tools` interpolationهای escape‌نشده (امروزه از کاتالوگ استاتیک) |

### یافته‌های قبلی که **بسته شده‌اند** (همه تایید شده)
HIGH-01 (workspace authz) · HIGH-02 (search denylist) · HIGH-03 (git diff --no-index) · HIGH-04 (OAuth expiry — حالا rotation/replay-revoke واقعی) · HIGH-05/06/07 (timeout/crash/hydration) · HIGH-08/09 (rollback truthfulness) · HIGH-10/11/12/13 (Docker/env/health/lease) · MED-01/02/03/04/05/06/07/08/09/10/11/12/19/20/25/28/29

---

## ۳. معماری و ساختار — **۶.۵/۱۰**

### ۳.۱ واقعاً تمیز (تایید شده)
- `src/domain` — صفر import خارجی ✓
- `src/application` — فقط domain ✓
- **SQL خام در `src/tools/` حذف شده** (ممیزی قبلی گفت هست؛ حالا delegate می‌کند) ✓
- `process.env` فقط در `infrastructure/config/` ✓
- **هیچ repository ای AsyncLocalStorage نمی‌خواند** — ابزارها `principalId` را prop صریح پاس می‌کنند ✓

### ۳.۲ تخلفات معماری

**A — نشت MCP SDK به `src/mcp/` (REGRESSION)**
`src/mcp/http-server.ts:21-22`، `src/mcp/server.ts:2`، `tool-registrar.ts:10` مستقیماً از `@modelcontextprotocol/*` import می‌کنند. معماری می‌گوید SDK فقط در `adapters/inbound/mcp/` مجاز است. **هیچ guard test ای این لایه را اسکن نمی‌کند** (`r1-strict-boundary` فقط ۳ لایه را پوشش می‌دهد).

**B — `core` به `infrastructure/composition` برمی‌گردد (دور باطل)**
`task-runtime-service.ts:3,7,10`، `closed-agent-loop.ts:19-21`، ۶ فایل دیگر در core، لایه‌ای را import می‌کنند که قرار است آن را سیم‌کشی کند. یک cycle پنهان `composition → core → composition` ایجاد می‌شود.

**C — `core` ↔ `security` دور باطل دوطرفه**
`policy-decision-point.ts:8` ↔ `workspace-guard.ts:5` یکدیگر را import می‌کنند (با تکیه بر ESM lazy binding).

**D — سه composition root (نه یکی)**
`core/runtime/composition-root.ts` + `infrastructure/composition/r2-runtime-gateway.ts` + `r1-application-composition.ts` (تست). داکیومنتیک "یک composition root" غلط است.

**E — استفاده از راهکار production از لایه hexagonal عبور می‌کند**
۳ مورد از ۴ use case فقط در تست استفاده می‌شوند. ترافیک واقعی از مسیر "legacy" (`tools → core/memory facades → sqlite`) عبور می‌کند.

**F — Singletonsهای ambient mutable هنوز وجود دارند**
`policyDecisionPoint` و تمام `workspace-guard` (شامل `let workspaceRoots`، `let activeWorkspace`) هنوز global mutable state هستند.

### ۳.۳ پیچیدگی — Top نقاط داغ

| # | فایل | خط | مشکل SRP |
|---|---|---|---|
| ۱ | `mcp/http-server.ts` | **۱۲۷۲** | ۸ مسئولیت + ~۶۰۰ خط HTML/CSS inline (dashboard، docs، tools) |
| ۲ | `core/loop/closed-agent-loop.ts` | **۵۳۹** | کل فایل یک موتور: state machine + governance + template + receipt + timeout. **۸ triplet 近‌duplicate** persist+checkpoint+saveExecution |

| فایل | خط |
|---|---|
| `task-repository.adapter.ts` | ۵۷۷ |
| `filesystem-service.ts` | ~۵۲۰ |
| `package-service.ts` | ۴۵۰ |
| `workspace-guard.ts` | ۴۱۶ |
| `task-runtime-service.ts` | ۳۸۴ |

### ۳.۴ تداخل داکیومنت ↔ کد
- ARCHITECTURE.md می‌گوید "SDK فقط در inbound" — **نقض شده و گارد قادر به دیدن نیست**
- می‌گوید "一团composition root" — **غلط**
- می‌گوید "process.env rule enforced" — تست فقط ۳ لایه را اسکن می‌کند

### ۳.۵ دو سیستم error taxonomy
`errors.ts` تایپ‌شده وجود دارد اما در جاهای دیگر با `throw new Error("terminal_task_append_forbidden")` دور می‌زنند — دقیقاً همان الگوی شکننده‌ای که خود فایل آن را نقص گذشته توصیف می‌کند.

---

## ۴. کدهای تکراری و مرده

### ۴.۱ تکرار واقعی (ریسک drift)

**A — منطق چرخش (rotation) به صورت بایت‌به‌بایت کپی شده**
`src/memory/command-audit.ts:42-52` و `src/memory/file-audit.ts:9-17` دقیقاً یکسان هستند (`MAX_LOG_BYTES` + `rotateIfNeeded`). **خود file-audit کامنت گذاشته "mirroring the command-audit bound" — تایید آگاهانه ولی بدون abstraction.** اگر یک استراتژی عوض شود، دیگری خاموش drift می‌کند.

**B — دو تعریف رقیب `TaskState` (هم drift کرده)**
- `src/domain/task/task.ts:5` — ۱۰ حالت (canonical)
- `src/domain/task/legacy-task-state-machine.ts:8-19` — ۱۱ حالت (legacy)

**legacy آن است که در production persist می‌شود**. یک ردیف `checkpointing` در canonical معادل ندارد. canonical فقط از طریق مسیر تستی R1 قابل دسترسی است.

### ۴.۲ کدهای مرده (با grep تایید شده)

| مورد | مدرک | حکم |
|---|---|---|
| `config/config.json` | صفر خواننده در `src/` | **مرده** + مقدار `DEVELOPER` نامعتبر |
| `src/memory/database.ts:7` `getDatabase()` | ۰ importer | **مرده** |
| `core/orchestrator/tool-orchestrator.ts` | facade، ۰ importer production | **مرده در production** (alias تست) |
| `core/planner/task-planner.ts` | facade، ۰ importer production | **مرده در production** |
| `core/runtime/template-resolver.ts` | facade، production از application استفاده می‌کند | **مرده در production** |
| `core/governance/governance-engine.ts` | facade، ۰ importer production | **مرده در production** |
| `step-governance.ts:28-29` overload رشته‌ای | همه صداکنندگان production آبجکت پاس می‌دهند | **شاخه مرده** |
| `MemoryRecoveryObservability` class | فقط importer تست، production فقط type آن را می‌خواند | **کلاس مرده** |

### ۴.۳ دایرکتوری‌های خالی (~۲۵+)
`src/core/tools`، `src/domain/backup`، `src/application/use-cases/{auth,monitoring}`، `src/application/ports/inbound`، `src/bootstrap`، `src/adapters/inbound/http`، `src/adapters/outbound/{auth,observability,rate-limit,process,system,filesystem,git,package}`، هر ۶ تا از `src/application/handlers/*` (فقط `.gitkeep` درونشان است).

**نکته مهم:** `src/application/use-cases/auth` و `monitoring` خالی‌اند — یعنی نام‌گذاری هگزاگونال کامل، اما محتوایش هرگز نوشته نشده.

### ۴.۴ سورس‌های نیمه‌تمام که "کامل" اعلام شده‌اند

**پاک‌ترین پاسخ به سوال شما:** stubs در `src/tools/` **نصفه‌نیمه نیستند** — آنها بازنشستگی عمدی R2 هستند (callback می‌اندازد، dispatch از gateway عبور می‌کند). این یک طراحی انجام‌شده است.

اما این موارد واقعاً نیمه‌تمام/یتیم هستند:

| مورد | چرا نیمه‌تمام |
|---|---|
| `scripts/mcp-dashboard/` | کاملأ يتیم — صفر ارجاع در ریپو، یک اسکریپت serve.js که پورت 8899 یک "Python MCP" را مانیتور می‌کند که **هیچ معادلی در `src/` ندارد**. فقط با `start.bat` دستی اجرا می‌شود |
| `src/application/handlers/*` (۶ تا) | ساخته شده‌اند اما فقط `.gitkeep` — ظاهراً در یک refactor حذف شده‌اند ولی دایرکتوری‌ها جا مانده‌اند |
| ادعای "process.env فقط config" | guard فقط ۳ لایه را پوشش می‌دهد، نه ۹ |
| `docs/implementation/20_FINDINGS_TRACEABILITY_MATRIX.md` | می‌گوید MED-03/13/14/15 هنوز OPEN هستند در حالی که چاپ شده‌اند |

### ۴.۵ کدهای اضافی (Extra)
- تست اجرا: **۳۷ دایرکتوری خالی `tests/runtime-files-*`** + ~۸۰۰ فایل gitignoredزباله در `data/`
- `.freebuff/project-id` — در git ثبت شده (۱ فایل)، ۰ ارجاع
- `HooshiX_EAAP_Implementation_Package/` — ۲۰ فایل ثبت شده، پکیج spec محصول دیگر
- `src/tools/task/index.ts:17` — `const runtime = createTaskRuntimeService()` در **module scope** — singleton زمان import، برخلاف قانون composition خود پروژه

### ۴.۶ side effect عجیب
`src/tools/task/index.ts:240` یک `await import("../../core/governance/step-governance.js")` پویا دارد — تنها import پویا در کل `src/`، بدون کامنت توضیحی (احتمالاً دور زدن دور باطل).

---

## ۵. کیفیت تست — **۸.۵/۱۰**

### ۵.۱ بهبود چشمگیر
- **۸۲۱ تست** در ۱۹۳ فایل (از ۳۴۲) — ۲.۴ برابر
- **تمام ۱۳ exploit رگرسیون رفتاری دارند** (بسیاری از طریق MCP handler واقعی یا HTTP process واقعی)
- **موازی‌سازی درست شده** — `maxWorkers:1` حذف، isolation per-worker با regression guard
- پوشش: ۸۶.۴۵/۸۰.۴۹/۸۶.۲۳/۹۰.۵۴ — همه gates پاس
- هیچ تست skip‌شده، چگالی assertion بالا، fixture infrastructure عالی

### ۵.۲ باقی‌مانده
- **`package-handler.ts` صفر پوشش رفتاری (۰% branch)** — بحرانی‌ترین جای تست‌نشده. فایل ۳۰ خطی است و فقط `canHandle` در `executor-handlers.test.ts` آن را لمس می‌کند. مسیر手中 package mutation در task path کاملاً untested است.
- **coverage Exclude لیست** `mcp/oauth.ts` + `http-server.ts` را از پوشش خارج می‌کند (توجیه: V8 child-process coverage) — رفتاری تست می‌شوند اما گزارش پوشش گمراه‌کننده است
- functions پوشش فقط ۱.۲ امتیاز بالای gate
- floor list应急处置: دو floor با shim خالی **به‌صورت پوچ پاس می‌شوند**، executor/service layer کلاً از floor名单 خارج است
- چندتا تست static-source-scan (assert روی متن سورس) ضعیف‌تر از رفتاری هستند

---

## ۶. کانفیگ و استقرار

### ۶.۱ بسته شده‌ها (همه تایید شده)
| یافته | وضعیت |
|---|---|
| HIGH-10 (frozen-lock fallback) | بسته — fail-closed + تست واقعی `ERR_PNPM_OUTDATED_LOCKFILE` |
| HIGH-11 (env drift) | بسته — `MCP_API_KEY`/`MCP_ACCESS_TOKEN` hard-fail |
| HIGH-12 (healthcheck) | بسته — `/health/live` بدون احراز هویت |
| MED-13 (root container) | بسته — `USER node` + digest pin |
| MED-15 (PATH bootstrap) | بسته — allowlist + `extendEnv:false` |
| MED-16 (runbooks متعدد) | بسته — یک زنجیره canonical |

### ۶.۲ درفت‌های جدید

**SCRIPT-1 (مهم‌ترین) — `scripts/mcp-token.ps1` با مدل امنیتی در تضاد**
این فایل Bootstrap secret را "Access Token" می‌نامد، به اپراتور می‌گوید "این توکن را به عنوان PIN در ChatGPT وارد کنید" (L31-34)، با `Out-File` (نه `wx` انحصاری، نه 0600) می‌نویسد و راز را در console چاپ می‌کند. مدل امنیتی فعلی می‌گوید Bootstrap secret هرگز یک client credential نیست. **این فایل در لیست `r7-secret-policy-check.mjs` نیست** — به همین زنده ماند.

**DOC-1: `OPERATIONS.md` + `README` default permission را اشتباه نوشته‌اند**
داکیومنک می‌گوید default `DEVELOPER_MODE` است؛ کد می‌گوید `READ_ONLY`. اگر اپراتور سعی کند `READ`/`DEVELOPER`/`ADMIN` را تنظیم کند، startup fail می‌شود.

**سایر:**
- `OPERATIONS.md:99` به `/health/monitoring` اشاره می‌کند که وجود ندارد
- `HOOSHIX_MEMORY_FILE` در README داکیومنت شده اما هیچ کس آن را نمی‌خواند
- `release-preflight.mjs` field `sdk` همیشه null است (SDK نام پکیج عوض شده)
- `config/config.json` هنوز مرده (LOW-05 باز)

---

## ۷. جدول أولویت‌بندی شده (Priority Matrix)

### P0 — قبل از production عمومی (HTTP/tunnel)
| # | یافته | فایل | کار لازم |
|---|---|---|---|
| ۱ | **N-1** — rate limit پیش از احراز هویت | `http-server.ts:305-311` | publicLimiter را به 401 path بسط دهید |
| ۲ | **N-2** — /metrics cross-principal | `http-server.ts:202,227` | `principalId` را به `getAgentMetrics` پاس دهید |
| ۳ | **N-3** — chunked body cap | `http-server.ts:348-351` | cap واقعی روی stream bytes |
| ۴ | **SCRIPT-1** — mcp-token.ps1 | `scripts/mcp-token.ps1` | rewrite یا حذف + اضافه شدن به secret-policy gate |

### P1 — کیفیت فنی
| # | یافته | کار لازم |
|---|---|---|
| ۵ | package-handler.ts صفر تست | تست رفتاری بنویسید (مسیر task package mutation) |
| ۶ | نشت SDK به src/mcp | guard test بسط دهید (۹ لایه) |
| ۷ | دور core↔composition | port در core/executor قرار دهید |
| ۸ | تکرار rotation | یک共享 module abstraction |
| ۹ | دو TaskState رقیب | یکپارچه‌سازی |

### P2 — بهداشت (Hygiene)
- حذف: `config/config.json`، `.freebuff/`، ۳۷ دایرکتوری خالی `runtime-files-*`، دایرکتوری‌های خالی `src/application/handlers/*` + `use-cases/{auth,monitoring}`
- `scripts/mcp-dashboard/` حذف یا document
- `.gitignore` برای `HooshiX_EAAP_Implementation_Package/` (یا دلایل نگه‌داشتنش)
- DOC-1: default permission در OPERATIONS.md + README اصلاح
- تست floor list: حذف shim‌های خالی، افزودن executor/service layer
- dynamic import توضیح‌داده نشده در `tools/task/index.ts:240` — کامنت یا static کردن
- singleton `createTaskRuntimeService` در module scope — به composition root منتقل

---

## ۸. جمع‌بندی

**پاسخ به سوال شما "آیا کد مخرب هست؟"** — خیر، صفر. پروژه از نظر قصد امنیتی بسیار جدی است: single choke-point در child process، Allowlist env، OAuth واقعی با expiry/rotation/replay-detection، denylist حساس در search، unrestricted mode غیرممکن شده در runtime.

**پاسخ به "سورس نیمه‌تمام که ادعا شده کامل"** — stubs در `src/tools/` عمدی و کامل هستند. اما `scripts/mcp-dashboard/` (یتیم)، دایرکتوری‌های خالی `application/handlers/*` و `use-cases/{auth,monitoring}` (هگزاگون نیمه‌ساخته)، facadeهای مرده در core، و ادعای گارد معماری (که ۳ از ۹ لایه را پوشش می‌دهد) — این‌ها واقعاً کار نیمه‌تمام هستند که документ آن‌ها را "اجرا شده" توصیف می‌کند.

**پاسخ به "کد تکراری"** — یک تکرار واقعی منطقی (rotation Audit) + یک تکرار واقعی دیتا (TaskState). بقیه facadeها و interface twins طراحی‌محور هستند، نه duplication مضر.

**قوی‌ترین قسمت:** امنیت اجرایی + تست exploit regression (فوق‌العاده بهبود یافته).
**ضعیف‌ترین قسمت:** مرزهای ماژول (architecture enforcement) + سه یافته MEDIUM جدید در لایه HTTP که remediation را نیمه‌تمام رها کرده‌اند.
