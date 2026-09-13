#!/usr/bin/env bash
# Install a GitHub Actions self-hosted runner under /home/kanmi/ci-runners/github
# and register it for UiharuKazari2008/StaticForge with labels linux,dreamscape.
#
# Prerequisites:
#   - One-time registration token in ~/.secrets/github-runner.token
#     (Repo → Settings → Actions → Runners → New self-hosted runner)
#   - curl, tar, systemd --user
#
# Usage:
#   bash scripts/ci/install-github-runner.sh
#   bash scripts/ci/install-github-runner.sh --version 2.329.0

set -euo pipefail

REPO="${GITHUB_RUNNER_REPO:-UiharuKazari2008/StaticForge}"
INSTALL_DIR="${GITHUB_RUNNER_DIR:-$HOME/ci-runners/github}"
TOKEN_FILE="${GITHUB_RUNNER_TOKEN_FILE:-$HOME/.secrets/github-runner.token}"
LABELS="${GITHUB_RUNNER_LABELS:-linux,dreamscape}"
NAME="${GITHUB_RUNNER_NAME:-dreamscape-github}"
VERSION="${GITHUB_RUNNER_VERSION:-}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --version) VERSION="$2"; shift 2 ;;
        -h|--help)
            sed -n '2,14p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

[[ -f "$TOKEN_FILE" ]] || {
    echo "Missing $TOKEN_FILE — paste a one-time GitHub runner registration token there." >&2
    exit 1
}
TOKEN="$(tr -d '\n' < "$TOKEN_FILE")"

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

ARCH="$(uname -m)"
case "$ARCH" in
    x86_64) GH_ARCH="x64" ;;
    aarch64|arm64) GH_ARCH="arm64" ;;
    *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
esac

if [[ -z "$VERSION" ]]; then
    # Latest release tag from GitHub API (public)
    VERSION="$(curl -sS https://api.github.com/repos/actions/runner/releases/latest | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); console.log((j.tag_name||'').replace(/^v/,''))})")"
fi
[[ -n "$VERSION" ]] || { echo "Could not resolve runner version" >&2; exit 1; }

TGZ="actions-runner-linux-${GH_ARCH}-${VERSION}.tar.gz"
URL="https://github.com/actions/runner/releases/download/v${VERSION}/${TGZ}"

if [[ ! -f ./config.sh ]]; then
    echo "Downloading $URL"
    curl -fsSL -o "$TGZ" "$URL"
    tar xzf "$TGZ"
    rm -f "$TGZ"
fi

if [[ ! -f ./.runner ]]; then
    ./config.sh --unattended \
        --url "https://github.com/${REPO}" \
        --token "$TOKEN" \
        --name "$NAME" \
        --labels "$LABELS" \
        --work "_work" \
        --replace
fi

# User systemd unit
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/github-actions-runner.service" <<EOF
[Unit]
Description=GitHub Actions Runner (Dreamscape)
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/run.sh
Restart=always
RestartSec=10
KillMode=process
Environment=HOME=$HOME
Environment=PATH=/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now github-actions-runner.service
systemctl --user status github-actions-runner.service --no-pager || true

echo "GitHub runner installed at $INSTALL_DIR (labels: $LABELS)"
echo "Token file can be deleted after successful registration: $TOKEN_FILE"
