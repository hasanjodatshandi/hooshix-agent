# اصلاح یافته‌های ممیزی End-to-End — ۲۰۲۶-۱۰-۰۲

## ۱. Executive summary

یک ممیزی عملی End-to-End تمام ۵۳ ابزار ثبت‌شده را از مسیر کلاینت واقعی (ChatGPT از طریق `/mcp`) invoke کرد — نه فقط بررسی schema، بلکه happy path، failure path، governance، approval، replay، recovery، rollback، idempotency، isolation و cleanup. نتیجه: ۵۱/۵۳ ابزار مسیر موفق عملی داشتند و ۸ نقص واقعی شناسایی شد. این سند اصلاح آن هشت مورد است.

تمام اصلاحات این نشست روی کد `main` اعمال شد. سرور زنده باید restart شود تا dist تازه سرو شود (§۶).

## ۲. یافته‌ها و اصلاحات

### CRITICAL — بن‌بست Approval در `project_delete` / `memory_delete`

**علت:** catalog این دو ابزار را `approval: "always"` معرفی می‌کرد. `approval: "always"` تنها از طریق یک Task step با تاییدیهٔ یکبارمصرف قابل ارضا است، اما این دو ابزار control-plane هستند و در `TOOL_NAMES` (مجموعهٔ step-executable) نیستند؛ `task_create.steps[].tool` آن‌ها را رد می‌کرد. در نتیجه: فراخوانی مستقیم می‌گوید `verified_task_approval_required`، و هیچ مسیری برای ارائهٔ آن approval وجود ندارد. ابزارها عملاً غیرقابل‌استفاده بودند و دو record آزمایشی تولید به‌خاطر همین deadlock قابل حذف نماندند.

**اصلاح:** `approval: "always"` → `"on-risk"` در `OPERATION_CATALOG` برای هر دو ابزار — دقیقاً مثل هر ابزار control-plane مخرب دیگر (`project_save`، `project_archive`، `memory_add`، `memory_update`، `task_cancel`، `task_link`). `risk: "high"` و `destructiveHint: true` حفظ شده‌اند، پس `task_step_risks` و audit همچنان آن‌ها را پرریسک علامت می‌زنند.

**تست:** `tests/e2e/r2-control-plane-delete-and-failure-reasons.test.ts` هر دو ابزار را از مسیر in-process MCP واقعی اجرا و حذف موفق را تأیید می‌کند. تست قبلی `in-process-tools.test.ts` که deadlock را به‌عنوان رفتار مطلوب چک می‌کرد، بازنویسی شد.

### HIGH — `read_file(includeSha256=true)` قرارداد خودش را رعایت نمی‌کرد

**علت:** `executeAuthorizedDirectTool` هش را به‌عنوان یک فیلد خواهری در top-level پاسخ MCP می‌گذاشت (`{path, text, length, sha256, content:[...]}`). اما `CallToolResult` در MCP فقط `content` / `structuredContent` / `isError` را می‌پذیرد؛ کلاینت‌های سخت‌گیر فیلدهای اضافه را حذف می‌کنند. پس کلاینت فقط `content` را می‌دید و هرگز هش را — یعنی workflow استاندارد safe read-modify-write (`ifMatchSha256`) از همین API قابل اجرا نبود.

**اصلاح:** وقتی `includeSha256` فعال است، payload داخل content block به `JSON.stringify({content, sha256})` تبدیل می‌شود — دقیقاً همان چیزی که توضیحات ابزار قول می‌دهد. مسیر Task دست‌خورده نیست (آنجا خروجی آبجکت حفظ می‌شود و `{{stepN.output.sha256}}` کار می‌کند).

**تست:** `tests/e2e/r2-file-cas-real-parity.test.ts` به‌روزرسانی شد تا شکل جدید را تأیید کند.

### HIGH — `idempotencyKey` در ابزارهای File بین workspaceها برخورد می‌کرد

