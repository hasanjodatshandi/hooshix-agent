# CI-G9 — سند تحویل نهایی Chat Isolation

**تاریخ:** 2026-10-05
**مرجع:** CI_MASTER_PLAN §CI-9، فایل ۰۱، ADR-CI-001..009
**وضعیت گیت:** 🟡 **gments فنی بسته / امضای مالک معوق**

---

## ۱. خلاصهٔ اجرایی

قابلیت Chat Isolation از یک ممیزی پایه (CI-0) که نشان داد سرور برای همهٔ connectionها یک principal یکسان `"operator"` صادر می‌کند، تا یک پروتکل کامل ownership و enforcement رسید. **سؤال اصلی فایل ۰۱ پاسخ داده شد:**

> آیا سرور HooshiX برای هر درخواست چت A و چت B شاهد هویت متفاوت و معتبرِ server-verifiable دریافت می‌کند؟

**سمت سرور: بله.** وقتی دو connection مجزا درخواست می‌دهند، سرور دو Context مجزا می‌بیند و resolution هر درخواست فقط به credential خودش match می‌شود (۱۰۰٪ request-context match، تأییدشده در `tests/ci/ci-g7-chat-isolation-probe.test.ts`).

**سمت میزبان:** ⬜ هنوز معوق — آیا محصول ChatGPT دو connection selectable به یک حساب می‌دهد؟ این سؤال فقط با دو چت واقعی پاسخ می‌شود و در `CIG7_HOST_OUTCOME.md` ثبت می‌شود. **تا پر شدنش، ادای عمومی فقط per-connection isolation است.**

---

## ۲. چه چیزی ساخته شد

### ۲.۱ هویت و کنترل‌پلین

| قطعه | کجا | چه کاری |
|---|---|---|
| نهادهای دامنه (Context، Binding، WorkspaceGrant، OwnershipLease، TransferIntent) | `src/domain/context/` | مدل دامنه با typed IDs و ماشین حالت انتقال ۷ حالته |
| پورت‌های application | `src/application/ports/outbound/context.port.ts` | ContextResolver، AuthorizationPolicy، OwnershipRepository، TransferRepository با discriminated union deny-by-default |
| migration 23 | `migrations.ts` | شش جدول: `context_registry`، `context_binding`، `workspace_grant`، `ownership_lease`، `handoff_intent`، `security_audit` — additive، فقط در migration (نه base-schema) |
| migration 24 | `migrations.ts` | `context_binding.principal_id` NOT NULL — ستونی که principal مجزا را ممکن می‌کند |
| migration 25 | `migrations.ts` | `tasks.context_id`/`workspace_grant_id`/`ownership_epoch`/`created_by_binding_id` + `task_leases.context_id` — task fencing |
| `establishConnection` | `src/application/services/context-provisioning.ts` | برای هر connection یک principal و Context مجزا می‌سازد؛ connection شناخته‌شده Context خود را حفظ می‌کند |
| feature flag | `src/infrastructure/config/ci-isolation-config.ts` | `CTX_ISOLATION_MODE=OFF\|SHADOW\|PER_CONNECTION\|HOST_ATTESTED`؛ پیش‌فرض OFF؛ مقدار نامعتور با خطای واضح رد می‌شود |

### ۲.۲ enforcement و fencing

| قطعه | کجا | چه کاری |
|---|---|---|
| observer | `context-isolation-observer.ts` | نقطهٔ واحد resolution روی مسیر درخواست؛ audit و decision هر دو از یک lookup می‌آیند |
| enforcer | `context-isolation-enforcer.ts` | نگاشت resolution به ALLOW/DENY با sentinel ثابت؛ fail-closed |
| ownership fence | `domain/context/ownership-fence.ts` | تصمیم pure (epoch, binding)؛ اجرا داخل transaction receipt STARTED تا epoch check و effect claim atomically commit شوند |
| خطای fence ترمینال | — | `outcome_unknown` + `outcome_unknown_requires_reconciliation`، هرگز retry |

### ۲.۳ Owner Console و انتقال کنترل

| قطعه | کجا | چه کاری |
|---|---|---|
| سرویس انتقال | `src/application/services/context-transfer.ts` | prepare/approve/commit/cancel دو فازی؛ ticket یک‌بارمصرفه (فقط SHA-256 در DB) |
| pre-flight بیرون از transaction | `handoff-intent.adapter.ts` | intentی که بین prepare و commit جابجا شده، در transaction جداگانه FAILED می‌شود |
| مسیرهای `/admin/*` | `src/mcp/http-server.ts` | چهار کنترل لایه‌ای: reauth timing-safe، session جدا (`hx_admin` + cap جدا)، CSRF (form field + SameSite=Strict)، Origin strict |

### ۲.۴ ابزار و مشاهده

| قطعه | کجا | چه کاری |
|---|---|---|
| `chat_isolation_probe` | `src/tools/system/chat-isolation-probe.ts` | ابزار evidence فقط-خواندنی؛ pseudonym-only (T07) |

