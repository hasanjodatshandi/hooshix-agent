# ممیزی و اصلاح شواهدمحور HooshiX Agent — ۱۴۰۵/۰۷/۱۰ (۲۰۲۶-۱۰-۰۲)

## ۱. Executive summary

این نشست در پی دو کمبود معماری شناسایی‌شده توسط یک دستیار ممیز روی این پروژه انجام شد:
۱) **Task مستقیماً `projectId` نداشت** — تنها پیوند یک ردیف `memory_items` با `task_ref` بود، پس لیست کردن taskهای یک پروژه نیازمند اسکن memory بود و توسط schema قابل اعمال نبود.
۲) **Memory API عملیات `update` مستقیم نداشت** (فقط add/get/list/delete) — برای تاریخچه مناسب بود ولی برای current state قابل‌تغییر ایدئال نبود.

هر دو اصلاح شدند، همهٔ توضیحات/مثال‌های ابزارها با کد همگام شدند، و در مسیر کار یک **نشتی دیتابیس تولید توسط تست‌ها** کشف و بسته شد.

**خلاصهٔ تغییرات:**
- Migration 21: `tasks.project_id` + `memory_items.updated_at` (افزودنی، اختیاری، backward-compatible).
- `task_create`/`task_list` پارامتر `projectId` را می‌پذیرند؛ `TaskPlan` آن را حمل می‌کند؛ مسیر جدید: `Project → memory_list(projectId) → task_list(projectId) → task_get(taskId)`.
- ابزار جدید `memory_update` (update درجا، principal-scoped). مجموعهٔ ابزارها ۵۲ → ۵۳.
- ۱۴ توضیح/مثال ابزار که با کد هم‌خوانی نداشتند اصلاح شدند (از جمله مثال `memory_update` که آبجکت می‌داد درحالی‌که schema رشته می‌خواست).
- دو ورودی stale در README (لیست `package_restore` و اشارهٔ متنی به آن) حذف شدند.
- **CRITICAL-01:** تست‌ها دیتابیس تولید را باز و migration/می‌زدند. علت و اصلاح در §۵.

سطح نهایی: ۸۷۲ تست / ۱۹۵ فایل سبز؛ build تمیز؛ lint سبز؛ سرور زنده روی کد جدید (PID 22580).

## ۲. Scope, safety & exclusions

- **دیتابیس تولید هرگز دستکاری نشد.** فقط migration 21 (افزودنی) توسط خود سرور اعمال شد و یکپارچگی آن تأیید شد (`quick_check = ok`، `foreign_key_check` خالی).
- `data/agent-memory.db` (دادهٔ زنده) خوانده شد (readonly) تنها برای forensic تایید نشتی. هیچ ردیفی از آن حذف/تغییر نیافت.
- `docs/TOOLS.md` با generator رسمی تولید شد (`node scripts/generate-tools-doc.mjs`)، نه ویرایش دستی.
- **commit/push فقط با تأیید صریح کاربر** انجام شود (در این نشست انجام نشد).

## ۳. یافته‌های ثبت‌شده در این نشست

### CRITICAL-01 — تست‌ها دیتابیس تولید را باز می‌کردند و migration را روی آن اجرا می‌کردند

**علت ریشه‌ای:** `tests/security/r4-db-identity.test.ts` در `afterEach` این کار را می‌کرد:
```ts
afterEach(() => {
  resetAgentDatabase();
  delete process.env.HOOSHIX_DB_PATH;   // ← متغیر محیطی حذف می‌شود
  wipe();
});
```
سپس `beforeEach` سراسریِ `tests/setup/database-cleanup.ts` (که برای تست بعدی در همان worker اجرا می‌شود) `replaceWorkspaceRoots(process.cwd())` را صدا می‌زند که از `withAgentDatabase` → `openAgentDatabase` استفاده می‌کند. چون `HOOSHIX_DB_PATH` حذف شده، `parseDatabasePath` به پیش‌فرض `./data/agent-memory.db` برمی‌گردد — **دیتابیس تولید**. `withAgentDatabase` همچنین `runMigrations` را روی آن اجرا می‌کند.

**اثر اثبات‌شده:** migration 21 در `2026-10-01T23:31:34Z` — دقیقاً ۱۶ ثانیه بعد از شروع اولین `vitest run` — روی دیتابیس تولید اعمال شد (با تحلیل `schema_migrations.applied_at` در برابر timestamp شروع vitest و mtime فایل WAL تطابق کامل داشت). همچنین `replaceWorkspaceRoots` سطر `workspace_roots` مربوط به مسیر ریپو را آپدیت کرد (`updated_at` از `2026-09-19` به `2026-10-02T01:43:52Z`) — تنها نشتی دادهٔ واقعی، که روی یک سطر قانونی موجود بود و بی‌اثر عملی است.

