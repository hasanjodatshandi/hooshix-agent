/**
 * MCP Protocol Metrics Collector
 *
 * Tracks:
 * - Session lifecycle (created, closed)
 * - Tool calls (name, duration, success/failure)
 * - Protocol events (initialize, list_tools)
 * - Response times
 */

interface ToolCallRecord {
  tool: string;
  durationMs: number;
  success: boolean;
  timestamp: string;
  sessionId: string;
  error?: string;
}

interface SessionRecord {
  sessionId: string;
  createdAt: string;
  closedAt?: string;
  toolCalls: number;
  clientInfo?: string;
}

interface MetricsSnapshot {
  uptime: number;
  sessions: {
    total: number;
    active: number;
    peakConcurrent: number;
  };
  toolCalls: {
    total: number;
    successful: number;
    failed: number;
    successRate: string;
  };
  performance: {
    avgDurationMs: number;
    p95DurationMs: number;
    p99DurationMs: number;
  };
  tools: Record<string, { calls: number; avgMs: number; errors: number }>;
  recentCalls: ToolCallRecord[];
}

class McpMetrics {
  private toolCalls: ToolCallRecord[] = [];
  private sessions = new Map<string, SessionRecord>();
  private peakConcurrent = 0;
  private startTime = Date.now();
  private maxRecentCalls = 100;

  /** Record a tool call */
  recordToolCall(
    tool: string,
    durationMs: number,
    success: boolean,
    sessionId: string,
    error?: string,
  ): void {
    const record: ToolCallRecord = {
      tool,
      durationMs: Math.round(durationMs),
      success,
      timestamp: new Date().toISOString(),
      sessionId,
      ...(error ? { error } : {}),
    };
    this.toolCalls.push(record);

    // Keep only recent calls in memory
    if (this.toolCalls.length > this.maxRecentCalls * 2) {
      this.toolCalls = this.toolCalls.slice(-this.maxRecentCalls);
    }

    // Update session tool call count
    const session = this.sessions.get(sessionId);
    if (session) {
      session.toolCalls++;
    }
  }

  /** Record session creation */
  recordSessionCreated(sessionId: string, clientInfo?: string): void {
    this.sessions.set(sessionId, {
      sessionId,
      createdAt: new Date().toISOString(),
      toolCalls: 0,
      clientInfo,
    });

    const activeCount = this.getActiveSessionCount();
    if (activeCount > this.peakConcurrent) {
      this.peakConcurrent = activeCount;
    }
  }