**علت:** `normalizeRequest` کلید را از مسیر **خام آرگومان** (اغلب نسبی) می‌ساخت، نه مسیر کانونیکال مطلق. پس دو workspace مستقل با همان کلید + همان مسیر نسبی + همان محتوا، یک request hash یکسان داشتند و نوشتن/حذف دوم، پاسخ کش‌شدهٔ workspace اول را برمی‌گرداند **بدون آنکه اثری در workspace دوم بگذارد**. این توضیح می‌دهد چرا `write_file` با key روی دو workspace و `delete_file` با key شکست می‌خوردند اما بدون key موفق می‌شدند.

**اصلاح:** کلید idempotency حالا روی مسیر کانونیکال مطلق (خروجی `validateWorkspace`) بسته می‌شود و cache lookup در `write_file` بعد از resolve شدن مسیر انجام می‌شود. همان key در دو workspace دو entry مجزا است.

**تست:** `tests/core/r2-file-idempotency-workspace-scoping.test.ts` (۴ سناریو: برخورد workspaceها، replay در همان workspace، delete متقاطع، و شکل خروجی includeSha256).

### HIGH — مقایسهٔ case-sensitive ریشهٔ workspace در ویندوز

**علت:** `local-tool-executor.ts` با `capturedRoots.includes(active)` و gateway approval verifier با `(ctx.allowedRootsSnapshot??ctx.roots).includes(scope.root)` مقایسهٔ سادهٔ رشته‌ای می‌کردند. در ویندوز مسیرها case-insensitive هستند، پس Taskای که در `C:\WINDOWS\TEMP` ساخته شده بود با captured rootی به شکل `c:\WINDOWS\TEMP` با `task_workspace_not_in_captured_roots` (و در verifier، رد تاییدیه) شکست می‌خورد.

**اصلاح:** `sameRootIdentity` (کانونیکال‌سازی case-insensitive در win32) از `workspace-guard.ts` export شد و در هر دو نقطه به‌جای `Array.includes` به‌کار رفت. مسیرهای غیر-win32 به همان حالت case-sensitive باقی می‌مانند.

**تست:** `tests/core/local-tool-executor-root-casing.test.ts` — workspace با case متفاوت پذیرفته می‌شود، اما workspaceای که واقعاً جزو captured roots نیست همچنان رد می‌شود.

### MEDIUM — `STALE_WRITE` به error contract مستندشده تبدیل نمی‌شد

**علت:** `write_file`/`modify_file` با `ifMatchSha256` نادرست خطایی با `errorType: "STALE_WRITE"` پرتاب می‌کردند، اما `classifyHandlerFailure` آن را نمی‌شناخت → کلاینت یک `tool_handler_failure` عمومی و غیرقابل‌تمایز می‌گرفت. خود mutation انجام نمی‌شد (data integrity حفظ شد)، اما error contract خراب بود.

**اصلاح:** `classifyHandlerFailure` حالا پیام `STALE_WRITE` را به reason پایدار `stale_write` نگاشت می‌کند.

### MEDIUM — خطاهای معنایی به `tool_handler_failure` فرومی‌پاشیدند

**علت:** خطاهایی مثل payload تغییرکرده با idempotency key تکراری، نام پروژهٔ تکراری، محتوای memory خالی، حذف root فعال، append به Task terminalی و preconditionalهای File، هیچ‌کدام در کلاسه‌بند تطبیق نمی‌شدند و همه یک برچسب غیرشفاف می‌گرفتند — کلاینت مجبور به blind-retry بود.

**اصلاح:** `classifyHandlerFailure` حالا ابتدا کد تایپشدهٔ `AgentError` را به‌صورت ساختاری (بدون import هسته، برای حفظ layering) نگاشت می‌کند (`MEMORY_CONTENT_REQUIRED` → `memory_content_required`، …) و سپس چند heuristic پیام اضافه کرد: `cannot_remove_active_workspace`، `duplicate_project_record`، `task_append_rejected`، `reconciliation_state_invalid`.

**تست:** سه سناریو در `tests/e2e/r2-control-plane-delete-and-failure-reasons.test.ts` برچسب‌های `stale_write`، `memory_content_required` و `task_append_rejected` را از مسیر MCP واقعی تأیید می‌کنند.

