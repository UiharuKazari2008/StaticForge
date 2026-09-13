#!/usr/bin/env bash
# Install a Gitea act_runner under /home/kanmi/ci-runners/gitea for Yozora.
#
# Prerequisites:
#   - Yozora Actions enabled on the repo/instance
#   - Registration token in ~/.secrets/yozora-runner.token
#     (Repo/Org → Settings → Actions → Runners → Create new runner)
#   - curl
#
# Usage:
#   bash scripts/ci/install-gitea-runner.sh
#   YOZORA_INSTANCE=https://yozora.bluesteel.737.jp.net bash scripts/ci/install-gitea-runner.sh

set -euo pipefail

INSTANCE="${YOZORA_INSTANCE:-https://yozora.bluesteel.737.jp.net}"
INSTALL_DIR="${GITEA_RUNNER_DIR:-$HOME/ci-runners/gitea}"
TOKEN_FILE="${GITEA_RUNNER_TOKEN_FILE:-$HOME/.secrets/yozora-runner.token}"
LABELS="${GITEA_RUNNER_LABELS:-linux,dreamscape}"
NAME="${GITEA_RUNNER_NAME:-dreamscape-yozora}"
# act_runner release tag (override if needed)
ACT_VERSION="${ACT_RUNNER_VERSION:-}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --version) ACT_VERSION="$2"; shift 2 ;;
        -h|--help)
            sed -n '2,14p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

[[ -f "$TOKEN_FILE" ]] || {
    echo "Missing $TOKEN_FILE — paste a one-time Yozora/Gitea runner registration token there." >&2
    exit 1
}
TOKEN="$(tr -d '\n' < "$TOKEN_FILE")"

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

ARCH="$(uname -m)"
case "$ARCH" in
    x86_64) ACT_ARCH="amd64" ;;
    aarch64|arm64) ACT_ARCH="arm64" ;;
    *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
esac

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"

if [[ -z "$ACT_VERSION" ]]; then
    ACT_VERSION="$(curl -sS https://gitea.com/api/v1/repos/gitea/act_runner/releases?limit=1 | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); console.log((j[0]&&j[0].tag_name)||'')})")"
fi
[[ -n "$ACT_VERSION" ]] || { echo "Could not resolve act_runner version" >&2; exit 1; }

BIN="act_runner"
if [[ ! -x ./$BIN ]]; then
    # Prefer gitea.com releases asset naming: act_runner-${ver}-${os}-${arch}
    ASSET="act_runner-${ACT_VERSION#v}-${OS}-${ACT_ARCH}"
    URL="https://gitea.com/gitea/act_runner/releases/download/${ACT_VERSION}/${ASSET}"
    echo "Downloading $URL"
    if ! curl -fsSL -o "$BIN" "$URL"; then
        # Fallback with .xz compressed asset
        URL_XZ="${URL}.xz"
        echo "Retry $URL_XZ"
        curl -fsSL -o "${BIN}.xz" "$URL_XZ"
        xz -d -f "${BIN}.xz"
    fi
    chmod +x "$BIN"
fi

if [[ ! -f ./config.yaml ]]; then
    ./"$BIN" generate-config > ./config.yaml
    # Restrict to labeled jobs; host labels match workflow runs-on
    # Labels are set at register time.
fi

if [[ ! -f ./.runner ]]; then
    ./"$BIN" register --no-interactive \
        --instance "$INSTANCE" \
        --token "$TOKEN" \
        --name "$NAME" \
        --labels "$LABELS" \
        --config ./config.yaml
fi

UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/gitea-act-runner.service" <<EOF
[Unit]
Description=Gitea act_runner (Yozora / Dreamscape)
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/$BIN daemon --config $INSTALL_DIR/config.yaml
Restart=always
RestartSec=10
Environment=HOME=$HOME
Environment=PATH=/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now gitea-act-runner.service
systemctl --user status gitea-act-runner.service --no-pager || true

echo "Gitea runner installed at $INSTALL_DIR (labels: $LABELS, instance: $INSTANCE)"
echo "Token file can be deleted after successful registration: $TOKEN_FILE"
