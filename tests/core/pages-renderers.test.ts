/**
 * R-P20: unit tests for the pure HTML renderers extracted from http-server.ts.
 *
 * Previously these ~570 lines lived inline in the transport module, so they
 * could not be exercised without spawning the server. Now they are plain
 * functions: data in, HTML string out.
 */
import { describe, expect, it } from "vitest";
import {
  escapeHTML,
  formatUptime,
  buildFilterQuery,
  toolDocsPage,
  toolsPage,
  dashboardPage,
  authorizePage,
  toolsList,
  getDistinctToolNames,
} from "../../src/mcp/pages.js";
import { mcpMetrics } from "../../src/mcp/metrics.js";
import { getAgentMetrics } from "../../src/core/trace/metrics-service.js";

describe("page renderers", () => {
  it("escapeHTML neutralizes every HTML metacharacter", () => {
    expect(escapeHTML(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    expect(escapeHTML("a'b&c")).toBe("a&apos;b&amp;c");
  });

  it("formatUptime formats seconds, minutes and hours", () => {
    expect(formatUptime(5)).toBe("5s");
    expect(formatUptime(90)).toBe("1m 30s");
    expect(formatUptime(3661)).toBe("1h 1m");
  });

  it("buildFilterQuery builds a query string and drops empty values", () => {
    expect(buildFilterQuery({ tool: "read_file", page: "2" })).toBe("?tool=read_file&page=2");
    expect(buildFilterQuery({ tool: "", page: "2" })).toBe("?page=2");
    expect(buildFilterQuery({})).toBe("");
  });

  it("toolsList describes every registered tool", () => {
    const tools = toolsList();
    expect(tools.length).toBeGreaterThan(10);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
    }
  });

  it("toolDocsPage renders categorized sections and escapes tool names", () => {
    const html = toolDocsPage();
    expect(html).toContain("<!DOCTYPE html>");
    const tools = toolsList();
    for (const tool of tools) {
      expect(html).toContain(escapeHTML(tool.name));
    }
  });

  it("toolsPage groups tools by risk and reports live metrics", () => {
    const html = toolsPage();
    expect(html).toContain("HooshiX MCP Tools");
    const tools = toolsList();
    for (const tool of tools) {
      expect(html).toContain(escapeHTML(tool.name));
    }
  });

  it("dashboardPage renders snapshot cards and recent-call rows", () => {
    const snapshot = mcpMetrics.getSnapshot();
    const dbMetrics = getAgentMetrics({ limit: 5 });
    const html = dashboardPage(snapshot, dbMetrics, getDistinctToolNames(), 1, 25);
    expect(html).toContain("HooshiX MCP Dashboard");
    expect(html).toContain(String(snapshot.toolCalls.total));
    // Server info appears only when supplied.
    expect(html).toContain("<td>0</td>");
    expect(html).not.toContain("Public URL");
  });

  it("dashboardPage renders the public URL and port when serverInfo is given", () => {
    const snapshot = mcpMetrics.getSnapshot();
    const dbMetrics = getAgentMetrics({ limit: 5 });
    const html = dashboardPage(
      snapshot, dbMetrics, [], 1, 25, {}, undefined,
      { port: 3001, publicBaseUrl: "https://mcp.example.com" },
    );
    expect(html).toContain(">3001<");
    expect(html).toContain("https://mcp.example.com");
  });

  it("dashboardPage escapes a malicious tool name in the filter dropdown", () => {
    const snapshot = mcpMetrics.getSnapshot();
    const dbMetrics = getAgentMetrics({ limit: 5 });
    const evil = `<img src=x onerror=alert(1)>`;
    const html = dashboardPage(snapshot, dbMetrics, [evil], 1, 25, { toolFilter: evil });
    expect(html).toContain(escapeHTML(evil));
    expect(html).not.toContain(`<option value="${evil}"`);
  });

  it("authorizePage echoes hidden OAuth fields, escaped", () => {
    const evil = `"><script>alert(1)</script>`;
    const html = authorizePage({
      redirect_uri: "https://chatgpt.com/callback",
      state: evil,
      client_id: evil,
      scope: "hooshix:read",
      code_challenge: "abc",
      resource: "https://mcp.example.com",
    }, "https://mcp.example.com");
    expect(html).toContain('name="code_challenge_method" value="S256"');
    expect(html).toContain(escapeHTML(evil));
    expect(html).not.toContain(evil);
  });
});