**تاریخچه:** این باگ از قبل از حذف `package_restore` وجود داشته (آن ابزار یک control tool بود و `CONTROL_TOOL_NAMES` ۲۳ عضو داشت)؛ چون تا امروز هرگز migration جدیدی اضافه نشده بود، این نشتی هرگز دیده نشد — تنها زمانی آشکار شد که migration 21 اولین migration پس از چند هفته بود.

**اصلاح (دو لایه + نگهبان regression):**
1. `r4-db-identity.test.ts`: `afterEach` به‌جای حذف، مقدار ارث‌رسیده را بازمی‌گرداند.
2. `tests/setup/database-cleanup.ts`: `beforeEach` حالا `process.env.HOOSHIX_DB_PATH = databasePath` را **قبل از هر کاری که دیتابیس را باز کند** re-assert می‌کند — setup مالک این متغیر است.
3. `tests/core/r8-parallel-isolation.test.ts`: نگهبان source-level جدید که re-assertion را الزامی می‌کند.

**تأیید:** یک پروب WAL mtime قبل/بعد نوشته شد؛ قبل از اصلاح کل suite دیتابیس زنده را لمس می‌کرد، بعد از اصلاح کاملاً تمیز است.

### DOC-01 — توضیحات و مثال‌های ابزارها با کد هم‌خوانی نداشتند

ممیزی سیستماتیک همهٔ ابزارهای ثبت‌شده (description در برابر inputSchema و handler). موارد اصلاح‌شده:

| ابزار | فایل | مشکل | شدت |
|---|---|---|---|
| `memory_update` | `tools/task/index.ts` | مثال یک **آبجکت JSON** می‌داد درحالی‌که schema `z.string()` می‌خواست — هر فراخوانی مطابق مستندات fail می‌شد | HIGH |
| `git_commit` | `tools/git/index.ts` | به کد خطای ناموجود `git_identity_missing` اشاره می‌کرد؛ خطای واقعی پیام خود git است | HIGH |
| `project_save` | `tools/task/index.ts` | مثال update فیلد **الزامی** `path` را نداشت؛ رد کردن اسم تکرار ذکر نشده بود | MEDIUM |
| `task_snapshot` | `tools/task/index.ts` | ادعا می‌کرد snapshot از workspace dirty هم می‌گیرد؛ در واقع فقط clean را می‌پذیرد | MEDIUM |
| `task_rollback` | `tools/task/index.ts` | الزامی بودن تطابق branch ذکر نشده بود | MEDIUM |
| `add_workspace_roots` | `tools/system/workspace.ts` | استثنای pool خالی (اولین root هم active می‌شود) ذکر نشده بود | MEDIUM |
| `task_reconcile` | `tools/task/index.ts` | آرگومان‌های الزامی (`taskId`, `stepId`, `evidence` ۱۲–۴۰۰۰ کاراکتر) و دامنهٔ ownership (principal + session) ذکر نشده بود | MEDIUM |
| `task_run` | `tools/task/index.ts` | ادعای "Idempotent" نادرست بود — re-run یک task **failed** steps را دوباره اجرا می‌کند | LOW |
| `read_file` | `tools/filesystem/read-file.ts` | آرگمان مستند‌نشده `includeSha256` | LOW |
| `write_file` / `modify_file` | `tools/filesystem/*.ts` | پارامترهای مستند‌نشده `ifMatchSha256` / `idempotencyKey` | LOW |
| `delete_file` | `tools/filesystem/delete-file.ts` | پارامتر مستند‌نشده `idempotencyKey` | LOW |
| `execute_command` | `tools/shell/execute-command.ts` | حداقل timeout (۱۰۰ms) و ماهیت exact-argvِ auto-allow (هر flag آن را approval-required می‌کند) نادرست بود | LOW |
| `*_package` | `tools/package/index.ts` | `verificationSkipped` برای go/maven و کران‌های timeout ذکر نشده بود | LOW |
| `agent_metrics` | `tools/system/agent-metrics.ts` | `workflowFailedActions` شامل ردیف‌های `category IS NULL` (legacy) است، نه فقط `category='workflow'` | LOW |
| `memory_add` | `tools/task/index.ts` | حالت unscoped (بدون taskId/projectId) ذکر نشده بود | LOW |

### DOC-02 — README دارای ورودی‌های stale بود و نگهبان stale-detection از نظر منطقی قادر به تشخیص نبود

