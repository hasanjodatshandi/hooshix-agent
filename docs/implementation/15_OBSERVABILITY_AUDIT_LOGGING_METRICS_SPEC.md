# Observability, Audit Logging, Metrics & Security Events Specification

**Primary findings:** MED-02, MED-05, MED-18, MED-19, MED-20, MED-25; supports HIGH-04/05/06/11 and MED-03/21/22.  
**Principle:** observability must describe reality without becoming a source of false business outcomes or secret leakage.

---

## 1. Signal model

HooshiX uses four application-owned signal ports:

1. `AuditPort` — operator/action audit trail.
2. `SecurityEventPort` — authn/authz/rate/sensitive-scope security events.
3. `TracePort` — task/step/execution/recovery correlation timeline.
4. `MetricsPort` — bounded semantic counters/gauges/histograms.

Transport/framework logging is adapter-specific and supplements, not replaces, these signals.

---

## 2. Separation of business outcome and telemetry outcome

The application result must never be rewritten from known success to known failure solely because post-effect audit/metrics persistence failed.

Use a model such as:

```ts
interface ObservedResult<T> {
  outcome: T;
  observability: {
    status: "ok" | "degraded";
    failures: readonly ObservabilityFailure[];
  };
}
```

Rules:
- pre-effect compliance intent may be required for configured critical operations; if mandatory intent persistence fails, operation does not start;
- post-effect telemetry failure produces `observability_degraded` and health/security signal;
- Task retry policy never retries a side effect just because post-effect logging failed;
- fallback logger must avoid secrets and recursion loops.

---

## 3. Structured audit events

Canonical event envelope:

```ts
interface AuditEvent {
  eventId: EventId;
  at: Instant;
  correlationId: CorrelationId;
  principalId?: PrincipalId;
  taskId?: TaskId;
  stepId?: StepId;
  operationId: OperationId;
  phase: "intent" | "result";
  outcome: "allowed" | "approval_required" | "blocked" | "succeeded" | "failed" | "outcome_unknown";
  durationMs?: number;
  targetSummary?: SafeTargetSummary;
  errorCode?: string;
  metadata?: SafeAuditMetadata;
}
```

Never include:
- file contents;
- raw command secret args;
- access/refresh/bootstrap tokens;
- OAuth code or PKCE verifier;
- raw environment variables;
- arbitrary large tool output.

---

## 4. Command argument redaction

Fix MED-02 with a deterministic parser/redactor.

### Sensitive flags

Maintain a bounded canonical set/pattern for flags such as:
- `--token`, `--access-token`, `--api-key`, `--password`, `--secret`, `--credential`, `--private-key`, equivalents with `=`.

Algorithm:
1. iterate argv;
2. if previous flag requires secret value -> redact current arg entirely;
3. if current arg is sensitive `name=value` -> preserve name, redact value;
4. if current arg is a sensitive standalone flag -> redact flag as policy desires and set `redactNext=true`;
5. recognized token prefixes/high-entropy known formats -> redact entire arg;
6. never attempt to log raw environment map.

Tests must use opaque values with no keyword/prefix, e.g. random alphanumeric strings, to prevent false confidence.

---

## 5. Security event taxonomy

Required event names:

### Authentication/OAuth
- `auth.access_token.accepted`
- `auth.access_token.rejected`
- `auth.access_token.expired`
- `auth.scope.insufficient`
- `auth.authorization_code.issued|consumed|rejected`
- `auth.refresh.rotated|replay_detected|family_revoked`
- `auth.bootstrap.login_success|login_failure`

### Authorization/tool
- `authorization.allowed`
- `authorization.denied`
- `authorization.approval_required`
- `approval.created|approved|consumed|expired|revoked`
- `workspace.scope_expansion.requested|denied|approved`
- `sensitive_path.denied|search_skipped`
- `command.policy.blocked|approval_required`

### Reliability
- `execution.outcome_unknown`
- `execution.reconciliation_started|resolved|manual_required`
- `task.lease_acquire_failed|expired|stolen_after_expiry`
- `observability.degraded`

### Availability
- `rate_limit.exceeded`
- `search.budget_exceeded`
- `retention.completed|failed`

No event contains secret payloads.

---

## 6. Trace model

Keep correlation/timeline strengths but normalize around application execution IDs.

Trace hierarchy:

```text
Correlation
  Task (optional)
    Step
      ToolExecution (ExecutionId)
        AuthorizationDecision
        Approval lifecycle (optional)
        Adapter effect
        Reconciliation lifecycle (optional)
```

Required trace fields are bounded enums/IDs/timestamps. Persist large tool outputs separately/bounded as existing design does.

A crash/restart must be traceable across the same execution receipt/reconciliation record.

---

## 7. Metrics model

Recommended metric families:

### Tool/application
- `hooshix_tool_calls_total{tool,outcome}`
- `hooshix_tool_duration_seconds{tool,outcome}` histogram
- `hooshix_authorization_decisions_total{decision,operation_class}`
- `hooshix_approval_requests_total{result}`

### Task/recovery
- `hooshix_tasks_total{state}` or bounded transition counters
- `hooshix_step_outcome_unknown_total{tool}`
- `hooshix_reconciliation_total{result,tool_class}`
- `hooshix_task_lease_conflicts_total`
- `hooshix_task_lease_age_seconds` gauge where useful

### HTTP/OAuth
- `hooshix_http_requests_total{route_class,status_class}`
- `hooshix_auth_failures_total{reason}`
- `hooshix_refresh_replay_total`
- `hooshix_rate_limit_rejections_total{class}`
- active bounded session/dashboard session gauges if legacy/UI state exists

### Storage/performance
- `hooshix_db_operation_duration_seconds{operation}`
- `hooshix_retention_deleted_total{class}`
- `hooshix_search_scanned_bytes_total`
- `hooshix_search_budget_exceeded_total`
- `hooshix_observability_degraded_total{sink}`

Avoid high-cardinality labels: never label by task ID, correlation ID, file path, user-supplied command, client ID if unbounded.

---

## 8. Prometheus exposition

Fix MED-25.

Correct pattern:

```text
# HELP hooshix_tool_calls_total Total tool executions.
# TYPE hooshix_tool_calls_total counter
hooshix_tool_calls_total{tool="read_file",outcome="succeeded"} 12
```

Rules:
- one HELP line per metric name;
- one TYPE line per metric name, before samples;
- labels only on sample lines;
- escape label values correctly;
- deterministic family order preferred for golden tests;
- metric names follow stable prefix/naming convention.

CI should run a golden parser test and `promtool check metrics` when available in CI tooling/container.

---

## 9. HTTP request logging

Add minimal structured HTTP logs at infrastructure adapter boundary:
- request ID/correlation ID;
- route class, method;
- status;
- duration;
- authenticated principal ID/token record ID only after successful auth;
- failure category.

Do not log:
- Authorization header;
- Cookie values;
- query strings wholesale;
- OAuth form bodies;
- tool arguments by default.

If URL logging is retained, scrub sensitive parameters generically.

---

## 10. JSONL audit sink

JSONL may remain for local operational audit.

Requirements:
- rotation strategy (size/time) or use an adapter that manages rotation;
- restricted file permissions where supported;
- append errors surfaced as degraded state;
- no duplicate second policy implementation;
- format version field for future parsing;
- bounded metadata;
- timestamps ISO/UTC or normalized instant representation.

SQLite tool/security event sink may coexist for queryability, but both implement ports and consume the same sanitized application event; they must not independently redact differently.

---

## 11. Retention

Define retention per signal class in document 13/18.

Observability-specific expectations:
- periodic cleanup, not startup only;
- active incident/reconciliation/security evidence retained appropriately;
- JSONL rotation/retention documented separately from SQLite retention;
- metrics in-memory session objects pruned; lifetime totals retained as counters, not object history.

---

## 12. Health/readiness observability

`/health/live`: process liveness only, no auth, minimal.

`/health/ready`: readiness state only; detailed cause is logged/authenticated diagnostics, not exposed publicly.

Authenticated diagnostics can expose:
- DB migration status;
- retention last success;
- observability degraded sinks;
- unresolved reconciliation count;
- lease conflicts;
- supported protocol versions;
without exposing tokens/paths/secrets.

---

## 13. Required tests

1. `--token opaqueValue` redacts both sensitive semantic flag/value correctly.
2. `--api-key=opaqueValue` redacted.
3. recognized raw token prefix redacted.
4. benign args preserved.
5. audit sink failure after successful file/process effect -> business success + observability degraded.
6. mandatory pre-effect intent failure blocks configured critical effect before execution.
7. audit/metrics events contain no file content/raw token in snapshot tests.
8. Prometheus output passes grammar/golden and promtool where available.
9. HELP/TYPE appear once per family; labels only on samples.
10. high-cardinality IDs not used as metric labels.
11. closed session churn does not grow active in-memory state indefinitely.
12. HTTP unauthorized requests generate safe reason category without Authorization header logging.
13. OAuth raw access/refresh/bootstrap/code/verifier values absent from logs.
14. retention prunes expired telemetry but preserves unresolved reconciliation evidence.
15. observability degraded counter/event emitted on sink failure without recursive failure loop.

---

## 14. Definition of done

- MED-02/05/18/19/20/25 resolved;
- one application event model feeds sinks;
- known business success cannot be converted to failure by post-effect telemetry error;
- Prometheus format compliant;
- session metrics bounded;
- per-call schema introspection removed;
- audit redaction regression covers opaque separate values;
- HTTP/OAuth logging safe and useful;
- retention/rotation policies documented and tested.