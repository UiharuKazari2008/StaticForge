#!/usr/bin/env bash
# Dreamscape setup — two host paths:
#   baremetal  Install and run the server directly on the host (default)
#   docker     Install Docker on the host, build the image, and start the container
#
# Must run as root (auto-elevates via passwordless sudo when available).
# Records the invoking user before sudo and restores ownership after setup.
#
# Usage:
#   bash scripts/setup.sh                      # bare metal (default)
#   bash scripts/setup.sh --mode docker        # Docker host path
#   sudo bash scripts/setup.sh --mode baremetal
#
# Options:
#   --mode baremetal|docker   Setup path (default: baremetal)
#   --runtime                 Container entry only: dirs + missing configs (no apt/deps/compose)
#   --skip-apt                Skip apt-get (Dockerfile image build)
#   --skip-deps               Skip pnpm install / nekoai configure
#   --skip-config             Do not create missing config from templates
#   --skip-docker             Skip Docker install (docker mode only)
#   --no-run                  Docker mode: install only, do not compose up
#   --compose-file FILE       Compose file for docker mode (default: docker-compose.yml)
#   --frozen-lockfile         Pass --frozen-lockfile to pnpm install
#   --no-node-install         Do not install Node.js when missing/outdated
#   -h, --help
#
# Environment:
#   DREAMSCAPE_SETUP_MODE       baremetal | docker (same as --mode)
#   DREAMSCAPE_SETUP_TARGET     baremetal | docker — inside container/image build
#   DREAMSCAPE_OWNER_USER       Owner for chown (auto: user before sudo)
#   DREAMSCAPE_OWNER_UID        UID for owner (auto)
#   DREAMSCAPE_APP_ROOT         Project root
#   NEKOAI_JS_SOURCE / NEKOAI_JS_PATH

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TPL="$ROOT/scripts/templates"
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/setup.sh"
ORIG_ARGS=("$@")

MODE="baremetal"
RUNTIME_ONLY=0
SKIP_APT=0
SKIP_DEPS=0
SKIP_CONFIG=0
SKIP_DOCKER=0
NO_RUN=0
FROZEN_LOCK=0
NO_NODE_INSTALL=0
COMPOSE_FILE="docker-compose.yml"

log() { echo "[setup] $*"; }
warn() { echo "[setup] WARNING: $*" >&2; }
die() { echo "[setup] ERROR: $*" >&2; exit 1; }

usage() {
    sed -n '2,34p' "$0" | sed 's/^# \?//'
    exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --mode)
            MODE="$2"
            shift 2
            ;;
        --runtime) RUNTIME_ONLY=1; shift ;;
        --skip-apt) SKIP_APT=1; shift ;;
        --skip-deps) SKIP_DEPS=1; shift ;;
        --skip-config) SKIP_CONFIG=1; shift ;;
        --skip-docker) SKIP_DOCKER=1; shift ;;
        --no-run) NO_RUN=1; shift ;;
        --compose-file) COMPOSE_FILE="$2"; shift 2 ;;
        --frozen-lockfile) FROZEN_LOCK=1; shift ;;
        --no-node-install) NO_NODE_INSTALL=1; shift ;;
        -h|--help) usage 0 ;;
        *) die "Unknown option: $1 (try --help)" ;;
    esac
done

case "$MODE" in
    baremetal|docker) ;;
    *) die "Invalid --mode '$MODE' (use baremetal or docker)" ;;
esac

if [[ -n "${DREAMSCAPE_SETUP_MODE:-}" ]]; then
    MODE="$DREAMSCAPE_SETUP_MODE"
fi

# Capture invoking user before elevation (not overwritten once set)
if [[ -z "${DREAMSCAPE_OWNER_USER:-}" ]]; then
    if [[ "$(id -u)" -eq 0 && -n "${SUDO_USER:-}" ]]; then
        DREAMSCAPE_OWNER_USER="$SUDO_USER"
        DREAMSCAPE_OWNER_UID="$(id -u "$SUDO_USER")"
    elif [[ "$(id -u)" -ne 0 ]]; then
        DREAMSCAPE_OWNER_USER="${USER:-}"
        DREAMSCAPE_OWNER_UID="$(id -u)"
    fi
fi
export DREAMSCAPE_OWNER_USER="${DREAMSCAPE_OWNER_USER:-}"
export DREAMSCAPE_OWNER_UID="${DREAMSCAPE_OWNER_UID:-}"

