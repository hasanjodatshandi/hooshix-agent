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

- System: `get_system_info`, `agent_metrics`, `set_workspace`, `get_workspace`
- Files: `list_directory`, `read_file`, `search_files`, `create_file`, `write_file`, `modify_file`, `delete_file`, `restore_file`
- Shell: `execute_command`
- Git: `git_status`, `git_diff`, `git_clone`, `git_commit`, `git_branch`, `git_checkout`, `git_add`, `git_init`, `git_log`
- Packages: `install_package`, `remove_package`, `update_package`, `package_restore`
- Tasks: `task_create`, `task_get`, `task_list`, `task_run`, `task_approve`, `task_resume`, `task_report`, `task_replay`, `task_cancel`, `task_append_steps`, `task_link`, `task_links`, `task_step_risks`, `task_snapshot`, `task_rollback`
- Context: `project_save`, `project_list`, `memory_add`, `memory_list`

**فرمان‌های مجاز `execute_command`:** `node`, `npm`, `pnpm`, `git`, `python`, `py`, `gh`. دستورهای فقط-خواندنی (مثل `git status`، `gh pr list`، `node --version`) مستقیم اجرا می‌شوند؛ اجرای کد (اسکریپت node/python، `npm run/test`، git mutating، gh mutating) نیازمند step تاییدشده است.

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

- `HOOSHIX_WORKSPACE`: مرز filesystem و working directory؛ پیش‌فرض current directory. می‌توانید چند مسیر جدا شده با کاما بدهید.
- `HOOSHIX_DB_PATH`: فایل SQLite؛ پیش‌فرض `data/agent-memory.db`.
- `HOOSHIX_LOG_DIR`: محل JSONL audit logها؛ پیش‌فرض `logs`.
- `HOOSHIX_PERMISSION_LEVEL`: یکی از `READ_ONLY`, `PROJECT_ACCESS`, `DEVELOPER_MODE`, `ADMIN_MODE`؛ پیش‌فرض `DEVELOPER_MODE`.
- `HOOSHIX_MEMORY_FILE`: مسیر compatibility برای memory قدیمی؛ پیش‌فرض `data/agent-memory.json`.

## Workspace Configuration

HooshiX supports working with projects in any directory on your system.

### Option 1: Set workspace on startup

```bash
# Single workspace
HOOSHIX_WORKSPACE=D:/Projects/my-app node dist/index-http.js

# Multiple workspaces
HOOSHIX_WORKSPACE=D:/Projects/my-app,D:/Projects/other,E:/Work node dist/index-http.js
```

All file operations are restricted to the configured roots. File tools always operate in the **active workspace only** — use `add_workspace_roots` at runtime to extend the allowed pool and `set_workspace` to select the active root. There is deliberately **no unrestricted mode on `set_workspace`**: file tools can never be widened to arbitrary system paths through that tool (the operator-level `HOOSHIX_UNRESTRICTED=1` env var remains the only machine-wide opt-in at boot).

### Option 2: Set workspace via ChatGPT

Just tell ChatGPT:
> "Set workspace to D:\Projects\my-api"

ChatGPT will call `set_workspace` and all file operations will work in that directory.

### Option 3: Use absolute paths inside workspace roots

After setting a workspace, absolute paths inside the configured roots work directly:
```json
{ "tool": "read_file", "arguments": { "path": "D:/Projects/my-api/src/index.ts" } }
```

Paths outside the configured roots are rejected — no runtime toggle exists to widen file-tool scope.

### Supported path formats

| Format | Example |
|--------|----------|
| Relative | `src/index.ts` |
| Parent | `../other-project/file.ts` |
| Windows absolute | `D:/Projects/my-app/src/index.ts` |
| Linux/Mac absolute | `/home/user/projects/my-app/src/index.ts` |

### Workspace tools

| Tool | Description |
|------|-------------|
| `set_workspace` | Select the active workspace from the allowed roots pool (pure selector — cannot add/remove roots or expand scope) |
| `add_workspace_roots` | Add one or more directories to the allowed roots pool |
| `remove_workspace_root` | Remove a non-active directory from the allowed roots pool |
| `get_workspace` | View the active workspace and the allowed roots pool |

