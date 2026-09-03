import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const API_KEY = process.env.MCP_API_KEY ?? "test123";
const SERVER_URL = process.env.MCP_URL ?? "http://localhost:3002/mcp";

async function main() {
  const client = new Client({ name: "test-client", version: "1.0.0" });

  const transport = new StreamableHTTPClientTransport(new globalThis.URL(SERVER_URL), {
    requestInit: {
      headers: { Authorization: `Bearer ${API_KEY}` },
    },
  });

  await client.connect(transport);
  console.log("✅ Connected to MCP server");

  const tools = await client.listTools();
  console.log(`\n📦 Total tools: ${tools.tools.length}`);
  console.log("\nAvailable tools:");
  for (const tool of tools.tools) {
    console.log(`  - ${tool.name}`);
  }

  await client.close();
  console.log("\n✅ Connection closed");
}

main().catch((e) => {
  console.error("❌ Error:", e.message);
  process.exit(1);
});
