# CI-G0 — سند تصمیم Feasibility Gate

**تاریخ:** 2026-10-02
**baseline HEAD:** `93cab47`
**مرجع:** فایل ۰۱ §4 (Feasibility Gate)، فایل ۱۳ (ChatGPT Connector Compatibility)، فایل ۱۲ ADR-CI-003
**وضعیت گیت:** `SERVER_SIDE_READY / HOST_VERIFICATION_PENDING`

---

## ۱. سؤال قطعی

> آیا سرور HooshiX برای هر درخواست چت A و چت B شاهد هویت متفاوت و معتبرِ server-verifiable دریافت می‌کند؟

### جواب در حال حاضر: **نه** — ولی علتش را باید دقیق جدا کرد

فایل ۰۱ این سؤال را طوری طرح می‌کند که انگار به‌طور کامل به محصول میزبان وابسته است. **ممیزی CI-0 نشان داد این نادرست است.** دو علت جدا وجود دارد:

| علت | منشأ | قابل‌حل بدون میزبان؟ |
|---|---|---|
| **الف) سمت سرور:** سرور برای هر connection یک principal مجزا صادر نمی‌کند. `issueCode` پیش‌فرض `principalId="operator"` را می‌زند و هیچ `connection_id`ای ذخیره نمی‌کند. حتی اگر ChatGPT دو توکن کاملاً مستقل بفرستد، هر دو به principal یکسانی map می‌شوند. | `src/mcp/oauth.ts:94` + `src/mcp/http-server.ts:648` | **بله** — CI-2 این را حل می‌کند |
| **ب) سمت میزبان:** آیا ChatGPT اصلاً دو connection/grant مستقل selectable به یک حساب می‌دهد؟ آیا claim امضاشدهٔ conversation می‌دهد؟ | محصول ChatGPT | **خیر** — نیاز به تست عملی مالک دارد |

**نتیجهٔ مهم:** علت (الف) **پیش‌شرط** علت (ب) است. تا زمانی که سرور principal مجزا صادر نکند، تست میزبان بی‌معنی است — حتی اگر میزبان دو connection مستقل بفرستد، سرور آن‌ها را یکی می‌بیند. بنابراین ترتیب صحیح:

```text
CI-1 (domain Context/Binding)  →  CI-2 (صدور principal+connection مجزا)  →
  سپس تست میزبان (دو چت واقعی)  →  تصمیم نهایی سطح A/B
```

این ترتیب، ترتیبِ فایل ۰۸ (CI-1 → CI-2 → ... → CI-7 تست واقعی) را تأیید می‌کند و نیازی به تأخیر کل برنامه به‌خاطر یک سؤال بیرونی نیست.

---

## ۲. شواهد فعلی (کاملاً سمت سرور)

```sql
SELECT DISTINCT principal_id FROM oauth_access_tokens;  →  'operator'  (تنها یک)
SELECT DISTINCT principal_id FROM tasks;                →  'local-stdio', 'operator'
```

```js
// src/mcp/http-server.ts:313-315
const principalBinding = sha256(principalId + "|" + clientId + "|" + resource);
// src/mcp/http-server.ts:361-364  (مسیر modern 2026-07-28)
sessionId = principalBinding as SessionId;   // ← ثابت برای تمام چت‌ها
```

```text
registered clients: 9   ← همهٔ آن‌ها برای DCR هستند؛ هیچ‌کدام به connection/چت خاصی bind نشده‌اند
```

---

## ۳. مدل‌های هویت (فایل ۰۳ §2) و وضعیت هرکدام

| مدل | شرط | وضعیت فعلی |
|---|---|---|
| **H — host attestation** | میزبان claim امزاشدهٔ conversation با issuer/audience معتبر بدهد | **نامعلوم** — قابل‌تست فقط بعد از CI-2 با endpoint آزمایشی. پروتکل MCP این claim را تضمین نمی‌کند (فایل ۱۳ §1). |
| **C — connection/grant جدا** | کاربر دو connection مستقل بسازد؛ هر OAuth grant به یک Context bind شود | **آمادهٔ پیاده‌سازی سمت سرور** (CI-2). بخش میزبان نیاز به تست عملی دارد. |
| **P — proxy مورد اعتماد** | کلاینت/پروکسی کنترل‌شده توسط مالک با channel identity مستقل | در صورت شکست H/C. |

### تصمیم موقت (طبق ADR-CI-003)

**مدل C را به‌عنوان مسیر اصلی پیاده‌سازی کن**، چون:
1. کاملاً سمت سرور قابل‌تست است (دو client DCR مجزا → دو principal مجزا → دو Context مجزا).
2. اگر ChatGPT اجازهٔ انتخاب connection per-chat بدهد، مستقیماً به سطح A می‌رسد.
3. اگر ندهد، مدل C حداقل **per-connection isolation** واقعی می‌دهد (سطح B صادقانه) و مسیر راه برای مدل P باقی می‌ماند.