### MEDIUM — `task_report.reflection` برای Task ناموفق، موفقیت گزارش می‌کرد

**علت:** reflection engine فقط جدول `executions` را می‌خواند. forensic روی دیتابیس تولید نشان داد برای Taskای که timeout خورده و به `reconciled_failed` رسیده بود، این جدول **کاملاً خالی** است — وضعیت واقعی فقط در `tasks`/`task_steps` است. پس reflection می‌نوشت: «No execution failure recorded / No failure detected / Existing execution path succeeded» و یک agent بالادستی را به اشتباه می‌انداخت.

**اصلاح:** plan حالا مرجع تعیین‌کننده است: اگر execution rowای برای شکست نیامد ولی Task durable به `failed` ختم شده و stepهایی با وضعیت `failed`/`reconciled_failed` دارد، reflection از خود plan (شامل error و یافتهٔ reconciliation) ساخته می‌شود و دیگر هرگز موفقیت را ادعا نمی‌کند.

**تست:** دو سناریوی جدید در `tests/core/reflection-engine.test.ts` (reconciled_failed بدون execution row، و Task ناموفق با execution rowهای موفق).

### Runtime — `python` / `py` در این ماشین timeout می‌شوند

`python --version` و `py --version` حتی در ۵ ثانیه timeout شدند، در حالی که Node/npm/pnpm/git در همان محیط بی‌مشکل اجرا شدند. این یک نقص در `execute_command` نیست — به نصب Python و Windows Python Install Manager روی این ماشین مربوط است (که در حین probe خودش را update کرد و `Python/_cache` ساخت؛ artifact پاک شد). **اصلاح کدی لازم ندارد**؛ اگر Python نیاز است، runtime محلی باید بررسی شود.

## ۳. آنچه عمداً تغییر نکرد

- **هیچ ردیفی از دیتابیس تولید حذف یا تغییر نشد.** دو record آزمایشیِ باقی‌مانده از ممیزی (که به‌خاطر governance deadlock قابل حذف نبودند) دست‌نخورده باقی می‌مانند؛ اکنون که deadlock رفع شده، کلاینت می‌تواند آن‌ها را از طریق `project_delete`/`memory_delete` پاک کند.
- `approval: "always"` برای ابزارهای step-executable مخرب (`delete_file`، `git_*`، `package_*`، `task_rollback`، `add_workspace_roots`) دست‌نخورده باقی ماند — آن‌ها مسیر approval واقعی دارند.
- `modify_file` همچنان `idempotencyKey` نمی‌پذیرد (در schema registration نیست)؛ دامنهٔ این اصلاح فقط `write_file`/`delete_file` بود که audit آن‌ها را گزارش کرد.

## ۴. تأییدها

- **۸۸۴ تست / ۱۹۸ فایل سبز** (از ۸۷۲/۱۹۵)، شامل ۹ تست regression جدید.
- build تمیز (`tsc` بدون خطا)، lint سبز (`G1_GLOBAL PASS`، `R7_SECRET_POLICY_PASS`).
- `docs/TOOLS.md` با generator رسمی بازتولید شد (فقط دو ردیف approval تغییر کردند).
- **نشتی دیتابیس تولید بررسی شد:** بیشترین `created_at` در تمام جداول کلیدی (`tasks`، `task_steps`، `projects`، `memory_items`، `executions`، `file_backups`) قبل از `05:09` امروز متوقف می‌شود، یعنی هیچ اجرای تستی امروز روی تولید ننوشته است. تغییر mtimeٔ WAL ناشی از checkpoint اتصال سرور زنده است، نه نوشتهٔ تست.

## ۵. اولویت پیشنهادی برای کار بعدی

- **ADR برای تصمیم «control-plane deletes مستقیم‌اجرا هستند»** — این سند علت را توضیح می‌دهد ولی یک ADR رسمی در ledger بهتر است.
- تست integration واقعی روی Windows برای canonicalization (این نشست با unittest درست‌سازی‌شده پوشش داد).
- زنجیرهٔ cleanup خودکار برای recordهای آزمایشی باقی‌مانده در تولید.

