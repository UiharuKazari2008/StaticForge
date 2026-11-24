#!/bin/sh
# Fleet Contractor installer for Linux (#1154). Installs the headless agent that connects this machine to a
# Dreamscape Fleet server, pairs it with a one-time code from Fleet, and runs it as a systemd --user service.
#
#   sh fleet-contractor-install.sh --server https://dreamscape.example --name "Build box" --project ~/src/app
#   sh fleet-contractor-install.sh --uninstall
#
# The pairing code is asked for at the prompt (or read from FLEET_PAIR_CODE); it is never a command-line
# argument. Options: --server URL, --name NAME, --project DIR (repeat), --claude PATH (the claude CLI),
# --prefix DIR (install dir, default ~/.local/share/fleet-contractor), --no-service (no systemd unit),
# --dry-run (check and print what would happen; writes only under --prefix / FLEET_CONTRACTOR_HOME),
# --uninstall. Needs: node >= 20, the claude CLI (logged in: its login stays on this machine), tmux.
set -eu

SERVER=""
NAME=""
PROJECTS=""
CLAUDE_BIN=""
PREFIX="${XDG_DATA_HOME:-$HOME/.local/share}/fleet-contractor"
SERVICE=1
DRY=0
UNINSTALL=0
UNIT=fleet-contractor.service

# >>> embedded files (filled in by the server)
embedded_agent() { return 1; }
embedded_transcript() { return 1; }
# <<< embedded files

while [ $# -gt 0 ]; do
    case "$1" in
        --server) SERVER="$2"; shift 2 ;;
        --name) NAME="$2"; shift 2 ;;
        --project) PROJECTS="$PROJECTS
$2"; shift 2 ;;
        --claude) CLAUDE_BIN="$2"; shift 2 ;;
        --prefix) PREFIX="$2"; shift 2 ;;
        --no-service) SERVICE=0; shift ;;
        --dry-run) DRY=1; shift ;;
        --uninstall) UNINSTALL=1; shift ;;
        --code|--pair-code) echo "The pairing code is not taken as an argument: it is asked for (or FLEET_PAIR_CODE)." >&2; exit 2 ;;
        -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
        *) echo "Unknown option $1" >&2; exit 2 ;;
    esac
done

say() { printf '%s\n' "fleet-contractor: $*"; }
die() { printf '%s\n' "fleet-contractor: $*" >&2; exit 1; }
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
CONF_DIR="${FLEET_CONTRACTOR_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/fleet-contractor}"

if [ "$UNINSTALL" = 1 ]; then
    if command -v systemctl >/dev/null 2>&1; then
        systemctl --user disable --now "$UNIT" 2>/dev/null || true
        rm -f "$UNIT_DIR/$UNIT"
        systemctl --user daemon-reload 2>/dev/null || true
    fi
    rm -rf "$PREFIX"
    rm -f "$CONF_DIR/credential.json"
    say "removed the agent and its credential. Revoke the contractor in Fleet too; $CONF_DIR/config.json is kept."
    exit 0
fi

# ---- checks
command -v node >/dev/null 2>&1 || die "node is not installed (Node.js 20 or newer is needed)"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js $NODE_MAJOR is too old: 20 or newer is needed"
NODE_BIN=$(command -v node)
if [ -z "$CLAUDE_BIN" ]; then
    CLAUDE_BIN=$(command -v claude 2>/dev/null || true)
    [ -n "$CLAUDE_BIN" ] || [ ! -x "$HOME/.local/bin/claude" ] || CLAUDE_BIN="$HOME/.local/bin/claude"
fi
[ -n "$CLAUDE_BIN" ] && [ -x "$CLAUDE_BIN" ] || die "the claude CLI was not found (install Claude Code and log in, or pass --claude PATH)"
command -v tmux >/dev/null 2>&1 || die "tmux is not installed (sessions run in tmux with Remote Control on)"
[ -n "$SERVER" ] || die "--server https://... is needed"
case "$SERVER" in https://*|http://*) ;; *) die "--server must start with https://" ;; esac
[ -n "$NAME" ] || NAME=$(hostname)
say "node $(node --version), $("$CLAUDE_BIN" --version 2>/dev/null | head -n1), $(tmux -V)"

# ---- files
SRC_DIR=$(cd "$(dirname "$0")" 2>/dev/null && pwd || echo .)
install_file() { # name, embedded function, repo fallback
    if "$2" > "$PREFIX/$1.tmp" 2>/dev/null; then mv "$PREFIX/$1.tmp" "$PREFIX/$1"
    elif [ -f "$3" ]; then rm -f "$PREFIX/$1.tmp"; cp "$3" "$PREFIX/$1"
    else rm -f "$PREFIX/$1.tmp"; die "this installer has no $1 inside it: get it from Fleet (Contractors > Get installer)"
    fi
}
mkdir -p "$PREFIX"
chmod 700 "$PREFIX"
install_file agent.js embedded_agent "$SRC_DIR/agent.js"
install_file claudeTranscript.js embedded_transcript "$SRC_DIR/../../modules/claudeTranscript.js"
say "agent installed in $PREFIX"

# ---- pairing
set -- pair --server "$SERVER" --name "$NAME" --claude "$CLAUDE_BIN"
OLDIFS=$IFS
IFS='
'
for p in $PROJECTS; do [ -n "$p" ] && set -- "$@" --project "$p"; done
IFS=$OLDIFS
if [ "$DRY" = 1 ]; then
    say "dry run: would run: node $PREFIX/agent.js $*  (pairing code asked for)"
else
    if [ -z "${FLEET_PAIR_CODE:-}" ]; then
        if [ -t 0 ]; then
            printf 'Pairing code from Fleet: '
            stty -echo 2>/dev/null || true
            read -r FLEET_PAIR_CODE
            stty echo 2>/dev/null || true
            printf '\n'
        else
            die "no terminal to ask for the pairing code: set FLEET_PAIR_CODE"
        fi
    fi
    FLEET_PAIR_CODE="$FLEET_PAIR_CODE" "$NODE_BIN" "$PREFIX/agent.js" "$@" </dev/null || die "pairing failed"
    unset FLEET_PAIR_CODE
fi

# ---- service
[ "$SERVICE" = 1 ] || { say "no service installed (--no-service): run node $PREFIX/agent.js run"; exit 0; }
UNIT_TEXT="[Unit]
Description=Fleet Contractor agent (Dreamscape Fleet)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$NODE_BIN $PREFIX/agent.js run
Restart=on-failure
RestartSec=10
Environment=PATH=$(dirname "$CLAUDE_BIN"):$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin
${FLEET_CONTRACTOR_HOME:+Environment=FLEET_CONTRACTOR_HOME=$FLEET_CONTRACTOR_HOME}
NoNewPrivileges=yes

[Install]
WantedBy=default.target
"
if [ "$DRY" = 1 ]; then
    printf '%s' "$UNIT_TEXT" > "$PREFIX/$UNIT"
    say "dry run: unit written to $PREFIX/$UNIT (not installed); would run: systemctl --user enable --now $UNIT, loginctl enable-linger $(id -un)"
    exit 0
fi
mkdir -p "$UNIT_DIR"
printf '%s' "$UNIT_TEXT" > "$UNIT_DIR/$UNIT"
systemctl --user daemon-reload
systemctl --user enable --now "$UNIT"
# keep it running with nobody logged in (asks for nothing when not allowed)
loginctl enable-linger "$(id -un)" 2>/dev/null || say "note: 'loginctl enable-linger $(id -un)' keeps the agent running after logout"
say "running: systemctl --user status $UNIT; logs: journalctl --user -u $UNIT"
