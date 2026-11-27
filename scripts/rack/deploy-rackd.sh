#!/usr/bin/env bash
# Deploy rackd to a rack host: scripts/rack/deploy-rackd.sh [server]   (default misaka). Idempotent.
set -euo pipefail
server="${1:-misaka}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
cfg="$root/.cache/rack-manager/servers.json"
alias=""
[ -r "$cfg" ] && alias="$(jq -r --arg n "$server" '.[] | select(.name==$n) | .ssh // empty' "$cfg")"
if [ -z "$alias" ]; then
  [ "$server" = misaka ] && alias=fat-misaka || { echo "no ssh alias for $server (add it to $cfg)" >&2; exit 1; }
fi
secrets="$HOME/.secrets"; tokfile="$secrets/rackd-$server.token"
gitTok="$secrets/yozora-claude.token"
[ -r "$gitTok" ] || gitTok="$secrets/yozora-grok.cursor.token"

echo "== $server ($alias): copying rackd"
tmp="$(ssh "$alias" 'mktemp -d')"
rsync -a --delete -e ssh "$root/services/rackd/" "$alias:$tmp/"

echo "== installing"
ssh "$alias" "sudo bash -s -- '$tmp'" <<'REMOTE'
set -euo pipefail
tmp="$1"
install -d -m 755 /opt/rackd
rsync -a --delete "$tmp/" /opt/rackd/
rm -rf "$tmp"
id rack >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/rack --shell /bin/bash rack
for g in kvm libvirt; do getent group "$g" >/dev/null && usermod -aG "$g" rack || true; done
install -d -m 755 -o rack -g rack /var/lib/rack
install -d -m 755 /var/lib/rackd /etc/rackd
if [ ! -s /etc/rackd/token ]; then (umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > /etc/rackd/token); fi
chmod 600 /etc/rackd/token
install -m 644 /opt/rackd/rackd.service /etc/systemd/system/rackd.service
systemctl daemon-reload
systemctl enable rackd.service >/dev/null 2>&1
REMOTE

# git credentials for the builds role (never printed)
if [ -r "$gitTok" ]; then
  gt="$(tr -d '[:space:]' < "$gitTok")"
  printf 'https://claude:%s@yozora.bluesteel.737.jp.net\n' "$gt" \
    | ssh "$alias" 'sudo bash -c "umask 077; cat > /etc/rackd/git-credentials; chmod 600 /etc/rackd/git-credentials"'
  unset gt
fi

# token back to Dreamscape (never printed)
mkdir -p "$secrets"; ( umask 077; ssh "$alias" 'sudo cat /etc/rackd/token' > "$tokfile.new" )
chmod 600 "$tokfile.new"; mv "$tokfile.new" "$tokfile"

ssh "$alias" 'sudo systemctl restart rackd.service'
echo "== waiting for rackd"
for i in $(seq 1 30); do
  if out="$(ssh "$alias" 'sudo bash -c "printf \"Authorization: Bearer %s\" \"\$(cat /etc/rackd/token)\" | curl -sf -H @- http://127.0.0.1:8791/v1/info"' 2>/dev/null)"; then
    echo "$out" | jq -r '"rackd \(.rackd.version) on \(.host) (\(.os)), \(.cpus.threads) threads, \((.memory.totalB/1073741824)|floor) GB RAM", (.roles | to_entries[] | "  \(.key): installed=\(.value.installed) ready=\(.value.ready) - \(.value.summary)\(if (.value.missing|length)>0 then " [missing: \(.value.missing|join(","))]" else "" end)")'
    exit 0
  fi
  sleep 1
done
echo "rackd did not answer; see: ssh $alias sudo journalctl -u rackd -n 50" >&2; exit 1
