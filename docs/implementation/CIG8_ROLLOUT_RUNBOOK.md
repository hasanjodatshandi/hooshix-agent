# CI-G8 — Runbook: SHADOW rollout و rollback

**تاریخ ایجاد:** 2026-10-05
**مرجع:** CI_MASTER_PLAN §CI-8، فایل ۱۰ §2، ADR-CI-007 (ایمنی credential زنده)
**وضعیت:** ✅ rollback rehearsal تأیید شده (`tests/ci/ci-g8-rollback-rehearsal.test.ts`)

---

## ۱. اصل اولیه

**mode یک process env var است، نه یک تنظیم persisted.** این یعنی:

- تغییر mode = restart سرور با `CTX_ISOLATION_MODE` جدید.
- **rollback = restart با مقدار قبلی.** هیچ undo روی داده نوشته نمی‌شود.
- هیچ migrationای وابسته به mode نیست (جداول CI از CI-2.01 موجودند و زیر OFF بی‌استفاده‌اند).
- credentialهای صادر شده در هر modeی، در هر modeی معتبر می‌مانند (OAuth مستقل از isolation است).

این ویژگی است که rollback را امن می‌کند و آن را در تست پیوند زدیم.

---

## ۲. چه چهار حالت می‌کنند

| mode | resolution | enforcement | audit | توضیح |
|---|---|---|---|---|
| `OFF` (پیش‌فرض) | اجرا **نمی‌شود** | خیر | خیر | رفتار امروز. دیتابیس control plane به‌صورت lazy روی اولین استفاده باز می‌شود ولی resolution یک no-op کامل است. |
| `SHADOW` | اجرا می‌شود | **خیر** — فقط مشاهده | ✅ همهٔ درخواست‌ها | policy محاسبه + audit می‌شود ولی ترافیک جریان دارد. حالت مشاهده. |
| `PER_CONNECTION` | اجرا می‌شود | ✅ resolution غیرRESOLVED → ۴۰۳ `context_denied` / `context_not_bound` | ✅ | حالت enforcement. |
| `HOST_ATTESTED` | اجرا می‌شود | ✅ (مثل PER_CONNECTION) | ✅ | فقط وقتی میزبان claim امساشده بدهد (CIG7 outcome). |

**fail-closed:** اگر خود resolution خطا دهد، درخواست رد می‌شود — unavailable شدن control plane نمی‌تواند isolation را خاموش کند.

---

## ۳. مراحل rollout روی یک project غیرحساس

> پیش‌نیاز: endpoint آزمایشی مجزا (نه سرور تولید). سرور تولید باید روی `OFF` بماند تا این runbook تأیید شود.

### مرحله ۰ — پیش از شروع

```powershell
# ۱. backup سه‌لایه (الگوی جلسات III/IV)
git tag pre-ci-rollout-<project>
# ۲. snapshot دیتابیس
Copy-Item "data\agent-memory.db" "data\agent-memory.db.pre-rollout"
# ۳. تأیید integrity
node -e "const D=require('better-sqlite3');const d=new D('data/agent-memory.db');console.log(d.prepare('PRAGMA integrity_check').get(), d.prepare('PRAGMA foreign_key_check').all())"
# ۴. ثبت شروع در audit book
```

### مرحله ۱ — SHADOW (مشاهده، حداقل ۲۴ ساعت)

```powershell
$env:CTX_ISOLATION_MODE = "SHADOW"
# restart سرور
```

**چه چیزی تأیید کنید:**

- [ ] ترافیک تولیدی جریان دارد — هیچ credential زنده‌ای شکست نمی‌خورد (ADR-CI-007).
- [ ] ردیف‌های `security_audit` جمع می‌شوند.
- [ ] کوئری DIAGNOSTIC: چه کسانی UNBOUND می‌شوند؟

```sql
-- سهم درخواست‌هایی که زیر enforcement رد می‌شوند
SELECT decision, COUNT(*) FROM security_audit
WHERE action='MCP_REQUEST' AND created_at > datetime('now', '-1 day')
GROUP BY decision;
```

