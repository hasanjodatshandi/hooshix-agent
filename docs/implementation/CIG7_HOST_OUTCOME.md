# CI-G7b — ثبت نتیجهٔ تست میزبان ChatGPT

**تاریخ ایجاد:** 2026-10-05
**مرجع:** فایل ۰۱ §4 (Feasibility Gate)، CIG0 §5 (چک‌لیست مالک)، فایل ۱۳ (ChatGPT Connector Compatibility)
**وضعیت:** ⬜ **پر نشده — به‌ناوب مالک**

---

## ۱. چرا این سند وجود دارد

سؤال اصلی CI-G7 (CIG0 §1):

> آیا سرور HooshiX برای هر درخواست چت A و چت B شاهد هویت متفاوت و معتبرِ server-verifiable دریافت می‌کند؟

این سؤال دو نیمه دارد:

| نیمه | چه کسی پاسخ می‌دهد | وضعیت |
|---|---|---|
| **سمت سرور** — آیا سرور اصلاً دو connection مجزا را به دو Context مجزا نگاشت می‌کند؟ | کد + اتوماسیون | ✅ **پاسخ داده شد** (CI-G7a): بله. دو principal مجزا → دو Context مجزا، ۱۰۰٪ request-context match، با ابزار `chat_isolation_probe` قابل مشاهده. |
| **سمت میزبان** — آیا محصول ChatGPT اجازه می‌دهد دو connection/grant مستقل selectable به یک حساب داده شود؟ | فقط مالک، با دو چت واقعی | ⬜ **این سند** |

پاسخ نیمهٔ سرور مستقل از میزبان است و **ثبت شد**. ولی تا وقتی نیمهٔ میزبان پاسخ نشود، نمی‌توان سطح نهایی A/B/C را ثبت کرد.

---

## ۲. چک‌لیست اجرا (مالک)

پیش‌نیازها (همگی از CI-G2 به بعد موجودند):

- [ ] یک **endpoint آزمایشی مجزا** (نه سرور تولید). سرور با `CTX_ISOLATION_MODE=PER_CONNECTION` و `HOOSHIX_PERMISSION_LEVEL` مناسب اجرا شود.
- [ ] دو **client DCR مجزا** (`/oauth/register` دو بار) — هر کدام `client_id` و token خود را دارد.

مراحل (CIG0 §5):

- [ ] **۱.** چت A را با connection اول باز کنید.
- [ ] **۲.** چت B را با connection دوم باز کنید.
- [ ] **۳.** از چت A ابزار `chat_isolation_probe` را صدا بزنید و خروجی را ذخیره کنید.
- [ ] **۴.** از چت B ابزار `chat_isolation_probe` را صدا بزنید و خروجی را ذخیره کنید.
- [ ] **۵.** مقایسه کنید:
  - `bound_connection_pseudonym` در دو خروجی **برابر** است یا **متفاوت**؟
  - `server_context_pseudonym` در دو خروجی **برابر** است یا **متفاوت**؟
- [ ] **۶.** اگر connection ها یکی بودند: آیا محصول اجازه می‌دهد connection را **به‌ازای‌هر-چت** جدا انتخاب کرد؟
- [ ] **۷.** `refresh` توکن و reconnect را تست کنید — آیا pseudonymها پایدار می‌مانند؟
- [ ] **۸.** یک connection اشتباه را انتخاب کنید (مثلاً connection چت A را روی پروژهٔ B) — سرور چه می‌بیند؟
- [ ] **۹.** خروجی را در بخش ۳ زیر ثبت کنید.

---

## ۳. ثبت نتیجهٔ نهایی

> **یک گزینه را علامت بزنید. این ثبت، ادعای عمومی را تعیین می‌کند.**

- [ ] **`HOST_ATTESTED_CONVERSATION` (سطح A)** — میزبان یک claim امضاشدهٔ conversation با issuer/audience معتبر می‌دهد که resolver می‌تواند آن را نگاشت کند. per-chat isolation واقعی قابل ادعاست.
- [ ] **`DISTINCT_CONNECTIONS` (سطح B)** — دو چت connection های قابل‌تشخیصی دارند و به دو Context مجزا resolve می‌شوند. per-connection isolation قابل ادعاست.
- [ ] **`NO_VERIFIABLE_CHAT_ID` (سطح C)** — میزبان یک connection را به اشتراک می‌گذارد؛ فقط per-connection isolation قابل ادعاست و هیچ ادعای per-chat مجاز نیست.

### مشاهدات

```
< bound_connection_pseudonym چت A: ____________________ >
< server_context_pseudonym چت A: ____________________ >
< bound_connection_pseudonym چت B: ____________________ >
< server_context_pseudonym چت B: ____________________ >

< توضیح مالک: _____________________________ >
```

---

## ۴. قیدهای صریح

- **تا پر شدن این سند، ادای عمومی فقط per-connection isolation است.** هیچ ادعای محرمانگی per-chat مجاز نیست (CI_MASTER_PLAN خط ۲۰).
- **سرور تولید (`CTX_ISOLATION_MODE` تنظیم‌نشده = OFF) این مسیر را اجرا نمی‌کند** — enforcement، fencing و مسیرهای `/admin/*` فقط با flag فعال می‌شوند.
- ابزار `chat_isolation_probe` زیر OFF همیشه `UNBOUND` برمی‌گرداند؛ این صادقانه است، نه خرابی.
- **هیچ تستی نباید روی سرور تولید اجرا شود.** endpoint آزمایشی مجزا، دیتابیس مجزا.

---

## ۵. اگر نتیجهٔ C بود

CIG0 §4 مسیر اصلی را مدل C گرفت. اگر محصول میزبان دو connection قابل‌انتخاب نمی‌دهد (`NO_VERIFIABLE_CHAT_ID`):

1. per-connection isolation همچنان واقعی و ارزشمند است (دو کاربر/دو حساب → دو Context).
2. per-chat isolation باید از مسیر دیگری بیاید — مثلاً host attestation (مدل H) در صورت پشتیبانی محصول، یا مرز دیگری.
3. **این یک برگشت نیست** — سؤال اصلی پاسخ داده شد، فقط جوابش C بود نه A/B.