# Auto-elevate when passwordless sudo is available
if [[ "$(id -u)" -ne 0 ]]; then
    if sudo -n true 2>/dev/null; then
        exec sudo -n env \
            DREAMSCAPE_APP_ROOT="${DREAMSCAPE_APP_ROOT:-}" \
            DREAMSCAPE_SETUP_MODE="$MODE" \
            DREAMSCAPE_SETUP_TARGET="${DREAMSCAPE_SETUP_TARGET:-}" \
            DREAMSCAPE_OWNER_USER="${DREAMSCAPE_OWNER_USER}" \
            DREAMSCAPE_OWNER_UID="${DREAMSCAPE_OWNER_UID}" \
            NEKOAI_JS_SOURCE="${NEKOAI_JS_SOURCE:-}" \
            NEKOAI_JS_PATH="${NEKOAI_JS_PATH:-}" \
            bash "$SCRIPT_PATH" "${ORIG_ARGS[@]}"
    fi
    echo "" >&2
    echo "======================================================================" >&2
    echo "  Dreamscape setup must run as root." >&2
    echo "" >&2
    echo "  sudo bash scripts/setup.sh --mode $MODE" >&2
    echo "  # or configure passwordless sudo for your user" >&2
    echo "======================================================================" >&2
    echo "" >&2
    exit 1
fi

if [[ -n "${DREAMSCAPE_APP_ROOT:-}" ]]; then
    ROOT="$(cd "$DREAMSCAPE_APP_ROOT" && pwd)"
    TPL="$ROOT/scripts/templates"
fi

cd "$ROOT"

if [[ -n "${DREAMSCAPE_SETUP_TARGET:-}" ]]; then
    TARGET="$DREAMSCAPE_SETUP_TARGET"
elif [[ -f /.dockerenv || -f /run/.containerenv ]]; then
    TARGET=docker
else
    TARGET=baremetal
fi

OWNER_USER="${DREAMSCAPE_OWNER_USER:-}"
OWNER_UID="${DREAMSCAPE_OWNER_UID:-}"

log "mode=$MODE target=$TARGET root=$ROOT owner=${OWNER_USER:-root}"

# --- apt package groups ---
APT_BASE=(
    curl
    ca-certificates
    gnupg
    apt-transport-https
    lsb-release
    software-properties-common
)

APT_BUILD=(
    build-essential
    python3
    python-is-python3
    pkg-config
    libsqlite3-dev
    libcairo2-dev
    libpango1.0-dev
    libjpeg-dev
    libgif-dev
    librsvg2-dev
    libhunspell-dev
)

APT_RUNTIME=(
    ruby
    zstd
    git
)

apt_updated=0
apt_update_once() {
    if [[ "$apt_updated" -eq 0 ]]; then
        export DEBIAN_FRONTEND=noninteractive
        if ! apt-get update -qq 2>/dev/null; then
            warn "apt-get update failed (often a third-party repo GPG key) — retrying Ubuntu/Debian base sources only ..."
            apt-get update -qq \
                -o Dir::Etc::sourcelist=/etc/apt/sources.list \
                -o Dir::Etc::sourceparts=/dev/null \
                || die "apt-get update failed even for base sources"
        fi
        apt_updated=1
    fi
}

apt_install() {
    apt_update_once
    apt-get install -y --no-install-recommends "$@"
}

needs_host_app_install() {
    [[ "$TARGET" == baremetal && "$MODE" == baremetal ]]
}

needs_image_build_deps() {
    [[ "$TARGET" == docker ]]
}

install_apt_packages() {
    local profile="$1"
    if [[ "$SKIP_APT" -eq 1 ]]; then
        log "Skipping apt (--skip-apt)"
        return
    fi
    if ! command -v apt-get >/dev/null 2>&1; then
        warn "apt-get not found; install system packages manually"
        return
    fi

    log "Installing base apt packages ..."
    apt_install "${APT_BASE[@]}"

    if [[ "$profile" == full ]]; then
        log "Installing build apt packages (canvas, sharp, spellchecker, sqlite) ..."
        apt_install "${APT_BUILD[@]}"
        log "Installing runtime apt packages (ruby, zstd, git) ..."
        apt_install "${APT_RUNTIME[@]}"
        if command -v ruby >/dev/null 2>&1; then
            log "Ruby $(ruby --version | cut -d' ' -f1-2) OK"
        fi
    elif [[ "$profile" == docker-host ]]; then
        log "Docker-host profile: base apt only (app runs in container)"
    fi
}

