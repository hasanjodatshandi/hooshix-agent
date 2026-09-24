import path from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/client";

// The client's stdio subpath cannot be imported by its package subpath under
// TypeScript 7's NodeNext resolution (its bundled declaration re-exports from
// a hashed .mjs, which TS will not follow), so the transport is loaded through
// createRequire — which resolves the exports map correctly at runtime — and
// typed against the Transport the Client accepts.
const require = createRequire(import.meta.url);
const { StdioClientTransport } = require("@modelcontextprotocol/client/stdio") as {
  StdioClientTransport: new (options: {
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
  }) => Client extends { connect(transport: infer T): unknown } ? T : never;
};

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
