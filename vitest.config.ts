import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // R8.06: the SQLite/log/memory paths are owned by the setup file so each
    // parallel Vitest worker gets an isolated tree; a single shared database
    // file here would let workers delete each other's open database.
    env: {
      HOOSHIX_WORKSPACE: process.cwd(),
      HOOSHIX_PERMISSION_LEVEL: "DEVELOPER_MODE"
    },
    setupFiles: ["./tests/setup/database-cleanup.ts"],
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      // Stdio/HTTP entry points spawn child processes in E2E; V8 coverage from
      // children is not merged into the parent report. The transport adapters
      // (mcp/server.ts, http-server.ts) stay excluded for that reason only —
      // tool implementations (src/tools/**) ARE covered.
      exclude: ["src/index.ts", "src/index-http.ts", "src/mcp/server.ts", "src/mcp/http-server.ts", "src/mcp/metrics-server.ts", "src/mcp/registry.ts", "src/mcp/oauth.ts", "src/mcp/metrics.ts", "src/memory/database.ts"],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 85,
        lines: 85
      }
    }
  }
});