  /** Record session closure */
  recordSessionClosed(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.closedAt = new Date().toISOString();
    }
  }

  /** Get active session count */
  private getActiveSessionCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (!session.closedAt) count++;
    }
    return count;
  }

  /** Get metrics snapshot */
  getSnapshot(): MetricsSnapshot {
    const now = Date.now();
    const uptime = Math.round((now - this.startTime) / 1000);

    const total = this.toolCalls.length;
    const successful = this.toolCalls.filter((c) => c.success).length;
    const failed = total - successful;

    // Calculate durations
    const durations = this.toolCalls.map((c) => c.durationMs).sort((a, b) => a - b);
    const avgDurationMs =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;
    const p95Index = Math.floor(durations.length * 0.95);
    const p99Index = Math.floor(durations.length * 0.99);

    // Per-tool breakdown
    const toolStats: Record<string, { calls: number; avgMs: number; errors: number }> = {};
    for (const call of this.toolCalls) {
      if (!toolStats[call.tool]) {
        toolStats[call.tool] = { calls: 0, avgMs: 0, errors: 0 };
      }
      toolStats[call.tool].calls++;
      if (!call.success) toolStats[call.tool].errors++;
    }
    // Calculate avg per tool
    for (const [tool, stats] of Object.entries(toolStats)) {
      const toolDurations = this.toolCalls
        .filter((c) => c.tool === tool)
        .map((c) => c.durationMs);
      stats.avgMs =
        toolDurations.length > 0
          ? Math.round(toolDurations.reduce((a, b) => a + b, 0) / toolDurations.length)
          : 0;
    }

    // Active sessions (exclude closed ones from recent 100)
    const activeSessions = this.getActiveSessionCount();
    const totalSessions = this.sessions.size;

    // Recent calls (last 50)
    const recentCalls = this.toolCalls.slice(-50).reverse();

    return {
      uptime,
      sessions: {
        total: totalSessions,
        active: activeSessions,
        peakConcurrent: this.peakConcurrent,
      },
      toolCalls: {
        total,
        successful,
        failed,
        successRate: total > 0 ? `${((successful / total) * 100).toFixed(1)}%` : "N/A",
      },
      performance: {
        avgDurationMs,
        p95DurationMs: durations.length > 0 ? durations[p95Index] ?? 0 : 0,
        p99DurationMs: durations.length > 0 ? durations[p99Index] ?? 0 : 0,
      },
      tools: toolStats,
      recentCalls,
    };
  }

  /** Get Prometheus-compatible metrics */
  getPrometheusMetrics(): string {
    const snapshot = this.getSnapshot();
    const lines: string[] = [];

    lines.push("# HELP mcp_uptime_seconds MCP server uptime in seconds");
    lines.push("# TYPE mcp_uptime_seconds gauge");
    lines.push(`mcp_uptime_seconds ${snapshot.uptime}`);

    lines.push("# HELP mcp_sessions_total Total sessions created");
    lines.push("# TYPE mcp_sessions_total counter");
    lines.push(`mcp_sessions_total ${snapshot.sessions.total}`);

    lines.push("# HELP mcp_sessions_active Currently active sessions");
    lines.push("# TYPE mcp_sessions_active gauge");
    lines.push(`mcp_sessions_active ${snapshot.sessions.active}`);

    lines.push("# HELP mcp_tool_calls_total Total tool calls");
    lines.push("# TYPE mcp_tool_calls_total counter");
    lines.push(`mcp_tool_calls_total ${snapshot.toolCalls.total}`);

    lines.push("# HELP mcp_tool_calls_successful Total successful tool calls");
    lines.push("# TYPE mcp_tool_calls_successful counter");
    lines.push(`mcp_tool_calls_successful ${snapshot.toolCalls.successful}`);

    lines.push("# HELP mcp_tool_calls_failed Total failed tool calls");
    lines.push("# TYPE mcp_tool_calls_failed counter");
    lines.push(`mcp_tool_calls_failed ${snapshot.toolCalls.failed}`);

    lines.push("# HELP mcp_tool_duration_ms_avg Average tool call duration");
    lines.push("# TYPE mcp_tool_duration_ms_avg gauge");
    lines.push(`mcp_tool_duration_ms_avg ${snapshot.performance.avgDurationMs}`);

    // Per-tool metrics
    for (const [tool, stats] of Object.entries(snapshot.tools)) {
      lines.push(`# HELP mcp_tool_calls{tool="${tool}"} Calls for tool ${tool}`);
      lines.push(`# TYPE mcp_tool_calls{tool="${tool}"} counter`);
      lines.push(`mcp_tool_calls{tool="${tool}"} ${stats.calls}`);
      lines.push(`mcp_tool_errors{tool="${tool}"} ${stats.errors}`);
      lines.push(`mcp_tool_duration_ms{tool="${tool}"} ${stats.avgMs}`);
    }

    return lines.join("\n") + "\n";
  }

  /** Console log a tool call */
  logToolCall(
    tool: string,
    durationMs: number,
    success: boolean,
    sessionId: string,
  ): void {
    const icon = success ? "✅" : "❌";
    const shortId = sessionId.slice(0, 8);
    console.error(
      `${icon} MCP tool_call tool=${tool} duration=${Math.round(durationMs)}ms session=${shortId}`,
    );
  }
}

// Singleton
export const mcpMetrics = new McpMetrics();
