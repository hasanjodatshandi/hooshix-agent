# Adapters Technical Specification

This document defines concrete adapter behavior. Adapters translate technologies to/from application-owned ports; they do not own workflow policy.

---

## 1. Inbound MCP adapters

### 1.1 Shared responsibilities

Every MCP tool registration must:
- parse/validate untrusted input using the canonical schema registry;
- construct `Principal`, correlation ID and session context from transport context;
- call an application use case;
- map typed application result to MCP content/error metadata;
- never invoke filesystem/process/Git/package/SQLite directly;
- never duplicate permission/risk/approval policy;
- never access global workspace state.

### 1.2 Tool schema registry

Create one exhaustive schema registry keyed by `ToolId`.

```ts
const TOOL_SCHEMAS = {
  read_file: ...,
  search_files: ...,
  ...
} satisfies Record<ToolId, ZodTypeAny>;
```

The registry supports:
- MCP `inputSchema` registration;
- `ToolInputValidatorPort` implementation for persisted Task validation;
- generated `docs/TOOLS.md` metadata;
- schema/catalog completeness tests.

Policy metadata is not duplicated in Zod definitions.

### 1.3 Direct tool adapter behavior

Direct adapters call `ExecuteToolUseCase`.

If the result is `approval_required`:
- do not auto-execute;
- return structured MCP response instructing caller to use the governed Task/approval path, unless a future explicit direct-approval protocol is implemented;
- production HTTP never honors an auto-approve env bypass.

### 1.4 Task tool adapter

Task adapter exposes task use cases only. It contains no SQL and no direct handler/service calls.

For `task_create`, input validation occurs at adapter and application boundaries. Tool IDs are explicit.

For `task_append_steps`, terminal-state errors are mapped honestly.

---

## 2. HTTP MCP adapter

Responsibilities:
- Streamable HTTP MCP transport/session framing;
- access-token extraction from `Authorization: Bearer` only;
- call `ValidateAccessTokenUseCase`;
- map Principal into request context;
- session lifecycle/transport setup;
- CORS headers from validated allowlist config;
- no OAuth token issuance logic inline;
- no HTML dashboard rendering inline;
- no direct DB metrics queries.

Session limits:
- idle TTL configurable, recommended default 30 minutes;
- absolute session TTL configurable, recommended default 24 hours;
- closed sessions removed from transport and metric maps;
- per-principal session count bounded;
- graceful DELETE/close cleanup.

---

## 3. OAuth route adapter

Responsibilities:
- parse protocol requests/forms;
- validate allowed HTTP method/content type;
- normalize/validate redirect URI syntax and call auth use cases;
- render minimal authorization UI if embedded authorization server remains;
- map application auth errors to OAuth HTTP responses;
- never store raw access/refresh tokens in logs/URLs.

Security:
- authorization code + PKCE S256 only;
- `resource` required for MCP authorization/token requests according to current MCP authorization specification;
- access token accepted/presented only via Authorization header to MCP resource;
- no access token in URI query;
- public base URL is canonical and trusted from configuration, not Host header.

---

## 4. Monitoring/dashboard/health adapters

### `/health/live`

Unauthenticated, minimal:

```json
{"status":"ok"}
```

No pid, paths, tokens, versions or configuration unless explicitly deemed non-sensitive.

### `/health/ready`

Unauthenticated minimal 200/503 status based on:
- configuration initialized;
- database initialized/migrated;
- no fatal startup reconciliation state.

Response should remain low-information.

### `/metrics`

Requires monitoring scope/Authorization header. No query token.

### `/dashboard`

Do not embed the master/bootstrap token in HTML or URLs. Preferred implementation:
- authenticate via short-lived secure server session/cookie established from a dedicated operator login/OAuth flow;
- cookie: `Secure`, `HttpOnly`, `SameSite=Strict`, bounded TTL;
- dashboard API requests use that session.

If dashboard session is deferred, require Authorization header and accept that raw browser navigation needs a separate authenticated client mechanism; do not reintroduce `?token=`.

---

## 5. SQLite persistence adapter

### Connection

Preserve:
- WAL;
- foreign keys ON;
- busy timeout;
- short transactions;
- prepared/parameterized queries.

Add:
- centralized migrations only;
- explicit startup schema version validation;
- no silent per-call schema repair;
- graceful close on shutdown.

### Mappers

Each aggregate has one mapper:
- Task mapper is reused by normal load/recovery/report paths;
- mapper fields are exhaustive and compile/test checked;
- no `any` DB escape in core/application.

### Repository semantics

Use intention-specific transactions for:
- task create + idempotency conflict;
- exact approval consume;
- lease acquire/renew/release;
- refresh-token rotation;
- backup state transitions.

---

## 6. Node filesystem adapter

Preserve current strong primitives:
- atomic overwrite: temp -> fsync -> rename;
- exclusive create (`wx`) + fsync;
- bounded reads/writes;
- realpath/canonicalization support;
- no following of unauthorized symlink/junction escape.

Change responsibility split:
- adapter does low-level canonicalization/I/O;
- application decides allowed roots/sensitive paths/search byte budget;
- adapter never imports application authorization singleton.

