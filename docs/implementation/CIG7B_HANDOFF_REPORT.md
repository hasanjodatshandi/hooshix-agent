# گزارش تحویل — طرح Chat Isolation (CI_MASTER_PLAN) برای دستیار بعدی

**تاریخ:** 2026-10-10
**وضعیت کلی:** گیت‌های CI-G0 تا CI-G8 + بخش فنی CI-G9 بسته و push شده‌اند. کار باز: **CI-G7b (تست میزبان واقعی ChatGPT)** و بعد **CI-G9b (تست Linux + امضای مالک)**.
**مرجع اصلی:** `docs/implementation/CI_MASTER_PLAN.md` (پلن گیت‌ها و قواعد اجرایی) — این سند فقط وضعیت اجرا و کارهای باقی‌مانده را ثبت می‌کند.

---

## ۱. خلاصهٔ اجرایی — چه چیزی ساخته شد

این طرح به صورت leaf-by-leaf و پشت feature flag `CTX_ISOLATION_MODE` پیاده شد. **پیش‌فرض `OFF` است و رفتار production تغییری نکرده است.**

| گیت | وضعیت | محتوا |
|---|---|---|
| CI-G0 | ✅ | سند تصمیم: `SERVER_SIDE_READY / HOST_VERIFICATION_PENDING` |
| CI-G1 | ✅ | نهادهای دامنه (`src/domain/context/*`)، VerifiedPrincipal/ExecutionEnvelope، ۱۰ کد خطای CI با anti-enumeration، تست تزریق — commit های `48d7312` به قبل |
| CI-G2 | ✅ | migration 23 (۶ جدول control: `context_registry`, `context_binding`, `workspace_grant`, `ownership_lease`, `handoff_intent`, `security_audit`)، migration 24 (`principal_id`)، صدور principal مجزا (`establishConnection`)، Context Resolver deny-by-default، Legacy Context پین‌شده |
| CI-G3 | ✅ | SHADOW mode روی مسیر زنده (observer با audit، هرگز throw نمی‌کند؛ در OFF کاملاً no-op) |
| CI-G4 | ✅ | enforcement واقعی: در `PER_CONNECTION` هر resolution غیر RESOLVED → ۴۰۳ با sentinel ثابت، fail-closed، قبل از هر session/side effect |
| CI-G5 | ✅ | Task fencing: migration 25 (چهار ستون context روی `tasks` + `task_leases.context_id`)، epoch fence درون transaction، `outcome_unknown` ترمینال بدون retry، stress ۱۰۰ task / ۱۰ context — ۱۹ تست |
| CI-G6a+b | ✅ | Owner Console: سرویس دوفازی transfer (prepare→approve→commit با rebind اتمیک + epoch bump)، مسیرهای `/admin/*` با session جدا + CSRF + reauth + one-time ticket — ۲۶ تست |
| CI-G7a | ✅ | ابزار **`chat_isolation_probe`** (فقط‌خواندنی، خروجی فقط pseudonym ۱۲ hex) — ۵ تست live |
| CI-G8a+b | ✅ | rollback rehearsal (چرخه OFF→SHADOW→PER_CONNECTION→OFF→SHADOW) + runbook `CIG8_ROLLOUT_RUNBOOK.md` |
| CI-G9a | ✅ | suite سبز (۱۰۶۶ تست/۲۲۰ فایل)، benchmark (OFF ~۰.۷µs)، سند `CIG9_FINAL_DELIVERY.md`، `docs/MIGRATIONS.md` (۲۲→۲۵)، `docs/TOOLS.md` (۵۵ ابزار، auto-generated) |
| **CI-G7b** | 🟡 **در جریان — این کار باقی‌ماندهٔ اصلی است** | تست دو چت واقعی ChatGPT + ثبت سطح A/B/C در `CIG7_HOST_OUTCOME.md` |
| **CI-G9b** | ⬜ معوق | تست روی Linux + امضای مالک در `CIG9_FINAL_DELIVERY.md` |

