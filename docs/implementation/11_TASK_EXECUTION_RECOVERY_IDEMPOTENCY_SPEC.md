# Task Execution, Recovery, Reconciliation, Idempotency & Lease Specification

**Primary findings:** HIGH-05, HIGH-06, HIGH-07, HIGH-13, MED-05, MED-08, MED-09.  
**Goal:** persisted Task state must never be treated as stronger evidence than the actual known external-effect state.

---

## 1. Fundamental execution contract

HooshiX does **not** promise exactly-once execution for external side effects. It promises:

- durable intent/state;
- exact known outcomes when available;
- bounded cancellation/termination attempts;
- explicit unknown outcomes;
- no unsafe retry of unknown non-idempotent effects;
- idempotent replay where a durable effect identity exists;
- reconciliation before retry otherwise;
- single active execution lease per Task across processes sharing the database.

This contract must be documented in product/API docs.

---

## 2. Execution lifecycle

For each step:

```text
pending
 -> governance/approval
 -> running (persisted + execution receipt started)
 -> ExecuteToolUseCase
    -> succeeded -> persist output/receipt -> succeeded
    -> known failure -> failed
    -> timeout/cancel with confirmed no effect/termination -> failed/cancelled according to policy
    -> unknown effect/termination -> outcome_unknown -> Task reconciling
```

A non-idempotent `outcome_unknown` step never becomes `pending` automatically.

---

## 3. Timeout protocol

Replace current `abort(); resolve(timedOut)` behavior with:

1. execution starts with unique `ExecutionId` and receipt;
2. timeout timer fires;
3. application requests cancellation on `ProcessRunnerPort`/tool execution context;
4. adapter attempts process-tree termination;
5. application waits a configurable **termination grace** (recommended default 5 seconds; config validated);
6. outcomes:
   - process/tool confirms completed before timeout handling finalizes -> use actual completion result;
   - process confirms terminated and tool-specific state proves no committed effect -> known failed/cancelled;
   - process terminates but effect may have committed -> `outcome_unknown`;
   - termination cannot be confirmed -> `outcome_unknown`;
7. no retry begins while previous execution termination/effect remains unknown.

For non-process adapters (filesystem/Git/package), execution receipts/reconciliation determine whether timeout uncertainty exists.

---

## 4. Crash recovery protocol

On startup:

1. query only interrupted Task IDs/states;
2. load each Task using canonical `TaskRepository.get` mapper;
3. acquire/inspect execution lease;
4. for any step persisted `running` at crash:
   - `read_only` -> may reset to pending if no required output exists and policy deems safe;
   - `idempotent_mutation` -> retry only if a durable idempotency key/receipt proves replay-safe;
   - `non_idempotent_mutation` -> convert to `outcome_unknown`;
5. Task enters `reconciling` when unknown exists;
6. do not call normal Task runner through unknown step until reconciliation decision.

The current behavior `running -> pending -> runClosedAgentLoop` must be removed.

---

## 5. Canonical hydration

### Requirement

One mapper is responsible for Task aggregate reconstruction. `findInterruptedTasks` cannot independently construct TaskPlan.

Canonical persistence round-trip must include:
- task ID/title/description/state/correlation;
- execution scope roots/active/unrestricted/version;
- max recovery/retry policy;
- total run count;
- idempotency key + request hash;
- each step ID/action/tool/arguments;
- original template arguments;
- dependencies/runWhen;
- timeout;
- attempts/failed attempts/history;
- state/output/error/error type;
- idempotency/effect receipt;
- timestamps/revisions.

Write a single round-trip test that sets every field non-default, persists, reloads, and deep-compares semantic equality.

Crash recovery must call the same method.

---

## 6. Reconciliation service

### 6.1 Reconciler contract

```ts
interface ToolReconciler {
  toolId: ToolId;
  reconcile(input: ReconciliationInput): Promise<ReconciliationDecision>;
}
```

Not every tool must have an automatic reconciler. Missing reconciler for non-idempotent mutation => manual intervention required.

### 6.2 Examples

#### File write with post-revision receipt
- if current file SHA equals receipt postRevision -> confirmed succeeded;
- if current equals preRevision -> confirmed failed/no effect;
- otherwise still unknown/manual due intervening mutation.

#### Create file with idempotency key
- if durable idempotency record matches payload/scope and file revision receipt -> confirmed succeeded.

#### Git commit
- if receipt stores expected created commit SHA and repository history contains exact commit -> confirmed succeeded;
- otherwise do not blindly retry; manual or tool-specific safe decision.

#### Package install
- inspect manager/package state only if adapter can reliably determine target result;
- otherwise manual intervention.

#### Arbitrary command
- default no automatic reconciliation unless command declares a specialized reconciler/idempotency contract.

---

## 7. Durable execution lease

### Purpose

Fix process-local `runningTasks` as correctness boundary.

### Record

```text
task_id PRIMARY KEY
owner_id
lease_token
acquired_at
heartbeat_at
expires_at
version
```

### Acquire semantics

Atomic SQLite statement/transaction equivalent:

```text
Acquire if no row exists OR existing expires_at < now.
On success set owner_id + random lease_token + expiry.
Return lease.
Otherwise return conflict.
```

Use `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE expires_at < :now` or an equivalent transaction verified by concurrent-process test.

### Renew

Condition on exact `task_id + owner_id + lease_token`; set heartbeat/expiry.

### Release

Delete/mark released only with exact lease token.

### TTL

Must exceed heartbeat interval with margin. Example policy:
- heartbeat every 5s;
- lease 20–30s;
- configurable.

Long external steps still renew from runtime heartbeat independent of child process completion.

### Crash

Lease expires naturally; recovery process can acquire after expiry, but running unknown step rules still apply.

The in-memory `Set` may remain as a local optimization but not correctness.

---

## 8. Task request idempotency

### Canonical request hash

Use deterministic serialization of Task creation request after defaults/normalization are defined.

Hash includes at least:
- title/description;
- ordered steps;
- ToolId/action/arguments;
- dependencies/runWhen/timeout;
- retry policy;
- any creation-time flags that affect execution semantics.

Workspace scope does not necessarily belong to client payload hash if it is server-captured; the idempotency record should also bind captured scope identity/version to avoid returning a Task created under a materially different scope unexpectedly. Define and test the exact rule.

### Behavior

- no key -> ordinary create;
- key not found -> create + store hash;
- key found + same hash and same effective creation scope contract -> return existing;
- key found + different hash/scope contract -> `IDEMPOTENCY_CONFLICT`.

Never silently return an unrelated Task.

---

## 9. Tool idempotency

### Storage

If an operation supports durable idempotency, record:

```text
idempotency_key
tool_id
arguments_hash
scope_hash
principal/task identity
execution_id
status
result/receipt reference
created_at
```

Unique on appropriate key/domain.

### Replay

Same key + same operation identity:
- completed -> return original known result/receipt;
- running/unknown -> return unknown/reconciliation required, not start another effect;
- failed known -> policy decides whether new attempt requires new key.

Same key + different args/scope -> conflict.

---

## 10. Telemetry failure semantics

Current audit proved post-effect audit failure can yield caller failure after effect succeeds.

New rule:

```text
Business execution outcome and telemetry write outcome are two axes.
```

Example:

```ts
{
  outcome: { kind: "succeeded", ... },
  telemetry: { status: "degraded", failures: [...] }
}
```

For security/compliance critical pre-effect audit intent, application may require a durable intent record before execution. Post-effect log failure must not turn success into failed-known.

Task runner must not automatically retry solely because AuditPort failed after effect completion.

---

## 11. Terminal append semantics

Final default:
- completed -> reject append `TASK_TERMINAL`;
- cancelled -> reject append `TASK_TERMINAL`;
- failed -> append allowed only if no unresolved outcome_unknown and dependencies valid;
- waiting approval -> modifications restricted because approval fingerprint/plan can be invalidated; require revoke/replan semantics;
- running -> reject concurrent plan mutation.

If reopening terminal Tasks is a future feature, it needs a new explicit use case creating a new Task revision, not an implicit state-machine escape.

---

## 12. Retry policy

Retry is decided by **error/outcome + effect class**, not only error string/category.

Safe automatic retry candidates:
- read-only transient network/timeout after termination known;
- idempotent operation with durable key and adapter guarantee;
- deterministic recovery action that does not duplicate external effect.

Never auto-retry:
- security denial;
- approval required;
- validation/template missing;
- non-idempotent unknown outcome;
- package/Git/arbitrary command after uncertain process crash without reconciliation.

Preserve exponential backoff/caps and persisted cumulative attempt budgets.

---

## 13. Crash/timeout/failure-injection tests

Mandatory:

1. Child process performs marker side effect, test kills HooshiX between effect and completion persistence; restart must mark unknown and not repeat marker.
2. Timeout child ignores/slowly handles cancellation; no retry process starts before termination grace/result.
3. Timeout child completes during cancellation race; final result reflects actual completed effect, not automatically unknown/failure if known.
4. Read-only interrupted step may resume safely according to policy.
5. Canonical hydration preserves every non-default field.
6. Two OS processes race `task_run` against same SQLite DB; exactly one lease acquired/external marker written.
7. Lease holder crashes; after TTL another process acquires, but unknown step still blocks unsafe replay.
8. Same Task idempotency key/different payload -> explicit conflict.
9. Same tool idempotency key/different args/scope -> explicit conflict.
10. Audit sink fails after effect -> caller still receives known success + telemetry degraded; Task not retried.
11. Append to completed/cancelled -> rejected.
12. Approval action fingerprint invalid after step/args change; cannot resume with stale approval.

---

## 14. Acceptance criteria

This subsystem is complete when:
- no process-local collection is the only same-task correctness guard;
- no recovery path builds a partial Task aggregate;
- no non-idempotent unknown effect auto-retries;
- timeout waits for termination acknowledgement/grace handling;
- `reconciliationRequired` is consumed by a real application use case/state;
- telemetry errors do not lie about external outcome;
- request/tool idempotency compares payload identity;
- all tests above run in CI.