node_major() {
    node -p "parseInt(process.versions.node.split('.')[0], 10)" 2>/dev/null || echo 0
}

install_node() {
    if ! needs_host_app_install; then
        return
    fi
    if command -v node >/dev/null 2>&1 && [[ "$(node_major)" -ge 20 ]]; then
        log "Node $(node -v) OK"
        return
    fi
    if [[ "$NO_NODE_INSTALL" -eq 1 ]]; then
        die "Node.js 20+ required. Install Node or remove --no-node-install"
    fi
    if [[ "$SKIP_APT" -eq 1 ]] || ! command -v apt-get >/dev/null 2>&1; then
        die "Node.js 20+ not found and apt install skipped/unavailable"
    fi
    log "Installing Node.js 20 (NodeSource) ..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt_update_once
    apt-get install -y nodejs
    hash -r
    command -v node >/dev/null 2>&1 && [[ "$(node_major)" -ge 20 ]] \
        || die "Node.js 20 install failed (got: $(node -v 2>/dev/null || echo none))"
    log "Node $(node -v) installed"
}

setup_pnpm() {
    if ! needs_host_app_install && ! needs_image_build_deps; then
        return
    fi
    if ! command -v node >/dev/null 2>&1; then
        die "node not found"
    fi

    local pnpm_ver="10.33.0"
    if [[ -f "$ROOT/package.json" ]]; then
        pnpm_ver="$(node -p "require('$ROOT/package.json').packageManager?.split('@')[1] || '10.33.0'" 2>/dev/null || echo 10.33.0)"
    fi

    if command -v pnpm >/dev/null 2>&1; then
        local installed
        installed="$(pnpm -v 2>/dev/null || true)"
        if [[ "$installed" == "$pnpm_ver" ]] || [[ "$installed" == "${pnpm_ver}"* ]]; then
            log "pnpm $installed OK"
            return
        fi
    fi

    log "Installing pnpm@${pnpm_ver} via corepack ..."
    corepack enable 2>/dev/null || true
    corepack prepare "pnpm@${pnpm_ver}" --activate 2>/dev/null || true
    if ! command -v pnpm >/dev/null 2>&1; then
        log "corepack unavailable — installing pnpm via npm ..."
        npm install -g "pnpm@${pnpm_ver}"
    fi
    hash -r
    command -v pnpm >/dev/null 2>&1 || die "pnpm install failed"
    log "pnpm $(pnpm -v)"
}

docker_compose_available() {
    docker compose version >/dev/null 2>&1
}

install_docker() {
    if [[ "$SKIP_DOCKER" -eq 1 ]]; then
        log "Skipping Docker (--skip-docker)"
        return
    fi
    if command -v docker >/dev/null 2>&1 && docker_compose_available; then
        log "Docker $(docker --version | cut -d' ' -f1-3) + Compose OK"
        return
    fi
    if [[ "$SKIP_APT" -eq 1 ]] || ! command -v apt-get >/dev/null 2>&1; then
        die "Docker not installed and apt unavailable"
    fi
    if [[ ! -f /etc/os-release ]]; then
        die "Cannot install Docker: /etc/os-release missing"
    fi

    # shellcheck source=/dev/null
    . /etc/os-release
    local distro="${ID:-}"
    local codename="${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}"

    log "Installing Docker CE + Compose plugin ..."
    install -m 0755 -d /etc/apt/keyrings
    case "$distro" in
        ubuntu|debian)
            local repo="https://download.docker.com/linux/${distro}"
            curl -fsSL "${repo}/gpg" -o /etc/apt/keyrings/docker.asc
            chmod a+r /etc/apt/keyrings/docker.asc
            echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] ${repo} ${codename} stable" \
                > /etc/apt/sources.list.d/docker.list
            ;;
        *)
            die "Unsupported distro for Docker apt repo: ${distro}"
            ;;
    esac

    apt_updated=0
    apt_update_once
    apt-get install -y --no-install-recommends \
        docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    if command -v systemctl >/dev/null 2>&1; then
        systemctl enable docker 2>/dev/null || true
        systemctl start docker 2>/dev/null || true
    fi

    hash -r
    command -v docker >/dev/null 2>&1 && docker_compose_available \
        || die "Docker install failed"
    log "Docker $(docker --version | cut -d' ' -f1-3) installed"
    docker compose version | sed 's/^/[setup] /'
}