- [ ] اگر سهم DENY غیرمنتظره بالاست → **توقف**، بررسی bindingها، مرحله ۱ را تکرار.
- [ ] اگر سهم DENY صفر یا فقط credentialهای واقعاً غیر متصل است → مرحله ۲.

### مرحله ۲ — PER_CONNECTION (enforcement)

```powershell
$env:CTX_ISOLATION_MODE = "PER_CONNECTION"
# restart سرور
```

**چه چیزی تأیید کنید:**

- [ ] credentialهای متصل (legacy operator + متعلقات ثبت‌شده) همچنان کار می‌کنند.
- [ ] credentialهای غیر متصل با `403 context_denied / context_not_bound` رد می‌شوند (قبل از session/tool/filesystem).
- [ ] هیچ edge case غیرمنتظره‌ای در لاگ نیست.

**در این مرحله rollout است.** phase ۳ (rollback) را فقط تمرینی اجرا کنید، نه روی تولید.

### مرحله ۳ — ROLLBACK rehearsal (الزامی پیش از cutover نهایی)

این مرحله است که گیت CI-G8 آن را demand می‌کند:

```powershell
# برگشت به حالت قبلی — فقط restart
$env:CTX_ISOLATION_MODE = "SHADOW"   # یا OFF، هر چه حالت قبل بود
# restart سرور
```

**باید تأیید کنید (همگی در `tests/ci/ci-g8-rollback-rehearsal.test.ts` خودکار شده):**

- [ ] credentialهای صادر شده زیر PER_CONNECTION همچنان کار می‌کنند.
- [ ] credentialهای غیر متصل دوباره جریان دارند (rollback رفتار را برمی‌گرداند).
- [ ] تاریخچهٔ audit از مرحله ۱-۲ هنوز یکپارچه و خوانا است.
- [ ] هیچ دادهٔ application ای تغییر نکرده.

اگر هر کدام شکست خورد → **rollforward ممنوع**، بررسی، از مرحله ۰ دوباره.

### مرحله ۴ — re-enroll

```powershell
$env:CTX_ISOLATION_MODE = "PER_CONNECTION"
# restart سرور
```

تأیید continuity audit history — ردیف‌های مرحله ۱-۲ باید هنوز باشند.

---

## ۴. rollback اضطراری

اگر زیر enforcement مشکلی پیش آمد:

```powershell
# فوری: برگشت به حالت قبلی
$env:CTX_ISOLATION_MODE = "OFF"      # یا SHADOW
# restart سرور
```

**این یک restart است.** هیچ undo نوشته نشده، هیچ migration برنگشته، هیچ credentialی باطل نشده. بازگشت فوری است.

سپس:

1. ردیف‌های `security_audit` را برای پنجرهٔ مشکل بررسی کنید.
2. اگر داده‌ای ناقص شد → snapshot مرحله ۰ را بازیابی کنید (`agent-memory.db.pre-rollout`).
3. postmortem قبل از تلاش مجدد.

---

## ۵. چه چیزی هرگز نباید تغییر کند

- **credentialهای زنده هرگز باطل نمی‌شوند.** ADR-CI-007: pinLegacyContext این کار را تضمین می‌کند.
- **mode هیچ داده‌ای نمی‌نویسد.** جداول control plane additive هستند و تا `OFF` بودن مسیر تولیدی آن‌ها را نمی‌خواند.
- **هیچ rollbackای نیاز به migration برگشت ندارد.** طراحی عمدی: همه migrationها additive-only.
- **fail-closed.** اگر control plane unavailable شود، درخواست رد می‌شود، نه اینکه isolation خاموش شود.

---

## ۶. تأیید خودکار

| چه چیزی | کجا |
|---|---|
| rollout کامل OFF→SHADOW→PER_CONNECTION→OFF→SHADOW با حفظ داده | `tests/ci/ci-g8-rollback-rehearsal.test.ts` (فاز ۱-۵) |
| credential زنده در سراسر چرخه کار می‌کند | همان تست، phase ۲-۵ |
| audit history پس از rollback یکپارچه | همان تست، phase ۵ |
| mode نامعتور بلند رد می‌شود (نه خاموش شدن خاموش) | همان تست، تست دوم |

**گیت CI-G8:** rollback اجرا و تأییدشده — ✅ در تست خودکار.