**Note:** `delete_file` requires approval through a task step for security. Use `task_create` + `task_run` for delete operations. The same applies to `git_commit`, `git_clone`, `git_branch`, `git_checkout`, `git_add`, package operations, and `task_rollback` — even on direct MCP calls (see `HOOSHIX_DIRECT_AUTO_APPROVE` above).

## Dynamic Context Injection (Template Variables)

HooshiX supports passing output from one step to another using template variables.

### Syntax

```
{{stepN.output.field}}     — Access a field from step N's output
{{stepN.output}}           — Access the entire output
{{stepN.status}}           — Access step N's status
{{stepN.error}}            — Access step N's error message
```

### Examples

**Example 1: Pass file path between steps**
```json
{
  "title": "Create and read file",
  "steps": [
    { "action": "Create file", "tool": "create_file", "arguments": { "path": "test.txt", "content": "hello" } },
    { "action": "Read file", "tool": "read_file", "arguments": { "path": "{{step1.output.path}}" } }
  ]
}
```

**Example 2: Delete and restore with backupId**
```json
{
  "title": "Delete and restore file",
  "steps": [
    { "action": "Delete file", "tool": "delete_file", "arguments": { "path": "test.txt" } },
    { "action": "Restore file", "tool": "restore_file", "arguments": { "backupId": "{{step1.output.backupId}}" } }
  ]
}
```

**Example 3: Nested field access**
```json
{
  "path": "{{step1.output.result.items[0].id}}"
}
```

### Type Preservation

Template variables preserve their original type:
- String: `{{step1.output.name}}` → `"hello"`
- Number: `{{step1.output.count}}` → `42`
- Boolean: `{{step1.output.success}}` → `true`
- Object: `{{step1.output.data}}` → `{ "key": "value" }`
- Array: `{{step1.output.items}}` → `[1, 2, 3]`

### Missing Variable Handling

If a template variable references a step that hasn't executed yet:
```json
{
  "status": "failed",
  "errorType": "MISSING_CONTEXT_VARIABLE",
  "variable": "{{step3.output.backupId}}"
}
```

## Error Classification

HooshiX classifies errors into categories for better recovery:

| Error Type | Status | Recoverable | Example |
|------------|--------|-------------|----------|
| `MISSING_CONTEXT_VARIABLE` | `failed` | No | Template references non-existent step |
| `SECURITY_POLICY` | `blocked` | No | Path outside workspace / sensitive file / approval required |
| `TIMEOUT` | `cancelled` → retry | Yes (backoff) | Step exceeded its timeout |
| `NETWORK` | `failed` → retry | Yes (backoff) | Connection refused/reset |
| Regular execution error | `failed` | Deterministic errors: No | File not found, invalid input |

### Security Blocks

When a security policy blocks an operation:
```json
{
  "status": "blocked",
  "error": "Access denied: path outside workspace",
  "errorType": "SECURITY_POLICY",
  "recoverable": false
}
```

## Recovery System

HooshiX automatically recovers from failures when possible:

| Error Pattern | Recovery Action |
|---------------|------------------|
| `timeout` (typed `TIMEOUT`) | `retry` with exponential backoff |
| network (typed `NETWORK`) | `retry` with exponential backoff |
| `approval` / `permission` | `ask_approval` |
| `build` / `test` / `verification` | `replan` |
| missing context variable | `stop` (not recoverable) |
| access denied / security / sensitive file | `stop` (not recoverable) |
| `enoent` / `file not found` | `stop` (file doesn't exist) |

## امنیت و قابلیت بازیابی

- تمام pathها به workspace roots محدودند و symlink/junction escape نیز با realpath رد می‌شود. مدل جدید workspace: pool چندریشه‌ای — `add_workspace_roots` root اضافه می‌کند، `remove_workspace_root` حذف می‌کند، و `set_workspace` فقط از بین rootهای مجاز یکی را Active انتخاب می‌کند (نه حذف، نه جایگزینی، و هیچ capabilityیی برای گسترش دسترسی ندارد — پارامتر `unrestricted` به‌طور کامل حذف شده است).
- **denylist فایل‌های حساس:** `.env*`, `.token`, `.npmrc`, `.netrc`, `.htpasswd`, `credentials.json`, `secrets.*`, کلیدهای SSH (`.ssh`), `.gnupg`, `.aws`, `.azure`, و پسوندهای `.pem/.key/.pfx/.p12/.kdbx` همیشه در read/write/delete/modify رد می‌شوند.
- فایل‌ها و جست‌وجوها محدودیت اندازه/تعداد دارند؛ writeها atomic و fsync هستند و `create_file` نیز exclusive-atomic است.
- پیش از overwrite، modify یا delete یک backup در SQLite ذخیره می‌شود و با `restore_file` قابل بازگردانی است؛ restore خودش محتوای جاری جایگزین‌شده را backup می‌گیرد (`displacedBackupId`).
- processها با `shell: false`، executable allowlist (بدون PowerShell)، argument validation، timeout و output cap اجرا می‌شوند. ابزارهای code-execution (node/python script، `npm run`، git/gh mutating) نیازمند approval هستند. **approval در فراخوانی مستقیم MCP هم الزامی است**؛ اگر می‌خواهید رفتار قبلی (auto-approve مستقیم) را داشته باشید `HOOSHIX_DIRECT_AUTO_APPROVE=1` را ست کنید.
- Git clone فقط URL امن HTTPS بدون credential توکار و مقصد جدید داخل workspace را می‌پذیرد. `task_rollback` فقط snapshot واقعی task (نه backup فایل) را می‌پذیرد، HEAD را با اعتبارسنجی `/^[0-9a-f]{40}$/` و argv جدا از هم اجرا می‌کند و cwd آن باید داخل workspace و منطبق بر snapshot باشد.
- package operation فقط پس از یک command مستقلِ verification موفق اعلام می‌شود؛ winget و Chocolatey به `ADMIN_MODE` نیاز دارند. `package_restore` نیز مثل بقیه عملیات‌های حساس تحت governance است.
- audit logها محتوی فایل و خروجی command را کپی نمی‌کنند و آرگومان‌های شبیه secret (حتی مقادیر خام مثل `sk-...`, `ghp_...`) را redacted می‌کنند. خروجی لازم در execution history همان task نگهداری می‌شود.
- خطاها به‌صورت typed (`TIMEOUT`, `NETWORK`, `SECURITY_POLICY`, ...) دسته‌بندی می‌شوند؛ timeout و network با **backoff نمایی** (پایه ۱ ثانیه، سقف ۳۰ ثانیه) retry می‌شوند و state `verifying` نیز مسیر resume دارد.
- retention پاک‌سازی خودکار رکوردهای قدیمی (پیش‌فرض ۹۰ روز، `HOOSHIX_RETENTION_DAYS`).

### HTTP endpoints و auth

سرور HTTP علاوه بر `/mcp` این endpointها را دارد: `/health`, `/metrics`, `/dashboard`, `/tools`. اگر توکن دسترسی (env یا `.token`) وجود داشته باشد، **همهٔ این endpointها هم به همان Bearer token نیاز دارند** (از طریق header یا `?token=` برای مرورگر). بدون توکن (حالت local stdio) باز می‌مانند. توکن در لاگ استارتاپ به‌صورت masked چاپ می‌شود، نه کامل.

HooshiX کد داخل workspace را با سطح دسترسی process سیستم‌عامل اجرا می‌کند. برای repository ناشناس یا غیرقابل‌اعتماد، process را داخل VM/container یا حساب OS محدود اجرا کنید.

## تست

مجموعهٔ تست شامل unit، integration و spawned-process MCP E2E است. سناریوی پذیرش واقعی، ساخت task توسط MCP، ایجاد فایل، اجرای Node، ذخیره و reload پس از restart منطقی runtime، memory/project context و گزارش نهایی را پوشش می‌دهد. Git روی repository واقعی محلی تست می‌شود و مرز clone/process جداگانه تست دارد.

coverage gate حداقل ۸۰٪ statement، ۷۵٪ branch، ۸۵٪ function و ۸۵٪ line است. entry pointها و adapterهای MCP در process فرزند تست می‌شوند و به‌دلیل ادغام‌نشدن V8 child coverage از گزارش parent مستثنا هستند.
