# HooshiX Local Agent V1

HooshiX یک MCP server محلی و یک runtime قطعی برای اجرای workflow است. لایهٔ reasoning و تولید plan در نسخهٔ فعلی **ChatGPT** است؛ خود HooshiX مدل زبانی، provider هوش مصنوعی یا natural-language planner داخلی ندارد. ChatGPT یک plan ساختاریافته می‌فرستد و HooshiX آن را validate، اجرا، audit و در SQLite ذخیره می‌کند.

## نیازمندی‌ها و اجرا

- Node.js 24 یا جدیدتر
- pnpm 11.24.0 (نسخه در `packageManager` قفل شده است)
- Git برای ابزارهای Git
- ابزارهای اختیاری مربوط به package manager انتخابی: Python/pip، winget یا Chocolatey

```sh
pnpm install
pnpm run build
pnpm run typecheck
pnpm test -- --run
pnpm run test:coverage
pnpm run dev
```

فرمان آخر MCP server را روی stdio اجرا می‌کند. entry point اصلی `src/index.ts` است و تمام ابزارها در `src/mcp/registry.ts` ثبت می‌شوند.

## ابزارهای MCP

- System: `get_system_info`
- Files: `list_directory`, `read_file`, `search_files`, `create_file`, `write_file`, `modify_file`, `delete_file`, `restore_file`
- Shell: `execute_command`
- Git: `git_clone`, `git_status`, `git_diff`, `git_commit`, `git_branch`, `git_checkout`
- Packages: `install_package`, `remove_package`, `update_package`
- Tasks: `task_create`, `task_get`, `task_list`, `task_run`, `task_approve`, `task_resume`, `task_report`
- Context: `project_save`, `project_list`, `memory_add`, `memory_list`

`task_create` باید plan صریح ChatGPT را بگیرد؛ هر step شامل `action`, `tool`, `arguments` و در صورت نیاز `dependsOn` است. نمونهٔ ورودی:

```json
{
  "title": "Create and execute test.js",
  "steps": [
    {
      "action": "create test script",
      "tool": "create_file",
      "arguments": {
        "path": "test.js",
        "content": "console.log('Hello World')"
      }
    },
    {
      "action": "execute test script",
      "tool": "execute_command",
      "arguments": {
        "command": "node",
        "args": ["test.js"]
      },
      "dependsOn": [1]
    }
  ]
}
```

سپس ChatGPT شناسهٔ برگشتی را به `task_run` می‌دهد. وضعیت و output هر step، checkpointها، executionها، approvalها، recovery eventها و tool callها پایدار می‌مانند. `task_report` یک timeline یکپارچه برمی‌گرداند. اگر process متوقف شود، `task_get` و اجرای دوبارهٔ `task_run` از نخستین step تکمیل‌نشده ادامه می‌دهند.

عملیات حساس task مثل `delete_file` و package management متوقف می‌شوند و `approvalId` می‌دهند. جریان صحیح `task_approve` و سپس `task_resume` است؛ approval به task/step/action دقیق متصل است و فقط یک بار مصرف می‌شود. خطاهای گذرای timeout/network حداکثر تا سقف تعیین‌شده retry می‌شوند. خطای قطعی برای plan اصلاحی صریح ChatGPT متوقف می‌شود و پس از اصلاح علت می‌توان همان task را دوباره اجرا کرد.

## پیکربندی

- `HOOSHIX_WORKSPACE`: مرز filesystem و working directory؛ پیش‌فرض current directory.
- `HOOSHIX_DB_PATH`: فایل SQLite؛ پیش‌فرض `data/agent-memory.db`.
- `HOOSHIX_LOG_DIR`: محل JSONL audit logها؛ پیش‌فرض `logs`.
- `HOOSHIX_PERMISSION_LEVEL`: یکی از `READ_ONLY`, `PROJECT_ACCESS`, `DEVELOPER_MODE`, `ADMIN_MODE`؛ پیش‌فرض `DEVELOPER_MODE`.
- `HOOSHIX_MEMORY_FILE`: مسیر compatibility برای memory قدیمی؛ پیش‌فرض `data/agent-memory.json`.

## امنیت و قابلیت بازیابی

- تمام pathها به workspace محدودند و symlink/junction escape نیز با realpath رد می‌شود.
- فایل‌ها و جست‌وجوها محدودیت اندازه/تعداد دارند؛ writeها atomic هستند.
- پیش از overwrite، modify یا delete یک backup در SQLite ذخیره می‌شود و با `restore_file` قابل بازگردانی است.
- processها با `shell: false`، executable allowlist، argument validation، timeout و output cap اجرا می‌شوند.
- Git clone فقط URL امن HTTPS بدون credential توکار و مقصد جدید داخل workspace را می‌پذیرد.
- package operation فقط پس از یک command مستقلِ verification موفق اعلام می‌شود؛ winget و Chocolatey به `ADMIN_MODE` نیاز دارند.
- audit logها محتوی فایل و خروجی command را کپی نمی‌کنند و آرگومان‌های شبیه secret را redacted می‌کنند. خروجی لازم در execution history همان task نگهداری می‌شود.

HooshiX کد داخل workspace را با سطح دسترسی process سیستم‌عامل اجرا می‌کند. برای repository ناشناس یا غیرقابل‌اعتماد، process را داخل VM/container یا حساب OS محدود اجرا کنید.

## تست

مجموعهٔ تست شامل unit، integration و spawned-process MCP E2E است. سناریوی پذیرش واقعی، ساخت task توسط MCP، ایجاد فایل، اجرای Node، ذخیره و reload پس از restart منطقی runtime، memory/project context و گزارش نهایی را پوشش می‌دهد. Git روی repository واقعی محلی تست می‌شود و مرز clone/process جداگانه تست دارد.

coverage gate حداقل ۸۰٪ statement، ۷۵٪ branch، ۸۵٪ function و ۸۵٪ line است. entry pointها و adapterهای MCP در process فرزند تست می‌شوند و به‌دلیل ادغام‌نشدن V8 child coverage از گزارش parent مستثنا هستند.