آخرین کامیت‌ها: `b592dbf` (G7a) → `9480c65` (G8) → `eb2cd78` (G9a) → `016f722` (timeout پیش‌فرض + ADMIN_MODE).

---

## ۲. زیرساخت آزمایشی که برای CI-G7b ساخته شد (کد نیست، عملیات است)

1. **سرور MCP محلی** = همین دستگاه ویندوز، `node dist/index-http.js` روی `127.0.0.1:3001`، از طریق scheduled task `HooshiX Node.js MCP v2` → `scripts/hooshix_nodejs_mcp_watchdog.ps1` اجرا می‌شود.
2. **مسیر ترافیک ChatGPT:** `ChatGPT → https://mcp.hooshix-agent.ir (Caddy سرور لینوکس) → gateway (tunnel.hooshix-agent.ir) → این دستگاه → 127.0.0.1:3001`. gateway در `C:\Program Files\HooshiXAgent` (پروژهٔ Go در `D:\Projects\hooshixagent`) صرفاً یک **TCP tunnel** است (فقط `io.Copy`؛ بدون HTTP parsing).
3. **`HOOSHIX_PUBLIC_BASE_URL=https://mcp.hooshix-agent.ir`** — هم در User scope ویندوز و هم (تغییر uncommitted) در watchdog ست شده تا discovery/issuer دقیقاً با host مورد انتظاب ChatGPT بخواند. دامنهٔ `mcp.hooshix.com` از رده خارج است.
4. **پروفایل‌های tunnel جدید HTTP:** `hooshix-http.yaml` / `hooshix-http-2.yaml` + لانچر `start-tunnel-http.ps1` / `start-tunnel-http-2.ps1` (فایل‌های قدیمی `local-stdio*` و `start-tunnel*.ps1` دست‌نخورده بمانند).
5. **دو connector در ChatGPT** ساخته شد؛ OAuth کامل (DCR→authorize→token→initialize→tools/list با **۵۵ ابزار شامل `chat_isolation_probe`**) هم از localhost و هم از URL عمومی با اسکریپت‌های probe اثبات شد.

### تغییرات uncommitted (بسته‌شده ۲۰۲۶-۱۰-۱۱)

- `scripts/hooshix_nodejs_mcp_watchdog.ps1` — **کامیت شد** (حالا `CTX_ISOLATION_MODE=OFF` پین دارد). تصمیم نهایی پس از اثبات عملی: زندان per-Context زیر `PER_CONNECTION` ورک‌اسپیس انتخابی را می‌پوشاند و handle اجازه گشادکردن زندان ندارد → جداسازی چت↔پروژه با handle (G6) در آن حالت غیرممکن بود. سایر پین‌ها (`HOOSHIX_DB_PATH=D:\workspace\hooshix-agent\data\experiment-1.db`، `HOOSHIX_PUBLIC_BASE_URL=https://mcp.hooshix-agent.ir`، `HOOSHIX_DIRECT_AUTO_APPROVE=1`) بدون تغییر ماندند.
- اسکریپت‌های probe/inspect یک‌بارمصرف در ریشه (`probe-*.mjs`، `inspect-*.cjs`، `oauth-walk.cjs`، `request-logger.mjs`) — **حذف شدند**.
- **نتیجه CI-G7b:** گیت شد. دو چت واقعی ChatGPT روی **یک** connector، هر کدام پروژهٔ خودش (`hooshixagent` / `hooshix-panel`) را با handle اختصاصی باز و حفظ کرد؛ `project_required` و انتخاب سشن‌محور درست کار کردند. مسیر اثبات‌شده: OFF + handleمحور (به‌جای per-connection principal که در این بخش فرض شده بود).

---

## ۳. نتیجهٔ فعلی تست میزبان — و مهم‌ترین یافته

کاربر دو connector در ChatGPT ساخت و در **دو چت جدا** ابزار `chat_isolation_probe` را صدا زد. خروجی هر دو **کاملاً یکسان** بود:

```
bound_connection_pseudonym: 06e55b633481   (یکسان)
server_context_pseudonym:   ce9b6fa7bdc9   (یکسان)
bind_state: RESOLVED, ownership_epoch: 1
```

**این یعنی isolation هنوز اثبات نشده** (طبق خود چک‌لیست: «Connection یکسان + Context یکسان = احتمال اشتراک Context»).

### ریشه‌یابی انجام‌شده (readonly روی `data/experiment-1.db`)

- فقط **یک** context وجود دارد: `ctx-legacy-shared-operator` — هر دو binding legacy به همین وصل‌اند.
- توکن صادرشده برای ChatGPT: `principal_id = "operator"` — **نه principal مجزا per-connection.**
- فقط **یک** client DCR ثبت شده: `hx_client_DJVVL9CDWpq-Q2AMsrqWDhICgfsR_ljG`.
- یعنی: توکن‌ها وارد مسیر **legacy pin** شده‌اند و هر دو connection به Legacy Context مشترک resolve شده‌اند → پس pseudonymهای یکسان.

**دو سؤال اصلی برای دستیار بعدی:**

1. **چرا صدور توکن، principal مجزا نساخته؟** مسیر `issueCode`/`issueGrant` در `src/mcp/oauth.ts` طبق CI-2.02 باید per (client_id, connection) principal مجزا بسازد. بررسی کن چرا این مسیر برای connector ChatGPT به `principal_id="operator"` ختم شده (آیا مسیر legacy/fallback است؟ آیا شرطی برقرار نیست؟ آیا توکن قبل از restart با DB جدید صادر شده؟).
2. **آیا واقعاً دو connector مجزا ثبت شده‌اند؟** فقط یک client در DB هست. احتمالاً یکی از connectorها قبل از تعویض `HOOSHIX_DB_PATH` به `experiment-1.db` ثبت شده (روی DB قدیمی `agent-memory.db`) یا ChatGPT هر دو connector را روی یک registration سوار کرده. هر دو connector باید **بعد از** اشارهٔ سرور به DB جدید، دوباره OAuth بگیرند (حذف و افزودن مجدد در ChatGPT).

### یافتهٔ جانبی مهم: خطای 406 در Accept header

- `StreamableHTTPServerTransport` (SDK `@modelcontextprotocol/server@2.0.0`، `index.mjs:631`) اگر `Accept` شامل **هر دو** `application/json` و `text/event-stream` نباشد، **406** برمی‌گرداند: `Client must accept both application/json and text/event-stream`.
- ChatGPT گاهی فقط `text/event-stream` می‌فرستد → INIT شکست می‌خورد → «۰ ابزار».
- کد `src/mcp/http-server.ts` (حدود خط ۵۵۸) Accept را قبل از `handleRequest` اصلاح می‌کند ولی **در عمل 406 تکرار می‌شود** — احتمالاً SDK از snapshot متفاوتی از header می‌خواند (مسیر `toWebRequest`). **این باگ اصلاح نشده و کامیت نشده.** تست تکرار: `probe-variant.mjs`.
- در نهایت ChatGPT موفق شد (شاید با retry یا Accept درست) — ولی برای پایداری باید fix شود: نرمال‌سازی Accept **قبل از** ساخت request‌ای که SDK می‌خواند.

---

## ۴. چه کارهایی مانده — چک‌لیست برای دستیار بعدی

### الف) اتمام CI-G7b (مسیر بحرانی)

1. **علت `principal_id="operator"` را پیدا و رفع کن** — هر دو connector باید دو principal، دو binding و دو Context مجزا بگیرند (رجوع به CI-2.02 و `establishConnection`).
2. **دو connector را در ChatGPT بازسازی کن** (حذف + افزودن) تا هر دو روی DB جدید `experiment-1.db` ثبت و OAuth شوند؛ مطمئن شو دو client_id مجزا در `oauth_registered_clients` هست.
3. **باگ 406 Accept** را اصلاح کن و با `probe-variant.mjs` تأیید کن که `Accept: text/event-stream` به تنهایی هم کار می‌کند.
4. **دو چت واقعی، دو probe** — معیار موفقیت:
   - `bound_connection_pseudonym` **متفاوت** (دو connector = دو connection)،
   - `server_context_pseudonym` **متفاوت** (دو Context مجزا)،
   - `bind_state=RESOLVED` در هر دو، و NO-LEAK (فقط pseudonym).
