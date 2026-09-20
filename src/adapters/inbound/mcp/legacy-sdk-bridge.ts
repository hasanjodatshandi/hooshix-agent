/**
 * R1 inbound framework isolation boundary for the currently shipped MCP SDK v1.
 *
 * Legacy registration/transport modules import SDK symbols only through this
 * inbound bridge. Class identity and runtime behavior remain exactly the same.
 * This is NOT an MCP SDK v2 migration or a unified R2 tool gateway.
 */
export { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
export { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
