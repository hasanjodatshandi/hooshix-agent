import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export async function connectTestMcpClient(): Promise<Client> {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("node_modules/tsx/dist/cli.mjs"), path.resolve("src/index.ts")],
    cwd: process.cwd(),
    env
  });
  const client = new Client({ name: "integration-test-client", version: "0.1.0" });
  await client.connect(transport);
  return client;
}