---

## ۶. retest روی HEAD `a29496f` — دو باقیماندهٔ واقعی

ممیزی دوباره تمام ایرادهای قبلی را روی HEAD `a29496f` اجرا کرد. ۱۱ مورد FIXED تأیید شدند (از جمله مسیر کامل CAS، Windows root casing با Task واقعی در `C:\WINDOWS\TEMP`، و reflection برای Task reconciled-failed). ولی سه مورد باقی ماند:

### HIGH — file idempotency روی دیتابیس موجود هنوز خراب بود (ریشه: migration، نه logic)

تست‌های fresh-DB سبز بودند ولی همان قابلیت روی دیتابیس زنده `tool_handler_failure` می‌داد. forensic فقط‌خواندنی نشان داد:

- migration head = ۲۱، ولی `idempotency_responses` **وجود ندارد**.
- این جدول **فقط** در `base-schema.migration.ts` (v0 baseline برای DBهای تازه‌ساخت) تعریف شده بود و هیچ `migrate()`ای آن را برای DBهای موجود نمی‌ساخت.

این یک ردهٔ نقص مهم است: **تست‌های fresh-DB از نظر ساختاری نمی‌توانند چنین شکست upgradeای را ببینند**، چون جدول در هر DB تستی به‌صورت خودکار موجود است.

**اصلاح:** migration 22 (`file-idempotency-response-cache-table`) با `CREATE TABLE IF NOT EXISTS` اضافه شد؛ `LATEST_MIGRATION_VERSION` ۲۱ → ۲۲. سرور زنده restart شد و migration روی دیتابیس تولید اعمال شد: head = 22، جدول با PK صحیح `(id, operation, request_hash)`، `quick_check = ok`، `foreign_key_check` خالی.

**تست:** `tests/core/r6-idempotency-responses-upgrade.test.ts` — یک DB را در head پیش-۲۲ و بدون جدول seed می‌کند (شبیه‌سازی دقیق DB زنده)، سپس (۱) upgrade مستقیم و بررسی PK، و (۲) repair از طریق همان entrypointی که سرور باز می‌کند (`withAgentDatabase` → `runMigrations`) با تأیید قرارداد dedup.

**قانون مستندسازی:** هر جدول آینده که به `base-schema.migration.ts` اضافه می‌شود باید یک `migrate()` هم داشته باشد (یا دلیل fresh-only بودن به‌صراحت نوشته شود). در `docs/MIGRATIONS.md` بخش «Fresh-only tables» اضافه شد.

### MEDIUM — `idempotency_key_payload_conflict` هنوز به `tool_handler_failure` فرومی‌پاشید

`task-runtime-service` خطای صحیح `idempotency_key_payload_conflict` را پرتاب می‌کرد ولی MCP surface آن را به `tool_handler_failure` تبدیل می‌کرد، پس کلاینت مجبور به blind-retry یک درخواستی بود که هرگز موفق نمی‌شد.

**اصلاح:** `classifyHandlerFailure` حالا این خطای قطعی را مستقیماً عبور می‌دهد (`idempotency_key_payload_conflict`) و دو خطای خواهرش (`idempotency_key_inconsistent`، `idempotency_key_legacy_hash_missing`) را به `idempotency_key_inconsistent` نگاشت می‌کند.

**تست:** `tests/e2e/r2-control-plane-delete-and-failure-reasons.test.ts` برچسب را از مسیر in-process MCP واقعی تأیید می‌کند.

### Environment — `python` / `py`

هر دو همچنان در ۵ ثانیه timeout می‌شوند در حالی که Node/npm/pnpm/git بی‌مشکل کار می‌کنند. مستقل از `execute_command` و مربوط به نصب Python و Windows Python Install Manager این ماشین است. **بدون تغییر کد.**

### تأییدهای retest

- ۸۸۷ تست / ۱۹۹ فایل سبز (۳ تست regression جدید).
- build تمیز، lint سبز.
- دیتابیس تولید: migration 22 اعمال شد، یکپارچگی سالم، هیچ ردیف داده‌ای تغییر نکرد.
