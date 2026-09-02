import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export async function createStdioMcpInvoker(command: string, args: string[] = []) {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const transport = new StdioClientTransport({ command, args, cwd: process.cwd(), env });

  const client = new Client({
    name: "hooshix-agent-runtime",
    version: "0.1.0"
  });

  await client.connect(transport);

  return {
    async callTool(name: string, arguments_: Record<string, unknown>) {
      return client.callTool({ name, arguments: arguments_ });
    },
    async close() {
      await client.close();
    }
  };
}
