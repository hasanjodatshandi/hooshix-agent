# HooshiX VPS Tunnel SSHD - Systemd Service Setup

## What This Does

Creates a systemd service that:
- Starts the tunnel sshd on port 2222 at boot
- Auto-restarts on crash (5 second delay)
- Limits restart attempts (10 per minute)
- Runs with security hardening

## Quick Install (One Command)

```bash
# Copy the files to VPS first, then:
sudo bash /path/to/install_vps_tunnel_service.sh
```

## Manual Install

### 1. Copy files to VPS

```bash
scp -P 2222 -i ~/.ssh/hooshix_tunnel_windows_ed25519 \
    scripts/sshd-hooshix-tunnel.service \
    hooshixadmin@188.240.196.151:/tmp/

scp -P 2222 -i ~/.ssh/hooshix_tunnel_windows_ed25519 \
    scripts/install_vps_tunnel_service.sh \
    hooshixadmin@188.240.196.151:/tmp/
```

### 2. SSH into VPS and install

```bash
ssh -p 2222 -i ~/.ssh/hooshix_tunnel_windows_ed25519 hooshixadmin@188.240.196.151

# Copy service file
sudo cp /tmp/sshd-hooshix-tunnel.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable on boot
sudo systemctl enable sshd-hooshix-tunnel

# Start now
sudo systemctl start sshd-hooshix-tunnel

# Verify
sudo systemctl status sshd-hooshix-tunnel
sudo ss -tlnp | grep 2222
```

## Management Commands

```bash
# Status
sudo systemctl status sshd-hooshix-tunnel

# Logs (live)
sudo journalctl -u sshd-hooshix-tunnel -f

# Logs (last 50 lines)
sudo journalctl -u sshd-hooshix-tunnel -n 50

# Restart
sudo systemctl restart sshd-hooshix-tunnel

# Stop
sudo systemctl stop sshd-hooshix-tunnel

# Disable on boot
sudo systemctl disable sshd-hooshix-tunnel
```

## Verification After Install

### Check service is running
```bash
sudo systemctl status sshd-hooshix-tunnel
# Should show: Active: active (running)
```

### Check port is listening
```bash
sudo ss -tlnp | grep 2222
# Should show: LISTEN 0 128 0.0.0.0:2222
```

### Check from Windows
```powershell
# Test SSH connection
ssh -p 2222 -i ~/.ssh/hooshix_tunnel_windows_ed25519 hooshixtunnel@188.240.196.151 echo "ok"

# Start tunnel
ssh -NT -p 2222 -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes -i ~/.ssh/hooshix_tunnel_windows_ed25519 -R 127.0.0.1:18898:127.0.0.1:3001 hooshixtunnel@188.240.196.151

# Test health
curl https://agent.hooshix.com/health
```

## Troubleshooting

### Service won't start
```bash
# Check config validity
sudo sshd -t -f /etc/ssh/sshd_config_hooshix_tunnel

# Check logs
sudo journalctl -u sshd-hooshix-tunnel -n 50
```

### Port 2222 already in use
```bash
# Find what's using it
sudo ss -tlnp | grep 2222

# Kill old process
sudo kill <PID>

# Restart service
sudo systemctl restart sshd-hooshix-tunnel
```

### Connection refused from Windows
```bash
# Check service status
sudo systemctl status sshd-hooshix-tunnel

# Check if sshd is listening
sudo ss -tlnp | grep 2222

# Check firewall
sudo ufw status | grep 2222
```

## Architecture

```
Windows                          VPS
─────────                        ─────
Node.js MCP (port 3001)  ──────> SSH Tunnel ──────> sshd (port 2222)
                                        │
                                        └──────> Caddy (port 443)
                                                        │
                                                        └────> agent.hooshix.com
```