5. **نتیجه را در `docs/implementation/CIG7_HOST_OUTCOME.md` ثبت کن**: چک‌لیست بخش ۲ را تیک بزن، خروجی دو probe را الصاق کن، **سطح A / B / C** را تعیین کن (بخش ۳ سند).

### ب) CI-G9b (بعد از G7b)

6. **اجرای suite روی Linux** (WSL یا سرور) و ثبت نتیجه در `CIG9_FINAL_DELIVERY.md` — کد OS-agnostic است ولی اجرای واقعی ثبت نشده.
7. **امضای مالک** در بخش امضای `CIG9_FINAL_DELIVERY.md`.

### ج) خانه‌تکانی و gate نهایی

8. تصمیم دربارهٔ تغییرات uncommitted (watchdog + اسکریپت‌های probe) — staged کردن یا حذف.
9. بعد از هر leaf: `tsc` + lint (G1 + R7) + `npx vitest run --no-file-parallelism` + `pnpm run build` + به‌روزرسانی `CI_MASTER_PLAN.md` (جدول وضعیت گیت‌ها) + commit با پیام از فایل و `-F` + push.
10. تا امضای مالک، سرور تولید روی `CTX_ISOLATION_MODE=OFF` بماند؛ فعال‌سازی فقط با `CIG8_ROLLOUT_RUNBOOK.md`.

---

## ۵. پاسخ به سؤال باز کاربر دربارهٔ `.token2`

**نیازی به توکن دوم نیست.** فایل `.token` یک **bootstrap secret** است و فقط برای (الف) تأیید authorize در جریان OAuth با PIN، و (ب) لاگین `/admin` استفاده می‌شود؛ هرگز به‌عنوان MCP bearer استفاده نمی‌شود. هویت هر connector را **توکن OAuth خودش** می‌سازد که ChatGPT خودش در جریان OAuth دریافت می‌کند — یعنی جداسازی باید از همین مسیر بیاید (و دقیقاً همان‌جا است که باید درست شود؛ بخش ۳ همین سند).

---

## ۶. مسیرها و فرمان‌های کلیدی

- پلن: `docs/implementation/CI_MASTER_PLAN.md` · outcome: `docs/implementation/CIG7_HOST_OUTCOME.md` · تحویل: `docs/implementation/CIG9_FINAL_DELIVERY.md` · runbook: `docs/implementation/CIG8_ROLLOUT_RUNBOOK.md`
- سورس: `src/mcp/oauth.ts` (صدور توکن) · `src/mcp/http-server.ts` (مسیر `/mcp`، ردیف‌های ~۴۸۴/۵۲۳/۵۵۸) · `src/application/services/{context-provisioning,context-resolver.adapter,context-isolation-enforcer}.ts` · `src/tools/system/chat-isolation-probe.ts`
- DB آزمایشی: `data/experiment-1.db` (readonly با better-sqlite3 بررسی شود؛ **هرگز mutation**). DB تولید `data/agent-memory.db` ممنوع.
- لاگ gateway: `C:\ProgramData\HooshiXAgent\agent.log` · پیکربندی: `C:\Program Files\HooshiXAgent\config.json`
- env: `$env:Path = "C:\Users\Coder\AppData\Local\nvm\v24.18.0;$env:Path"` (PowerShell 5.1؛ برای اسکریپت‌های node از فایل `.mjs`/`.cjs` استفاده شود نه inline).
- تست سریع tools/list عمومی: `node probe-public.mjs` · بازتولید 406: `node probe-variant.mjs`
