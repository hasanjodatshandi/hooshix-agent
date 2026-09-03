import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./registry.js";
import http from "node:http";
import crypto from "node:crypto";

const PORT = parseInt(process.env.MCP_PORT ?? "3001", 10);
const API_KEY = process.env.MCP_API_KEY ?? "";

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

const sessions = new Map<string, SessionEntry>();

function createServer(): McpServer {
  const server = new McpServer({
    name: "hooshix-agent",
    version: "0.1.0",
  });
  registerTools(server);
  return server;
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  // Health check endpoint (no auth required)
  if (url.pathname === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok", sessions: sessions.size, uptime: process.uptime() }));
    return;
  }

  // MCP endpoint
  if (url.pathname !== "/mcp") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  // CORS headers for ChatGPT
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Mcp-Session-Id, Authorization",
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // API key authentication (skip if no key configured)
  if (API_KEY) {
    const authHeader = req.headers.authorization ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (token !== API_KEY) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: "Invalid or missing API key" }));
      return;
    }
  }

  // DELETE — close session
  if (req.method === "DELETE") {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      const entry = sessions.get(sessionId)!;
      await entry.transport.close();
      sessions.delete(sessionId);
    }
    res.writeHead(200);
    res.end();
    return;
  }

  // GET — SSE stream for server-initiated messages
  if (req.method === "GET") {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      res.writeHead(400);
      res.end("Missing or invalid Mcp-Session-Id header");
      return;
    }
    const entry = sessions.get(sessionId)!;
    await entry.transport.handleRequest(req, res);
    return;
  }

  // POST — JSON-RPC messages
  if (req.method === "POST") {
    // New session if no session header
    const existingSessionId = req.headers["mcp-session-id"] as
      | string
      | undefined;

    if (existingSessionId && sessions.has(existingSessionId)) {
      const entry = sessions.get(existingSessionId)!;
      await entry.transport.handleRequest(req, res);
      return;
    }

    // Create new session
    const sessionId = crypto.randomUUID();
    const server = createServer();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
      enableJsonResponse: true,
    });

    sessions.set(sessionId, { transport, server });

    await server.connect(transport);

    // Forward the initial request
    await transport.handleRequest(req, res);

    // Cleanup on close
    transport.onclose = () => {
      sessions.delete(sessionId);
    };

    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
}

export function startHttpServer(): Promise<void> {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        await handleRequest(req, res);
      } catch (error) {
        console.error("MCP HTTP error:", error);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end("Internal server error");
        }
      }
    });

    server.listen(PORT, () => {
      console.error(`HooshiX MCP HTTP server running on http://localhost:${PORT}/mcp`);
      if (API_KEY) {
        console.error("API key authentication: ENABLED");
      } else {
        console.error("API key authentication: DISABLED (set MCP_API_KEY to enable)");
      }
      resolve();
    });
  });
}
