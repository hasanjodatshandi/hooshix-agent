# Target Source Tree & Current-to-Target Migration Map

This document gives the implementing assistant an explicit physical restructuring map. It is not permission to mechanically move files; the target placement is determined by responsibility and dependency direction.

---

## 1. Target source tree

```text
src/
  domain/
    shared/
      result.ts
      errors.ts
      ids.ts
    task/
      task.ts
      task-step.ts
      task-state.ts
      task-state-machine.ts
      task-policy.ts
      retry-policy.ts
      execution-outcome.ts
      execution-receipt.ts
      reconciliation.ts
      idempotency.ts
      template-model.ts
    tool/
      tool-id.ts
      tool-risk.ts
      tool-effect.ts
      tool-descriptor.ts
      permission.ts
    workspace/
      workspace-scope.ts
      authorized-path.ts
      sensitive-path.ts
    approval/
      approval.ts
      approval-state.ts
    backup/
      file-backup.ts
      git-snapshot.ts
      package-snapshot.ts
    auth/
      principal.ts
      oauth-scope.ts
      token-metadata.ts

  application/
    ports/
      inbound/
        execute-tool.port.ts
        task-runtime.port.ts
        workspace-management.port.ts
        oauth.port.ts
        monitoring.port.ts
      outbound/
        task-repository.port.ts
        approval-repository.port.ts
        execution-lease.port.ts
        checkpoint-repository.port.ts
        trace-repository.port.ts
        recovery-repository.port.ts
        file-backup-repository.port.ts
        project-repository.port.ts
        package-snapshot-repository.port.ts
        workspace-context-repository.port.ts
        filesystem.port.ts
        path-canonicalizer.port.ts
        process-runner.port.ts
        git.port.ts
        package-manager.port.ts
        token-repository.port.ts
        authorization-code-store.port.ts
        audit.port.ts
        security-event.port.ts
        metrics.port.ts
        clock.port.ts
        id-generator.port.ts
        token-generator.port.ts
        rate-limiter.port.ts
        tool-input-validator.port.ts
    use-cases/
      tools/
        execute-tool.usecase.ts
      tasks/
        create-task.usecase.ts
        get-task.usecase.ts
        list-tasks.usecase.ts
        run-task.usecase.ts
        resume-task.usecase.ts
        approve-task.usecase.ts
        cancel-task.usecase.ts
        append-task-steps.usecase.ts
        reconcile-step-outcome.usecase.ts
        get-task-report.usecase.ts
      workspace/
        set-workspace.usecase.ts
        get-workspace.usecase.ts
        remove-workspace-root.usecase.ts
        replace-workspace-roots.usecase.ts
      auth/
        issue-authorization-code.usecase.ts
        exchange-authorization-code.usecase.ts
        refresh-token.usecase.ts
        validate-access-token.usecase.ts
      monitoring/
        get-metrics.usecase.ts
      retention/
        run-retention.usecase.ts
    services/
      authorization-service.ts
      workspace-access-policy.ts
      command-policy.ts
      tool-catalog.ts
      tool-dispatcher.ts
      task-runner.ts
      task-hydrator.ts
      reconciliation-service.ts
      compensation-service.ts
      template-resolver.ts
    handlers/
      filesystem/
      git/
      package/
      process/
      system/
      snapshot/
    dto/

  adapters/
    inbound/
      mcp/
        common/
          tool-schema-registry.ts
          principal-mapper.ts
          response-mapper.ts
          registry.ts
        stdio/
          stdio-mcp.adapter.ts
        http/
          streamable-http-mcp.adapter.ts
        tools/
          filesystem-tools.adapter.ts
          git-tools.adapter.ts
          package-tools.adapter.ts
          shell-tools.adapter.ts
          system-tools.adapter.ts
          task-tools.adapter.ts
      http/
        oauth-routes.adapter.ts
        monitoring-routes.adapter.ts
        health-routes.adapter.ts
        dashboard-routes.adapter.ts
        request-context.ts
    outbound/
      persistence/
        sqlite/
          sqlite-database.ts
          transaction.ts
          migrations/
          mappers/
            task.mapper.ts
            approval.mapper.ts
            backup.mapper.ts
            oauth-token.mapper.ts
          repositories/
            sqlite-task.repository.ts
            sqlite-approval.repository.ts
            sqlite-execution-lease.repository.ts
            sqlite-checkpoint.repository.ts
            sqlite-trace.repository.ts
            sqlite-recovery.repository.ts
            sqlite-file-backup.repository.ts
            sqlite-project.repository.ts
            sqlite-package-snapshot.repository.ts
            sqlite-oauth-token.repository.ts
      filesystem/
        node-filesystem.adapter.ts
        node-path-canonicalizer.adapter.ts
      process/
        execa-process.adapter.ts
      git/
        execa-git.adapter.ts
      package/
        npm-package.adapter.ts
        pnpm-package.adapter.ts
        pip-package.adapter.ts
        winget-package.adapter.ts
        choco-package.adapter.ts
      auth/
        in-memory-authorization-code.adapter.ts
        crypto-token-generator.adapter.ts
      observability/
        jsonl-audit.adapter.ts
        sqlite-security-event.adapter.ts
        prometheus-metrics.adapter.ts
        in-memory-session-metrics.adapter.ts
      rate-limit/
        token-bucket-rate-limiter.adapter.ts
      system/
        system-clock.adapter.ts
        uuid.adapter.ts

  infrastructure/
    config/
      app-config.ts
      env-config.loader.ts
      config-validation.ts
      effective-config-log.ts
    composition/
      composition-root.ts
    lifecycle/
      startup.ts
      graceful-shutdown.ts
      retention-scheduler.ts
      startup-reconciliation.ts
    server/
      http-node-server.ts
      stdio-server.ts

  bootstrap/
    index.ts
    index-http.ts
```

