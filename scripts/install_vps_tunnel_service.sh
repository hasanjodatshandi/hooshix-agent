#!/bin/bash
# HooshiX Tunnel SSHD - Systemd Service Installer
# Run as root on the VPS

set -e

SERVICE_NAME="sshd-hooshix-tunnel"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
CONFIG_FILE="/etc/ssh/sshd_config_hooshix_tunnel"

echo "=== HooshiX Tunnel SSHD Service Installer ==="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: This script must be run as root"
    exit 1
fi

# Check if config file exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo "ERROR: Config file not found: $CONFIG_FILE"
    exit 1
fi

# Validate config
echo "Validating SSH config..."
if ! /usr/sbin/sshd -t -f "$CONFIG_FILE"; then
    echo "ERROR: Invalid SSH config"
    exit 1
fi

# Stop any existing tunnel sshd on port 2222
echo "Stopping any existing tunnel sshd..."
pkill -f "sshd.*sshd_config_hooshix_tunnel" 2>/dev/null || true
sleep 1

# Install service file
echo "Installing service file..."
cp "$(dirname "$0")/sshd-hooshix-tunnel.service" "$SERVICE_FILE"
chmod 644 "$SERVICE_FILE"

# Reload systemd
echo "Reloading systemd daemon..."
systemctl daemon-reload

# Enable and start service
echo "Enabling service..."
systemctl enable "$SERVICE_NAME"

echo "Starting service..."
systemctl start "$SERVICE_NAME"

# Wait and verify
sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo ""
    echo "=== SUCCESS ==="
    echo "Service '$SERVICE_NAME' is running"
    echo ""
    systemctl status "$SERVICE_NAME" --no-pager -l
    echo ""
    echo "Port check:"
    ss -tlnp | grep 2222 || echo "WARNING: Port 2222 not listening"
else
    echo ""
    echo "=== FAILED ==="
    echo "Checking logs..."
    journalctl -u "$SERVICE_NAME" --no-pager -n 20
    exit 1
fi
