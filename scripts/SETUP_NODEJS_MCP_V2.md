# HooshiX Node.js MCP v2 - ChatGPT Connection Guide

## Architecture

```
ChatGPT → agent.hooshix.com (Caddy on VPS) → VPS:18898 → SSH tunnel → Windows localhost:3001 (Node.js MCP)
```

## Step 1: Start Node.js MCP Server (Windows)

```bash
cd D:\workspace\hooshix-agent
set MCP_PORT=3001
set MCP_API_KEY=hooshix-v2-secret
npm run dev:http
```

Or use the batch script:
```bash
D:\MCP\start_nodejs_mcp.bat
```

## Step 2: Start SSH Tunnel (Windows)

```bash
powershell.exe -ExecutionPolicy Bypass -File D:\MCP\hooshix_nodejs_mcp_tunnel.ps1
```

This creates: VPS:18898 → localhost:3001

## Step 3: Configure Caddy on VPS

SSH into your VPS and add this to the Caddyfile:

```caddy
agent.hooshix.com {
    tls {
        on_demand
    }

    reverse_proxy 127.0.0.1:18898 {
        health_uri /health
        health_interval 10s
        health_timeout 3s
        transport http {
            response_header_timeout 60s
        }
    }

    log {
        output stdout
        format json
    }
}
```

Then reload Caddy:
```bash
sudo systemctl reload caddy
```

## Step 4: Add DNS Record

Add a DNS A record for `agent.hooshix.com` pointing to your VPS IP (188.240.196.151).

## Step 5: Add Connector in ChatGPT

1. Go to ChatGPT → Settings → Connectors → Developer Mode
2. Click "Create"
3. Enter:
   - **URL**: `https://agent.hooshix.com/mcp`
   - **Name**: `HooshiX Agent v2`
4. Save

## Step 6: Test

Start a new chat in ChatGPT → Click "+" → Select "HooshiX Agent v2"

## Files Created

| File | Purpose |
|------|---------|
| `D:\MCP\hooshix_nodejs_mcp_tunnel.ps1` | SSH tunnel script for Node.js MCP |
| `D:\MCP\start_nodejs_mcp.bat` | Batch script to start both server + tunnel |
| `D:\MCP\caddy_mcp2_config.txt` | Caddy config snippet for VPS |

## Troubleshooting

### Tunnel not connecting
- Check SSH key exists: `C:\Users\Coder\.ssh\hooshix_tunnel_windows_ed25519`
- Check VPS SSH port: 2222
- Check VPS firewall allows port 18898

### ChatGPT can't connect
- Verify DNS: `nslookup agent.hooshix.com`
- Verify Caddy: `curl https://agent.hooshix.com/health`
- Check Caddy logs: `sudo journalctl -u caddy -f`

### Auth issues
- The Node.js MCP server uses `MCP_API_KEY=hooshix-v2-secret`
- ChatGPT will use OAuth to authenticate
- Make sure the OAuth endpoints are accessible