مدل H به‌عنوان **افزایش بعدی** در نظر گرفته شود: اگر میزبان روزی claim امزاشده داد، Context Resolver آن را به internal context map می‌کند (یک claim در Gateway، نه بازنویسی کل لایه).

---

## ۴. مرز ادعا — چه می‌توان گفت و چه نمی‌توان

طبق فایل ۱۳ §5 و فایل ۱۴ §3، **هیچ کمکی به نداشتن اجازه نیست**:

| پس از گیت | چه ادعایی مجاز است |
|---|---|
| CI-2 (principal مجزا + binding) | «جداسازی per-connection قابل اجراست» — **نه** per-chat |
| CI-3 (workspace/tool context-scoped) | «هیچ connectionی نمی‌تواند Context دیگری را بدون binding بخواند» |
| CI-4 (OS worker) | «یک connection نمی‌تواند فایل دیگری را از طریق subprocess بخواند» |
| CI-G7 (دو چت واقعی، اتصال مستقل، تست شده) | «per-chat isolation، **فقط** اگر میزبان connection را به چت پین کند یا attestation بدهد» |

**ممنوعیت صریح تا CI-G7:** هر متن مستند یا خروجی ابزار که بگوید «چت‌ها کاملاً از هم جدایند»، حتی اگر همهٔ unit testها سبز باشند.

---

## ۵. آنچه برای تست میزبان لازم است (checklist برای مالک)

این بررسی **فقط** بعد از CI-2 روی یک endpoint آزمایشی مجزا انجام می‌شود (طبق فایل ۱۳ §2):

- [ ] یک ابزار echo فقط-خواندنی که `bound_connection_pseudonym`، `server_context_pseudonym`، `bind_state` و `trace_id` را برمی‌گرداند (نه bearer/secret/متن گفت‌وگو).
- [ ] دو چت A و B باز شود با دو connection ثبت‌شدهٔ مجزا (دو client DCR مجزا).
- [ ] بررسی: آیا سرور دو principal/connection مجزا می‌بیند یا یکی؟
- [ ] اگر یکی: آیا محصول اجازه می‌دهد connection برای هر چت جدا انتخاب شود؟
- [ ] تست `refresh`، reconnect و انتخاب اشتباه connection.
- [ ] ثبت نتیجه: `HOST_ATTESTED_CONVERSATION` / `DISTINCT_CONNECTIONS` / `NO_VERIFIABLE_CHAT_ID`.

**هیچ کدام از این موارد روی سرویس فعال یا با credential واقعی انجام نمی‌شود** (ADR-CI-007).

---

## ۶. تهدیدهای T01–T12 در وضعیت فعلی

| تهدید | وضعیت فعلی | کدام گیت آن را می‌بندد |
|---|---|---|
| T01 چت B با ID معروف A، `task_get` بزند | **باز** (modern path: session مشترک) | CI-3 |
| T02 چت B `set_workspace` کند، A منحرف شود | **باز** (`modernContexts` کلید مشترک) | CI-3 |
| T03 توکن مشترک A/B | **باز** (principal یکسان) | CI-2 |
| T04 تزریق `contextId`/`clientInfo` | **باز جزئی** (فعلاً هیچ contextIdای پذیرفته نمی‌شود، ولی پس از CI-3 باید spoofing تست شود) | CI-1.04 |
| T05 path traversal / junction / symlink | **部分ی بسته** (`sameRootIdentity`، `validateWorkspace`، realpath) | CI-4 (OS ACL) |
| T06 فرمان خارج از Workspace | **باز در سطح OS** (env allowlist هست، ولی subprocess می‌تواند هرجا را بخواند) | CI-4 |
| T07 حدس Plan/Approval/Backup ID | **باز** (نه existence-leak نه context filter) | CI-3 |
| T08 انتقال حین اجرا | N/A (هیچ transferای وجود ندارد) | CI-6 |
| T09 Fork روی یک مسیر | N/A | CI-6 |
| T10 log/cache نتایج A برای B | **باز** (هیچ cache key مشترکی وجود ندارد، ولی context filter هم نیست) | CI-3 |
| T11 دور زدن پنل از چت | N/A (پنلی نیست) | CI-6 |
| T12 migration ناقص | **بسته** (migration ledger + backup rehearsal) | حفظ در CI-2 |

---

## ۷. تصمیم نهایی گیت

```text
CI-G0 = SERVER_SIDE_READY / HOST_VERIFICATION_PENDING
```

- ✅ پیش‌نیاز سمت سرور روشن و قابل‌اجازه است (CI-1، CI-2).
- ⏳ تأیید میزبان به CI-G7 موکول می‌شود؛ تا آن زمان فقط ادعای per-connection.
- 🚫 هیچ ادعای per-chat privacy تا CI-G7.
