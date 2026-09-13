import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export async function connectTestMcpClient(): Promise<Client> {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  // The workspace pool starts EMPTY by default (no implicit cwd root). The
  // spawned child would otherwise boot with no active workspace and deny
  // every file operation — seed the repo cwd as the operator would.
  env.HOOSHIX_WORKSPACE = process.env.HOOSHIX_WORKSPACE || process.cwd();
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
