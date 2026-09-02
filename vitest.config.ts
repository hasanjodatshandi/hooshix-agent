import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      HOOSHIX_DB_PATH: "./data/test-agent-memory.db",
      HOOSHIX_LOG_DIR: "./data/test-logs",
      HOOSHIX_MEMORY_FILE: "./data/test-agent-memory.json",
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
      // Stdio entry points and MCP adapters are exercised in spawned-process E2E tests;
      // V8 coverage from child processes is not merged into the parent report.
      exclude: ["src/index.ts", "src/mcp/**", "src/tools/**", "src/memory/database.ts"],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 85,
        lines: 85
      }
    },
    maxWorkers: 1
  }
});


