import { describe, expect, it } from "vitest";
import { connectTestMcpClient } from "../helpers/mcp-client.js";


describe("real mcp process integration", () => {
  it("connects to MCP server and lists tools", async () => {
    const client = await connectTestMcpClient();
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "agent_metrics", "create_file", "delete_file", "execute_command", "get_system_info", "get_workspace",
        "git_branch", "git_checkout", "git_clone", "git_commit", "git_diff", "git_status",
        "install_package", "list_directory", "memory_add", "memory_list", "modify_file",
        "project_list", "project_save", "read_file", "remove_package", "restore_file", "search_files",
        "set_workspace",
        "task_approve", "task_cancel", "task_create", "task_get", "task_list", "task_replay", "task_report", "task_resume", "task_run",
        "update_package", "write_file"
      ]);
      const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));
      expect(byName.get("read_file")?.annotations?.readOnlyHint).toBe(true);
      expect(byName.get("delete_file")?.annotations?.destructiveHint).toBe(true);
      expect(byName.get("git_clone")?.annotations?.openWorldHint).toBe(true);
    } finally {
      await client.close();
    }
  }, 30000);
});
