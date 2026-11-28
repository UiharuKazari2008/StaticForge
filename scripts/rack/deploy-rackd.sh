#!/usr/bin/env bash
# Deploy rackd to a rack host. Idempotent.
#   scripts/rack/deploy-rackd.sh [server] [--tree] [--force] [--why "<reason>"]     (default server misaka)
# What is deployed: the COMMITTED services/rackd (git archive HEAD) of this checkout - never another agent's half-done
# working-tree files. --tree deploys the working tree instead (your own unfinished test only; say so in --why).
# Safety (Nov 27 2026: agents deployed from different trees, overwrote each other twice and killed a live emulator stream):
#   - one deploy at a time per host (flock on the host, 10 min wait at most);
#   - refused while rackd runs children other than its watchers (jobs, emulators, sandboxes, screen streams) unless --force;
#   - /opt/rackd/DEPLOYED records commit, tree/committed, who, when and why; the previous deploy is printed first.
set -euo pipefail
server=misaka; mode=committed; force=0; why=""
while [ $# -gt 0 ]; do case "$1" in --tree) mode=tree;; --force) force=1;; --why) why="${2:-}"; shift;; -*) echo "unknown option $1" >&2; exit 2;; *) server="$1";; esac; shift; done
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

src="$(mktemp -d)"; trap 'rm -rf "$src"' EXIT
commit="$(git -C "$root" rev-parse --short HEAD)"
if [ "$mode" = tree ]; then cp -a "$root/services/rackd/." "$src/"; commit="$commit+tree"
else git -C "$root" archive HEAD services/rackd | tar -x -C "$src" --strip-components=2; fi
who="${AGENT_COORD_ID:-${USER:-unknown}}@$(hostname)"

echo "== $server ($alias): last deploy: $(ssh "$alias" 'cat /opt/rackd/DEPLOYED 2>/dev/null || echo none')"
kids="$(ssh "$alias" 'systemd-cgls -u rackd.service --no-pager 2>/dev/null | grep -E "^[^U]" | grep -vE "rackd\.js|virsh -c qemu:///system event|docker events" | sed "s/^[^0-9]*//" | cut -c1-90' || true)"
if [ -n "$kids" ] && [ "$force" != 1 ]; then
  echo "rackd runs work that a deploy would kill (use --force only when that work is yours and may die):" >&2; echo "$kids" >&2; exit 3
fi
echo "== copying rackd ($commit)"
tmp="$(ssh "$alias" 'mktemp -d')"
rsync -a --delete -e ssh "$src/" "$alias:$tmp/"
printf '%s %s by %s at %s: %s\n' "$commit" "$mode" "$who" "$(date -Is)" "${why:-no reason given}" | ssh "$alias" "cat > $tmp/DEPLOYED"

echo "== installing"
ssh "$alias" "sudo flock -w 600 /run/rackd-deploy.lock bash -s -- '$tmp'" <<'REMOTE'
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