- خط ۳۹ README هنوز `package_restore` (ابزار حذف‌شده در نشست قبل) را لیست می‌کرد؛ خط ۲۵۴ نیز در متن فارسی به آن اشاره می‌کرد. هر دو حذف شدند.
- **نقص تست:** `R7.10` (stale detection) در `r7-documentation-contract.test.ts` نام‌ها را فقط در صورتی جمع می‌کرد که **از قبل ثبت‌شده** باشند (`if (ALL_REGISTERED_TOOLS.includes(name))`) — پس هر نام stale‌ای ساختاراً نامرئی بود. این دلیل بقای `package_restore` در README برای دو release بود.
- **اصلاح:** تست بازنویسی شد تا block لیست ابزار README (خطوط `- ` زیر عنوان «ابزارهای MCP») را parse کند و هر نام آنجا را در برابر `ALL_REGISTERED_TOOLS` اعتبارسنجی کند. با برگرداندن موقت `package_restore` تأیید شد که اکنون آن را می‌گیرد.

## ۴. قابلیت‌های جدید

### ۴.۱ اتصال مستقیم Task ↔ Project

مسیر قبلی: `Project → Memory task_ref → Task ID` (نیازمند اسکن memory، بدون اعمال schema).
مسیر جدید: `Project → memory_list(projectId) → task_list(projectId) → task_get(taskId) → Resume/Repair/New Task`.

- `task_create` پارامتر اختیاری `projectId: z.string().uuid()` را می‌پذیرد؛ روی `TaskPlan.projectId`set و در ستون `tasks.project_id` ذخیره می‌شود.
- `task_list` پارامتر اختیاری `projectId` می‌گیرد و با SQL فیلتر می‌کند (`WHERE project_id = ?`، ایندکس `idx_tasks_project_id`).
- `task_get` مقدار `projectId` را برمی‌گرداند.
- binding در زمان create تنظیم می‌شود و هرگز rebinding نمی‌شود (`project_id=COALESCE(excluded.project_id, tasks.project_id)` در `ON CONFLICT`).
- اختیاری است: taskهای موجود (پیش از migration 21) و taskهای بدون پروژه همچنان معتبرند.
- memory itemی که runtime برای `task_created` می‌نویسد حالا `projectId` را هم ثبت می‌کند.

### ۴.۲ `memory_update`

- `memory_update(memoryId, kind?, content?)` — update درجا روی `memory_items`.
- حداقل یکی از `kind`/`content` الزامی است (در غیر این صورت `INVALID_ARGUMENT`)؛ content نمی‌تواند خالی باشد.
- principal-scoped: سطرِ owner دیگر آپدیت نمی‌شود (`updated: false`).
- `updated_at` روی سطر set می‌شود (ستون جدید).
- در catalog: risk=medium, approval=on-risk, category=Context & Memory.

## ۵. تست‌ها

- شمارش‌های hardcode به‌روزرسانی شدند: `r2-operation-catalog` و `in-process-tools` (۵۲ → ۵۳ ابزار)، `real-mcp-process` (افزودن `memory_update`).
- تست‌های رفتاری جدید در `in-process-tools.test.ts`: اتصال `projectId` و فیلتر `task_list`، و رفتار `memory_update` (update درجا، رد کردن update خالی).
- تست‌های repository جدید در `project-memory-repository.test.ts`: فیلتر `listTasks(projectId)`، update درجا، مالکیت principal.
- نگهبان regression برای CRITICAL-01 (در `r8-parallel-isolation.test.ts`) و برای DOC-02 (در `r7-documentation-contract.test.ts`).

## ۶. تأیید نهایی

| بررسی | نتیجه |
|---|---|
| `pnpm run build` | تمیز (۰ خطای TS) |
| `npx vitest run` | ۸۷۲ تست / ۱۹۵ فایل سبز |
| `pnpm run lint` | سبز |
| پروب نشتی دیتابیس تولید (WAL mtime قبل/بعد) | تمیز |
| یکپارچگی دیتابیس تولید | `quick_check = ok`، `foreign_key_check = []` |
| سرور زنده | PID 22580، `/health/live` و `/health/ready` هر دو ۲۰۰، روی dist جدید |
| شمارش ابزار سرور زنده | ۵۳ (شامل `memory_update` و `projectId` روی `task_create`/`task_list`) |
| `docs/TOOLS.md` | تولیدشده توسط generator، idempotent، ۵۳ ابزار (۲۹ step + ۲۴ control) |

## ۷. کارهای باقی‌مانده (پیشنهاد)

- **commit/push:** تمام تغییرات این نشست هنوز uncommitted هستند و نیازمند تأیید صریح کاربر هستند.
- **ADR:** اتصال مستقیم Task↔Project و تصمیم «اختیاری بودن `projectId` برای backward compatibility» ارزش یک ADR دارد.
- **skillهایی که از `task_ref` استفاده می‌کنند** حالا می‌توانند به `task_list(projectId)` مهاجرت کنند؛ memory همچنان برای تاریخچه مناسب است.
