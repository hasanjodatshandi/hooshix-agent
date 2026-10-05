import { FileToolHandler } from "../../core/executor/handlers/file-handler.js";
import { GitToolHandler } from "../../core/executor/handlers/git-handler.js";
import { PackageToolHandler } from "../../core/executor/handlers/package-handler.js";
import { ShellToolHandler } from "../../core/executor/handlers/shell-handler.js";
import { SystemToolHandler } from "../../core/executor/handlers/system-handler.js";
import { TaskSnapshotToolHandler } from "../../core/executor/handlers/task-snapshot-handler.js";
import { ChatIsolationProbeHandler } from "../../core/executor/handlers/chat-isolation-probe-handler.js";
import { createHandlerDispatcher } from "../../core/executor/handlers/dispatcher-factory.js";

/**
 * R1 legacy compatibility composition: concrete ToolHandler instances are
 * created only here, once per server process. The R2 unified authorization
 * gateway will replace the legacy dispatch path; this is not a policy bypass.
 */
export const dispatchToHandler = createHandlerDispatcher([
  new SystemToolHandler(),
  new FileToolHandler(),
  new GitToolHandler(),
  new PackageToolHandler(),
  new ShellToolHandler(),
  new TaskSnapshotToolHandler(),
  new ChatIsolationProbeHandler(),
]);
