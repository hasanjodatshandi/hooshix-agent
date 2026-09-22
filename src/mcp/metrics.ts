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

export class McpMetrics {
  private toolCalls: ToolCallRecord[] = [];
  private sessions = new Map<string, SessionRecord>();
  private lifetimeSessions = 0;
  private lifetimeToolCalls = 0;
  private lifetimeSuccessful = 0;
  private lifetimeFailed = 0;
  private readonly lifetimePerTool = new Map<string, { calls: number; errors: number }>();
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
    this.lifetimeToolCalls++;
    if (success) this.lifetimeSuccessful++;
    else this.lifetimeFailed++;
    // Bound label cardinality. A reserved bucket absorbs unknown tool names.
    const metricTool = this.lifetimePerTool.has(tool) ? tool :
      (tool === "__other__" || this.lifetimePerTool.size >= 127 ? "__other__" : tool);
    const metric = this.lifetimePerTool.get(metricTool) ?? { calls: 0, errors: 0 };
    metric.calls++;
    if (!success) metric.errors++;
    this.lifetimePerTool.set(metricTool, metric);

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
    if (this.sessions.has(sessionId)) return;
    this.lifetimeSessions++;
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
    // Closed sessions carry no live state. Their lifetime count and peak are
    // independent aggregate counters, so never retain old IDs/client details.
    this.sessions.delete(sessionId);
  }

  /** Get active session count */
  private getActiveSessionCount(): number {
    return this.sessions.size;
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
    const totalSessions = this.lifetimeSessions;

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

  /** Prometheus 0.0.4 exposition: exactly one HELP/TYPE pair per metric family. */
  getPrometheusMetrics(): string {
    const snapshot = this.getSnapshot();
    const lines: string[] = [];
    const emit = (name: string, type: "counter" | "gauge", help: string,
      samples: ReadonlyArray<{ labels?: string; value: number }>): void => {
      lines.push("# HELP " + name + " " + help);
      lines.push("# TYPE " + name + " " + type);
      for (const sample of samples) {
        lines.push(name + (sample.labels ?? "") + " " + sample.value);
      }
    };
    const scalar = (name: string, type: "counter" | "gauge", help: string, value: number): void =>
      emit(name, type, help, [{ value }]);
    const escapeLabel = (value: string): string => value
      .replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
    const label = (tool: string): string => '{tool="' + escapeLabel(tool) + '"}';

    scalar("mcp_uptime_seconds", "gauge", "MCP server uptime in seconds", snapshot.uptime);
    scalar("mcp_sessions_total", "counter", "Lifetime number of MCP sessions created", snapshot.sessions.total);
    scalar("mcp_sessions_active", "gauge", "Current active MCP sessions", snapshot.sessions.active);
    scalar("mcp_sessions_peak_concurrent", "gauge", "Maximum concurrently active MCP sessions", snapshot.sessions.peakConcurrent);
    scalar("mcp_tool_calls_total", "counter", "Lifetime number of tool calls", this.lifetimeToolCalls);
    scalar("mcp_tool_calls_successful_total", "counter", "Lifetime successful tool calls", this.lifetimeSuccessful);
    scalar("mcp_tool_calls_failed_total", "counter", "Lifetime failed tool calls", this.lifetimeFailed);
    scalar("mcp_tool_duration_ms_avg", "gauge", "Mean duration of recent tool calls in milliseconds", snapshot.performance.avgDurationMs);

    // Tool-name cardinality is limited to 127 distinct names plus a shared overflow bucket.
    const allTools = [...this.lifetimePerTool].sort(([a], [b]) => a.localeCompare(b));
    emit("mcp_tool_calls_by_tool_total", "counter", "Lifetime tool calls by registered tool",
      allTools.map(([tool, value]) => ({ labels: label(tool), value: value.calls })));
    emit("mcp_tool_errors_by_tool_total", "counter", "Lifetime failed tool calls by registered tool",
      allTools.map(([tool, value]) => ({ labels: label(tool), value: value.errors })));
    emit("mcp_tool_duration_ms_by_tool", "gauge", "Mean duration of recent calls by tool in milliseconds",
      Object.entries(snapshot.tools).sort(([a], [b]) => a.localeCompare(b))
        .map(([tool, value]) => ({ labels: label(tool), value: value.avgMs })));
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
