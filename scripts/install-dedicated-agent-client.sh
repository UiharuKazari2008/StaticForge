#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_PATH="$UNIT_DIR/dreamscape-agent-client.service"

if [[ ! -x /usr/bin/node ]]; then
    echo "Node.js is required at /usr/bin/node" >&2
    exit 1
fi
if [[ ! -x /usr/bin/chromium ]]; then
    echo "Chromium is required at /usr/bin/chromium" >&2
    exit 1
fi
mkdir -p "$UNIT_DIR"
/usr/bin/node "$ROOT/scripts/provision-dedicated-agent-client-key.js"
cat > "$UNIT_PATH" <<EOF
[Unit]
Description=Dreamscape dedicated server-side agent client
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT
ExecStart=/usr/bin/node $ROOT/scripts/dedicated-agent-client.js
Restart=always
RestartSec=5
TimeoutStopSec=10
Environment=HOME=$HOME
Environment=PATH=/usr/local/bin:/usr/bin:/bin
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable dreamscape-agent-client.service
systemctl --user restart dreamscape-agent-client.service
echo "Installed and started dreamscape-agent-client.service"