The exact filenames may evolve, but responsibilities and dependency directions are normative.

---

## 2. Current-to-target mapping

### Current bootstrap/transport

| Current | Target | Migration action |
|---|---|---|
| `src/index.ts` | `src/bootstrap/index.ts` + infrastructure startup | Reduce to config/composition/start only. |
| `src/index-http.ts` | `src/bootstrap/index-http.ts` | Same; no auth/recovery logic in entry point. |
| `src/mcp/server.ts` | `adapters/inbound/mcp/stdio` + infrastructure server | Keep MCP SDK outside application. |
| `src/mcp/http-server.ts` | split across inbound HTTP adapters + infrastructure server | Separate routing, OAuth, monitoring, session lifecycle and composition. |
| `src/mcp/registry.ts` | inbound MCP `registry.ts` | Register adapter endpoints generated from canonical tool IDs/schemas. |
| `src/mcp/oauth.ts` | application auth use cases + outbound token stores + HTTP adapter | Protocol parsing outside; token policy inside application. |
| `src/mcp/metrics.ts` | observability adapter | Correct Prometheus format and session retention. |
| `src/mcp/metrics-server.ts` | monitoring inbound adapter/infrastructure | No business/tool policy. |

### Current core runtime/task logic

| Current | Target | Migration action |
|---|---|---|
| `core/planner/task-planner.ts` | `domain/task/*` + application task DTO/validation | Split pure Task aggregate/state/invariants from adapter input validation. |
| `core/state/task-state-machine.ts` | `domain/task/task-state-machine.ts` | Preserve pure transition logic. |
| `core/runtime/template-resolver.ts` | `application/services/template-resolver.ts` or domain if fully pure | Preserve static single-pass/no-eval semantics. |
| `core/runtime/execution-context.ts` | domain/application execution context DTO | Remove infrastructure/global state dependencies. |
| `core/runtime/task-runtime-service.ts` | multiple `application/use-cases/tasks/*` | Eliminate god-service and hidden concrete imports. |
| `core/loop/closed-agent-loop.ts` | `application/services/task-runner.ts` + use cases | Keep state orchestration; inject all persistence/telemetry/tool execution ports. |
| `core/loop/checkpoint-integration.ts` | application checkpoint orchestration + port | No direct DB. |
| `core/loop/resume-*` / `plan-resume.ts` | resume/reconciliation use cases | Remove duplicate lifecycle paths. |
| `core/recovery/crash-recovery.ts` | infrastructure startup reconciliation invoking application recovery use case | Recovery policy/application; process scanning/startup outer. |
| `core/recovery/startup-recovery.ts` | merge/remove under one startup reconciliation flow | Delete unused report-only legacy behavior after tests. |

### Current governance/security

| Current | Target | Migration action |
|---|---|---|
| `core/governance/policy-decision-point.ts` | `application/services/authorization-service.ts` | Pure policy over Principal + ToolDescriptor + scope; no imports from outer `security`. |
| `core/governance/step-governance.ts` | application authorization/approval policy | One decision path for direct and task. |
| `core/governance/approval-memory.ts` | approval use cases + `ApprovalRepository` | Persistence moves to SQLite adapter. |
| `core/governance/governance-engine.ts` | remove obsolete string branch / merge pure rules | No parallel policy engine. |
| `security/permission.ts` | `domain/tool/permission.ts` + application policy | Server config supplies ceiling. |
| `security/workspace-guard.ts` | domain `WorkspaceScope` + application `WorkspaceAccessPolicy` + path adapter | Remove process-global mutable roots/unrestricted state. |
| `security/command-validator.ts` | application command policy + process adapter input validation | Keep no-shell/control char invariant. |
| `security/permissions/command-permission.ts` | `application/services/command-policy.ts` | Exact safe command patterns; path-aware policy. |