File writes return actual post-write revision/hash where required.

Search walk adapter yields metadata/entries; application decides which files may be read. This prevents the current sensitive-file policy bypass caused by search reimplementing reads.

---

## 7. execa process adapter

Must preserve:
- `shell:false`;
- executable passed separately from args;
- bounded stdout/stderr;
- cancellation signal/process tree behavior;
- execution ID/receipt;
- no unsanitized environment inheritance.

Environment policy:
- application/infrastructure builds an allowlisted environment;
- do not pass bootstrap/OAuth/MCP secrets to subprocesses unless a specific operation explicitly requires a credential and policy approves it;
- PATH/essential runtime variables may be provided from validated config.

Termination:
- expose explicit `terminate(executionId, graceMs)` result;
- distinguish process terminated from termination uncertain;
- task timeout waits for this result.

---

## 8. Git adapter

Dedicated Git adapter should use execa/argv under the hood but expose semantic methods.

Security:
- repository root is pre-authorized/canonical;
- ref names validated;
- pathspecs authorized and separated with `--`;
- no credentials embedded in clone URL;
- clone target authorized;
- rollback commit SHA exact validated object ID;
- `diff` semantic method never executes `--no-index`.

Generic `execute_command git ...` is governed by command policy independently; it cannot rely on Git adapter protections.

---

## 9. Package adapters

Separate adapters by manager because rollback/install behavior differs.

Common guarantees:
- argv/no-shell execution;
- authorized cwd;
- timeout/output limits;
- sanitized environment;
- operation receipt;
- manifest state inspection.

Manager-specific notes:
- npm/pnpm: manifest+lock snapshot supported;
- pip: requirements/pyproject/lock metadata snapshot supported;
- winget/choco: no manifest rollback guarantee by default; report compensation unsupported unless a verified strategy exists.

Do not label manifest file restoration as installed-environment rollback.

---

## 10. Audit adapters

### JSONL adapter

- UTF-8 JSON lines;
- UTC timestamps or explicit offset;
- bounded fields;
- no stdout/file contents in command audit;
- redact sensitive flags and their following values;
- recognized token patterns plus configurable key names;
- log rotation/retention policy;
- file creation permissions appropriate to platform.

Fix separated arguments:

```text
--token VALUE
--api-key VALUE
--password VALUE
```

Both flag and value must be protected. Tests use opaque values with no "secret" keyword.

### Security-event persistence adapter

Security events may additionally be stored in SQLite for queryability. Do not duplicate inconsistent redaction logic: use one sanitizer/value-redaction utility in the adapter layer.

---

## 11. Prometheus adapter

Correct format:

```text
# HELP mcp_tool_calls_total Total MCP tool calls.
# TYPE mcp_tool_calls_total counter
mcp_tool_calls_total{tool="read_file",status="success"} 10
```

Never:

```text
# HELP mcp_tool_calls{tool="read_file"} ...
```

Rules:
- one HELP line per metric name;
- one TYPE line per metric name before samples;
- bounded labels only;
- content type correct for chosen exposition format;
- terminal newline;
- golden test and optional `promtool check metrics` CI gate.

---

## 12. Rate limiter adapter

Default single-process adapter: token bucket + concurrency counters.

Recommended configurable starting policies for the personal-agent deployment:
- OAuth authorize/token/register public endpoints: strict per-IP policy (e.g. low tens/minute with small burst);
- authenticated MCP request envelope: generous per-principal rate, configurable;
- expensive search/process/package classes: explicit concurrent-operation caps;
- return retry metadata when rate limited.

Do not hard-code business-specific values in application logic; policies come from validated config.

If multi-process HTTP is later supported, replace the adapter with a shared implementation; application port remains unchanged.

---

## 13. Config adapter

`env-config.loader.ts` is the only normal place that reads `process.env`.

It must:
- validate all fields on startup;
- reject unknown/deprecated dangerous combinations;
- fail explicitly if `MCP_API_KEY` is set instead of silently ignoring it;
- support a planned deprecation alias for `MCP_ACCESS_TOKEN` only if migration requires it;
- normalize paths;
- validate HTTP public base URL/CORS origins;
- validate numeric rate/search/session/retention limits;
- produce an immutable `AppConfig` object passed through composition.

Effective config log:
- logs names/booleans/limits/token source name;
- never logs secret values;
- includes permission ceiling, unrestricted capability, workspace roots, DB path category, public URL, retention/rate budgets.

---

## 14. Adapter contract tests

Required real-adapter tests:
- SQLite repository round-trip/migrations/transactions/lease/token rotation;
- Node filesystem atomicity/symlink/permissions/revisions;
- execa termination confirmation and output caps;
- Git semantic args and no-index prohibition;
- package manifest snapshot/restore contract;
- JSONL opaque secret redaction;
- Prometheus grammar/golden output;
- config fail-fast/deprecation behavior;
- rate limiter expiry/concurrency release;
- session metrics removal.

Application tests use fakes; adapter tests use disposable real resources.