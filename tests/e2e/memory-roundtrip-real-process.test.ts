import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { connectTestMcpClient } from "../helpers/mcp-client.js";
import { json } from "../helpers/in-process-mcp.js";

/**
 * Unlike the in-process memory test, this traverses the actual spawned MCP
 * transport and principal context. Every record stays in a disposable DB.
 */
describe("memory single-record lookup through a real MCP process", () => {
  it("returns the same principal-owned record exposed by memory_list", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hooshix-memory-roundtrip-"));
    let client: Awaited<ReturnType<typeof connectTestMcpClient>> | undefined;
    try {
      client = await connectTestMcpClient({
        HOOSHIX_DB_PATH: path.join(root,"isolated-agent.db"),
        HOOSHIX_LOG_DIR: path.join(root,"logs"),
      });
      const added = json(await client.callTool({
        name:"memory_add", arguments:{kind:"roundtrip",content:"temporary"}
      }));
      expect(typeof added.id).toBe("number");
      const listed = json(await client.callTool({
        name:"memory_list", arguments:{kind:"roundtrip",limit:10}
      }));
      expect(listed.items).toHaveLength(1);
      expect(listed.items[0].id).toBe(added.id);
      const got = json(await client.callTool({
        name:"memory_get", arguments:{memoryId:added.id}
      }));
      expect(Object.prototype.hasOwnProperty.call(got,"content")).toBe(false);
      expect(Object.keys(got)).toEqual(["record"]);
      expect(got.record).toMatchObject({
        id:added.id,kind:"roundtrip",content:"temporary"
      });
      const removed = json(await client.callTool({
        name:"memory_delete", arguments:{memoryId:added.id}
      }));
      expect(removed).toEqual({memoryId:added.id,deleted:true});
      expect(json(await client.callTool({
        name:"memory_get",arguments:{memoryId:added.id}
      }))).toBeNull();
    } finally {
      await client?.close();
      await fs.rm(root,{recursive:true,force:true});
    }
  }, 45000);
});