### Current tool orchestration/executor

| Current | Target | Migration action |
|---|---|---|
| `core/orchestrator/tool-orchestrator.ts` | domain `ToolId/Descriptor` + application ToolCatalog/Dispatcher | Remove heuristic fallback or constrain explicitly; one catalog. |
| `core/executor/local-tool-executor.ts` | `ExecuteToolUseCase` + dispatcher | No separate authorization path. |
| `core/executor/handlers/*` | application tool handlers depending on outbound ports | Handlers may remain conceptually but must no longer import concrete services. |
| `tools/filesystem/*` | inbound MCP filesystem adapter | Only schemas/request-response mapping. |
| `tools/git/index.ts` | inbound MCP git adapter | No service calls. |
| `tools/package/index.ts` | inbound MCP package adapter | No service calls. |
| `tools/shell/execute-command.ts` | inbound MCP shell adapter | Calls ExecuteTool use case. |
| `tools/system/*` | inbound system adapters | Workspace changes go through same authorization use case. |
| `tools/task/index.ts` | inbound task adapter | Remove all raw SQL/business logic; use application task use cases. |

### Current concrete services

| Current | Target | Migration action |
|---|---|---|
| `services/filesystem/filesystem-service.ts` | Node filesystem outbound adapter + application filesystem handlers/policy | Split I/O from sensitive/workspace/backup business rules. |
| `services/shell/shell-service.ts` | execa process adapter | Application validates cwd/policy; adapter executes authorized command. |
| `services/git/git-service.ts` | Git outbound adapter | Dedicated Git API; no governance singleton import. |
| `services/package/package-service.ts` | package-manager adapters + application snapshot/compensation use case | Truthful manifest rollback semantics. |

### Current persistence/memory/trace

| Current | Target | Migration action |
|---|---|---|
| `core/memory/database/**` | `adapters/outbound/persistence/sqlite/**` | All SQLite details move outward. |
| `core/memory/task-repository.ts` | `TaskRepository` port + SQLite adapter | One mapper/hydrator, no partial recovery path. |
| `core/memory/checkpoint-memory.ts` | `CheckpointRepository` port + adapter | Move SQL outward. |
| `core/memory/context-memory.ts` | split into explicit repositories/trace ports | Remove generic persistence shortcuts. |
| `core/memory/execution-trace.ts` | trace repository adapter/application trace service | Clarify ownership. |
| `core/memory/resume-memory.ts` | remove/merge into canonical TaskRepository/recovery | Eliminate legacy alternate query semantics. |
| `core/memory/sqlite-memory.ts` | delete after migration | No second SQLite abstraction. |
| `core/memory/tool-audit.ts` | outbound audit/metrics repository | No per-call schema introspection. |
| `core/trace/*` | application trace/recovery services + outbound repositories | Interfaces owned by application; persistent implementations move outward. |
| `memory/command-audit.ts` | JSONL audit outbound adapter | Fix redaction; no business outcome masking. |
| `memory/file-audit.ts` | JSONL audit outbound adapter | Same. |
| `memory/database.ts` | remove compatibility layer after migration | One DB adapter only. |

---

## 3. Migration order by vertical slice

Do not rename all files at once. Migrate these slices in order:

1. **Tool IDs/catalog + authorization contracts** (new code only).
2. **Workspace + filesystem read/search** vertical slice; route MCP + task through new gateway.
3. **Filesystem mutations/backup** slice.
4. **Generic process + Git** slice.
5. **Package management** slice.
6. **Task repository/use cases/task runner** slice.
7. **Recovery/lease/reconciliation** slice.
8. **OAuth/HTTP transport** slice.
9. **Metrics/audit/retention** slice.
10. **All remaining project/memory/system tools**.
11. Remove old services/handlers/tool files only when every route is cut over.

At each slice, the old and new path must not both remain externally reachable after cutover.

---

## 4. Legacy deletion checklist

Final repository must not contain active production dependencies on:

- old `src/tools/**` direct-to-service handlers;
- old `src/core/executor/handlers/**` concrete-service imports;
- `policyDecisionPoint` singleton as an ambient global;
- global mutable `workspaceRoots/activeWorkspace/unrestrictedMode` authorization state;
- raw `withAgentDatabase` calls outside SQLite adapters;
- duplicate `resume-memory`/startup recovery semantics;
- request-time schema creation in task MCP handlers;
- dead `config/config.json`;
- duplicate audit stacks with conflicting failure semantics;
- duplicated tool capability/permission/approval lists maintained in independent locations.

Compatibility wrappers may exist temporarily during migration but must be tagged with removal phase and tested to delegate inward without policy duplication.