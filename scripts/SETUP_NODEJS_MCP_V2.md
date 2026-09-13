# HooshiX Node.js MCP - Local HTTP Setup Guide

## Architecture

```
MCP client (e.g. ChatGPT) → OAuth authorization → http://localhost:3001/mcp (Node.js MCP HTTP server)
```

The server runs locally on Windows. Public exposure (reverse proxy, tunneling, TLS)
is handled by a separate deployment project — this server only needs to be
reachable from the machine it runs on (or your private network).

## Step 1: Build and Start the Server

```bash
cd D:\workspace\hooshix-agent
pnpm install
pnpm run build
```

Start the server:

```bash
set MCP_PORT=3001
node dist\index-http.js
```

Or use the batch script:

```bash
scripts\start_nodejs_mcp.bat
```

For unattended operation, install the watchdog scheduled task:

```bash
scripts\install_nodejs_mcp_task.bat   (run as Administrator)
```

The watchdog starts the server at login, health-checks it every 10 seconds
(with the bearer token), and force-restarts it after 3 consecutive failed
health checks — this covers both crashes and frozen event loops.

## Step 2: Token

The server loads its access token from (in priority order):

1. `MCP_ACCESS_TOKEN` environment variable
2. `.token` file in the project root

If neither exists, a random token is generated and saved to `.token` automatically.

Manage the token with:

```bash
scripts\mcp-token.ps1 show    # display the current token
scripts\mcp-token.ps1 reset   # generate a new random token
scripts\mcp-token.ps1 copy    # copy to clipboard
```

## Step 3: Connect an MCP Client

Point your MCP client at:

- **URL**: `http://localhost:3001/mcp`
- **Auth**: OAuth (PKCE S256) — the client discovers the endpoints via
  `/.well-known/oauth-authorization-server`, or use the raw bearer token
  (`Authorization: Bearer <token>`).

Monitoring endpoints (browser-friendly):

- `http://localhost:3001/health` — liveness
- `http://localhost:3001/dashboard` — metrics dashboard
- `http://localhost:3001/tools` — tool catalog

All accept the token via `Authorization: Bearer <token>` header or `?token=<token>`.

## Step 4: Test

```bash
token=$(cat .token)
curl -H "Authorization: Bearer $token" http://localhost:3001/health
```

Expected: `{"status":"ok","bridge":"running",...}`

## Troubleshooting

### Server not starting
- Check the port is free: `netstat -ano | findstr :3001`
- Check the build exists: `dist\index-http.js`
- Watchdog log: `D:\MCP\HooshiXBrainMCP\.brain\logs\nodejs_mcp.jsonl`

### Auth issues
- Verify the token: `scripts\mcp-token.ps1 show`
- Unauthenticated `/health` returns 401 — that is correct behavior.
- OAuth authorization page is at `http://localhost:3001/oauth/authorize`.