add_owner_to_docker_group() {
    [[ -z "$OWNER_USER" || "$OWNER_USER" == root ]] && return
    id "$OWNER_USER" >/dev/null 2>&1 || return
    if groups "$OWNER_USER" | grep -q '\bdocker\b'; then
        log "User '$OWNER_USER' already in group docker"
        return
    fi
    usermod -aG docker "$OWNER_USER"
    log "Added '$OWNER_USER' to group docker (log out/in or run 'newgrp docker' before compose without sudo)"
}

finalize_apt() {
    if [[ "$SKIP_APT" -eq 1 ]] || [[ "$apt_updated" -eq 0 ]]; then
        return
    fi
    rm -rf /var/lib/apt/lists/*
}

create_directories() {
    log "Creating data directories ..."
    local dirs=(
        images .previews .cache .cache/sessions .cache/upload .cache/preview
        .cache/vibe .cache/tempDownload .cache/nax_images .cache/userFiles logs securePrompts tmp
    )
    for d in "${dirs[@]}"; do
        mkdir -p "$ROOT/$d"
    done
}

bootstrap_file() {
    local dest_name="$1"
    local tpl_name="$2"
    local dest="$ROOT/$dest_name"
    local tpl="$TPL/$tpl_name"
    if [[ -f "$dest" ]]; then
        log "  keep existing $dest_name"
        return
    fi
    if [[ ! -f "$tpl" ]]; then
        warn "  template missing: $tpl_name (skipped $dest_name)"
        return
    fi
    cp "$tpl" "$dest"
    log "  created $dest_name from template"
}

bootstrap_configs() {
    if [[ "$SKIP_CONFIG" -eq 1 ]]; then
        log "Skipping config bootstrap (--skip-config)"
        return
    fi
    log "Bootstrapping config files (only if missing) ..."
    bootstrap_file "config.json" "bootstrap-config.json"
    bootstrap_file "secure.config.json" "bootstrap-secure.config.json"
    bootstrap_file "prompt.config.json" "bootstrap-prompt.config.json"
    bootstrap_file "director.config.json" "bootstrap-director.config.json"
    bootstrap_file "characters.json" "bootstrap-characters.json"
    bootstrap_file "nax_generation_config.json" "bootstrap-nax_generation_config.json"
    bootstrap_file ".cache/workspace.json" "bootstrap-workspace.json"
    bootstrap_file ".cache/workspace-desktop.json" "bootstrap-workspace-desktop.json"
    bootstrap_file ".cache/favorites.json" "bootstrap-favorites.json"

    if [[ -f "$ROOT/config.json" ]] && grep -q 'CHANGE_ME' "$ROOT/config.json" 2>/dev/null; then
        warn "config.json has CHANGE_ME placeholders — set loginKey, PINs, and sessionSecret"
    fi
    if [[ -f "$ROOT/secure.config.json" ]] && grep -q '"apiKey": ""' "$ROOT/secure.config.json" 2>/dev/null; then
        warn "secure.config.json has empty API keys — add your NovelAI key before generating"
    fi
}

install_node_deps() {
    if [[ "$SKIP_DEPS" -eq 1 ]]; then
        log "Skipping pnpm install (--skip-deps)"
        return
    fi
    if ! needs_host_app_install && ! needs_image_build_deps; then
        return
    fi
    [[ -f "$ROOT/package.json" ]] || die "package.json not found in $ROOT"

    log "Configuring nekoai-js (NEKOAI_JS_SOURCE=${NEKOAI_JS_SOURCE:-registry}) ..."
    node "$ROOT/scripts/configure-nekoai.js"

    local pnpm_args=(install)
    [[ "$FROZEN_LOCK" -eq 1 ]] && pnpm_args+=(--frozen-lockfile)
    log "Running pnpm ${pnpm_args[*]} ..."
    (cd "$ROOT" && CI="${CI:-true}" pnpm "${pnpm_args[@]}")
    verify_geo2city
}

verify_geo2city() {
    local db size
    db="$(find "$ROOT/node_modules" -path '*/geo2city/worldcities.db' 2>/dev/null | head -1 || true)"
    size=0
    [[ -n "$db" && -f "$db" ]] && size="$(stat -c%s "$db" 2>/dev/null || stat -f%z "$db" 2>/dev/null || echo 0)"
    if [[ "$size" -lt 1000000 ]]; then
        log "geo2city worldcities.db missing or too small — running pnpm rebuild geo2city ..."
        (cd "$ROOT" && pnpm rebuild geo2city)
    else
        log "geo2city worldcities.db OK ($(numfmt --to=iec "$size" 2>/dev/null || echo "${size} bytes"))"
    fi
}