---

## ۳. گیت‌ها و تأییدها

| گیت | وضعیت | شواهد |
|---|---|---|
| CI-G0 | ✅ | `CIG0_FEASIBILITY_GATE_2026-10-02.md` — علت سمت سرور از علت سمت میزبان جدا شد |
| CI-G1 | ✅ | نهادهای دامنه + پورت‌ها |
| CI-G2 | ✅ | control DB + principal مجزا + flag |
| CI-G3 | ✅ | SHADOW روی مسیر درخواست |
| CI-G4 | ✅ | PER_CONNECTION enforcement زنده: ۴۰۳ `context_denied`/`context_not_bound`، fail-closed |
| CI-G5 | ✅ | Task fencing کامل، epoch fence در receipt |
| CI-G6 | ✅ | Owner Console + انتقال کنترل (6a + 6b) |
| CI-G7 | 🟡 | سمت سرور ✅ (probe، دو Context مستقل، ۱۰۰٪ match)؛ میزبان ⬜ (`CIG7_HOST_OUTCOME.md`) |
| CI-G8 | ✅ | rollback rehearsal + runbook (`CIG8_ROLLOUT_RUNBOOK.md`) |
| CI-G9 | 🟡 | bençmark ✅، مستندات ✅، **امضای مالک ⬜** |

### ۳.۱ bençmark قبل/بعد

`tests/ci/ci-g9-isolation-benchmark.test.ts` — مسیر resolution+enforcement در سه regime:

- **OFF** (قبل): ~۰.۷µs/request — observer short-circuit می‌کند، هزینه عملاً صفر.
- **SHADOW** (مشاهده): یک indexed lookup روی `context_binding.credential_hash` + یک insert در `security_audit`.
- **PER_CONNECTION** (بعد): همان + decide.

هزینهٔ اضافی per-request زیر میلی‌ثانیه است — نسبت به filesystem/shell/Git work واقعی یک tool call غیرقابل‌درک. ceiling فقط برای گرفتن regression الگوریتمی (lookup → scan) است.

### ۳.۲ تست

کل suite سبز: **۱۰۶۶ تست / ۲۲۰ فایل** (`npx vitest run --no-file-parallelism`). شامل ۲۸ تست CI روی سرور زنده.

---

## ۴. مستندات نهایی

| سند | محتوا |
|---|---|
| `docs/MIGRATIONS.md` | ledger migration 22→25 (source of truth: `LATEST_MIGRATION_VERSION = 25`) |
| `docs/TOOLS.md` | کاتالوگ ۵۵ ابزار (auto-generated، شامل `chat_isolation_probe`) |
| `CIG8_ROLLOUT_RUNBOOK.md` | مراحل rollout ۰-۴، rollback اضطراری، قیدهای ADR-CI-007 |
| `CIG7_HOST_OUTCOME.md` | چک‌لیست تست میزبان + ثبت سطح A/B/C |
| `CIG9_FINAL_DELIVERY.md` | همین سند |

---

## ۵. ۲ OS هدف

تست فقط روی **Windows/PowerShell 5.1** اجرا شده. CI-G9 دو OS را demand می‌کند:

- [ ] **Linux** — suite باید روی WSL/CI Linux اجرا شود. توقع: همهٔ تست‌ها سبز، چون کد OS-agnostic است (`node:path`، `better-sqlite3` cross-platform، fixtureها temp dir استفاده می‌کنند). ریسک‌های شناخته‌شده: file-locking روی Windows (فعلاً با retry حل شده)، case-insensitive filesystem (در `canonicalRootIdentity` فقط win32 اعمال می‌شود).
- [ ] ثبت نتیجهٔ Linux در همین سند.

---

## ۶. امضای مالک

> پر کردن این بخش، فعال‌سازی سطح A را مجاز می‌کند. تا زمانی که `CIG7_HOST_OUTCOME.md` پر نشده و این بخش امضا نشده، سرور تولید باید روی `CTX_ISOLATION_MODE=OFF` بماند.

- [ ] `CIG7_HOST_OUTCOME.md` پر شده و سطح نهایی A/B/C ثبت شده.
- [ ] rollback rehearsal روی endpoint آزمایشی مجزا اجرا و تأیید شده.
- [ ] bençmark قبل/بعد پذیرفته شده.
- [ ] تست Linux سبز.
- [ ] مالک می‌داند که فعال‌سازی `PER_CONNECTION` روی سرور تولید باید با runbook `CIG8_ROLLOUT_RUNBOOK.md` انجام شود.

**امضای مالک:** ____________________ **تاریخ:** ____________

**سطح تأییدشده:** [ ] A — HOST_ATTESTED_CONVERSATION / [ ] B — DISTINCT_CONNECTIONS / [ ] C — NO_VERIFIABLE_CHAT_ID