fix_ownership() {
    if [[ -z "$OWNER_USER" || "$OWNER_USER" == root ]]; then
        log "No non-root owner recorded — skipping ownership fix"
        return
    fi
    if ! id "$OWNER_USER" >/dev/null 2>&1; then
        warn "Owner user '$OWNER_USER' not found — skipping ownership fix"
        return
    fi

    log "Setting ownership of $ROOT to $OWNER_USER ..."
    chown -R "$OWNER_USER:$OWNER_USER" "$ROOT"

    local secrets=(
        config.json secure.config.json prompt.config.json director.config.json
    )
    for f in "${secrets[@]}"; do
        [[ -f "$ROOT/$f" ]] && chmod 600 "$ROOT/$f" && chown "$OWNER_USER:$OWNER_USER" "$ROOT/$f"
    done
    log "Ownership restored for $OWNER_USER"
}

run_compose_as_owner() {
    local compose_path="$ROOT/$COMPOSE_FILE"
    [[ -f "$compose_path" ]] || die "Compose file not found: $compose_path"

    log "Building and starting container ($COMPOSE_FILE) ..."
    local -a compose_cmd=(docker compose -f "$compose_path" up --build -d)

    if [[ -n "$OWNER_USER" && "$OWNER_USER" != root ]]; then
        local owner_home
        owner_home="$(getent passwd "$OWNER_USER" | cut -d: -f6)"
        [[ -n "$owner_home" ]] || owner_home="/home/$OWNER_USER"
        sudo -u "$OWNER_USER" env HOME="$owner_home" PATH="${PATH}" \
            "${compose_cmd[@]}"
    else
        "${compose_cmd[@]}"
    fi
    log "Container started — check: docker compose -f $COMPOSE_FILE ps"
}

run_baremetal_path() {
    log "=== Bare metal path: host runs node web_server.js ==="
    install_apt_packages full
    install_node
    setup_pnpm
    finalize_apt
    create_directories
    bootstrap_configs
    install_node_deps
    fix_ownership
    print_done_baremetal
}

run_docker_host_path() {
    log "=== Docker path: install Docker, build image, run container ==="
    install_apt_packages docker-host
    install_docker
    add_owner_to_docker_group
    finalize_apt
    create_directories
    bootstrap_configs
    fix_ownership

    if [[ "$NO_RUN" -eq 1 ]]; then
        log "Skipping compose up (--no-run)"
        print_done_docker_host
        return
    fi

    run_compose_as_owner
    fix_ownership
    print_done_docker_host
}

run_runtime_path() {
    log "=== Runtime path: dirs + missing configs only ==="
    create_directories
    bootstrap_configs
    log "Runtime bootstrap complete"
}

run_image_build_path() {
    log "=== Image build path (inside Dockerfile) ==="
    install_apt_packages full
    setup_pnpm
    install_node_deps
}

print_done_baremetal() {
    local port=9220
    [[ -f "$ROOT/config.json" ]] && port="$(node -p "require('$ROOT/config.json').port || 9220" 2>/dev/null || echo 9220)"
    echo ""
    log "Bare metal setup complete."
    [[ -n "$OWNER_USER" && "$OWNER_USER" != root ]] && echo "  Owner:          $OWNER_USER"
    echo "  Start server:   cd $ROOT && node web_server.js"
    echo "  URL:            http://localhost:${port}"
    echo ""
}

print_done_docker_host() {
    local port=9220
    echo ""
    log "Docker host setup complete."
    [[ -n "$OWNER_USER" && "$OWNER_USER" != root ]] && echo "  Owner:          $OWNER_USER"
    echo "  Compose file:   $COMPOSE_FILE"
    echo "  Manage:         docker compose -f $ROOT/$COMPOSE_FILE ps|logs|down"
    echo "  URL:            http://localhost:${port}"
    if [[ -n "$OWNER_USER" && "$OWNER_USER" != root ]]; then
        echo "  Note:           use 'newgrp docker' or re-login if docker permission denied"
    fi
    echo ""
}

# --- main ---
if [[ "$RUNTIME_ONLY" -eq 1 ]]; then
    run_runtime_path
elif [[ "$TARGET" == docker ]]; then
    run_image_build_path
elif [[ "$MODE" == docker ]]; then
    run_docker_host_path
else
    run_baremetal_path
fi
