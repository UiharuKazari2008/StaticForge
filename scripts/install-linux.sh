#!/usr/bin/env bash
# Dreamscape (StaticForge) — non-interactive, idempotent Linux install.
#
# Tested on a fresh ubuntu:24.04 (see scripts/ci/clean-install-test.sh). Debian/Ubuntu (apt) only.
# Safe to re-run: apt/node/pnpm steps are skipped when already satisfied, and existing config
# files are never overwritten (missing keys such as sessionSecret are added).
#
# Usage (from the repo root):
#   sudo bash scripts/install-linux.sh                 # deps + node_modules + config
#   sudo bash scripts/install-linux.sh --with-service  # also register a pm2 (or systemd) service
#
# Options:
#   --with-service        After install, run Dreamscape under pm2 (ecosystem.config.js) and,
#                         when systemd is PID 1, enable pm2 startup on boot. Needs systemd for boot.
#   --service-user USER   User that owns/runs the app (default: $SUDO_USER or current user)
#   --skip-apt            Do not install apt packages (you provide them)
#   --port N              Port written to a NEW config.json (default 9220)
#   -h, --help
#
# Environment: NEKOAI_JS_SOURCE=registry|local (default registry), NODE_MAJOR (default 20).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WITH_SERVICE=0; SKIP_APT=0; PORT=9220
SERVICE_USER="${SUDO_USER:-$(id -un)}"
NODE_MAJOR="${NODE_MAJOR:-20}"

log()  { echo "[install] $*"; }
warn() { echo "[install] WARNING: $*" >&2; }
die()  { echo "[install] ERROR: $*" >&2; exit 1; }
usage(){ sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-service) WITH_SERVICE=1; shift ;;
    --service-user) SERVICE_USER="$2"; shift 2 ;;
    --skip-apt) SKIP_APT=1; shift ;;
    --port) PORT="$2"; shift 2 ;;
    -h|--help) usage 0 ;;
    *) die "unknown option $1 (try --help)" ;;
  esac
done

export DEBIAN_FRONTEND=noninteractive COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI="${CI:-true}"
SUDO=""
if [[ $(id -u) -ne 0 ]]; then
  command -v sudo >/dev/null || die "run as root or install sudo"
  SUDO="sudo -n"
fi

# ---- 1. apt packages (README never listed these; see docs/CLEAN_INSTALL.md) ----
APT_PKGS=(
  curl ca-certificates gnupg git zstd
  build-essential python3 python-is-python3 pkg-config
  libsqlite3-dev libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
  libhunspell-dev ruby
)
if [[ $SKIP_APT -eq 0 ]]; then
  command -v apt-get >/dev/null || die "apt-get not found (Debian/Ubuntu only); use --skip-apt"
  missing=()
  for p in "${APT_PKGS[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p"); done
  if [[ ${#missing[@]} -gt 0 ]]; then
    log "apt install: ${missing[*]}"
    $SUDO apt-get update -qq
    $SUDO apt-get install -y -qq --no-install-recommends "${missing[@]}"
  else
    log "apt packages already present"
  fi
fi

# ---- 2. Node.js >= NODE_MAJOR ----
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if command -v node >/dev/null && [[ $(node_major) -ge $NODE_MAJOR ]]; then
  log "node $(node -v) OK"
else
  log "installing Node.js ${NODE_MAJOR}.x (NodeSource)"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | $SUDO bash - >/dev/null
  $SUDO apt-get install -y -qq nodejs
  [[ $(node_major) -ge $NODE_MAJOR ]] || die "node install failed"
fi

# ---- 3. pnpm pinned by package.json packageManager (via corepack) ----
PNPM_VER="$(node -p "(require('$ROOT/package.json').packageManager||'pnpm@10.33.0').split('@')[1]")"
if command -v pnpm >/dev/null && [[ "$(pnpm -v 2>/dev/null)" == "$PNPM_VER" ]]; then
  log "pnpm $PNPM_VER OK"
else
  log "enabling pnpm@$PNPM_VER via corepack"
  $SUDO corepack enable
  (cd "$ROOT" && corepack prepare "pnpm@$PNPM_VER" --activate >/dev/null)
  [[ "$(cd "$ROOT" && pnpm -v)" == "$PNPM_VER" ]] || die "pnpm $PNPM_VER not active"
fi

# ---- 4. node_modules ----
cd "$ROOT"
# package.json ships nekoai-js as file:../NekoAI-JS (dev checkout); switch to the registry build.
node scripts/configure-nekoai.js
# The lockfile pins the file: spec, so a frozen install always fails on a fresh clone.
log "pnpm install"
pnpm install --no-frozen-lockfile --reporter=append-only 2>&1 | grep -vE '^Progress' || die "pnpm install failed"

db="$(find node_modules/.pnpm -path '*/geo2city/worldcities.db' 2>/dev/null | head -1 || true)"
if [[ -z "$db" || $(stat -c%s "$db" 2>/dev/null || echo 0) -lt 1000000 ]]; then
  log "geo2city db missing — pnpm rebuild geo2city"; pnpm rebuild geo2city
fi
bad=()
for m in better-sqlite3 sqlite3 canvas sharp spellchecker geo2city; do
  node -e "require('$m')" >/dev/null 2>&1 || bad+=("$m")
done
[[ ${#bad[@]} -eq 0 ]] || die "native modules failed to load: ${bad[*]} (check apt build deps)"
log "native modules OK"

# ---- 5. config (create only if missing; never overwrite) ----
mkdir -p .cache data logs
rand() { node -e "process.stdout.write(require('crypto').randomBytes($1).toString('hex'))"; }
if [[ ! -f config.json ]]; then
  log "creating config.json (random loginKey / PINs — change them)"
  LK=$(rand 16) PORT="$PORT" node -e '
    const pin=()=>String(require("crypto").randomInt(100000,999999));
    require("fs").writeFileSync("config.json", JSON.stringify({port:+process.env.PORT,loginKey:process.env.LK,loginPin:pin(),readOnlyPin:pin()},null,2)+"\n",{mode:0o600});'
fi
if [[ ! -f secure.config.json ]]; then
  log "creating secure.config.json from template"
  cp scripts/templates/bootstrap-secure.json secure.config.json; chmod 600 secure.config.json
fi
# web_server.js refuses to start without sessionSecret; the template never had one.
node -e '
  const f="./secure.config.json",fs=require("fs"),s=JSON.parse(fs.readFileSync(f));
  if(!s.sessionSecret){s.sessionSecret=require("crypto").randomBytes(32).toString("hex");
    fs.writeFileSync(f,JSON.stringify(s,null,2)+"\n");console.log("[install] added sessionSecret");}'
for pair in characters.json:bootstrap-characters.json .cache/workspace.json:bootstrap-workspace.json \
            .cache/workspace-desktop.json:bootstrap-workspace-desktop.json .cache/favorites.json:bootstrap-favorites.json; do
  d=${pair%%:*}; t=scripts/templates/${pair#*:}
  [[ -f "$d" || ! -f "$t" ]] || { cp "$t" "$d"; log "created $d"; }
done
grep -q '"apiKey": ""' secure.config.json && warn "secure.config.json has no NovelAI key — add one before generating"

if [[ $(id -u) -eq 0 && "$SERVICE_USER" != root ]] && id "$SERVICE_USER" >/dev/null 2>&1; then
  chown -R "$SERVICE_USER:" "$ROOT"
fi

# ---- 6. optional service ----
if [[ $WITH_SERVICE -eq 1 ]]; then
  log "service: pm2 (ecosystem.config.js) as $SERVICE_USER"
  run_as() { if [[ "$(id -un)" == "$SERVICE_USER" ]]; then bash -c "$*"; else sudo -u "$SERVICE_USER" -H bash -c "$*"; fi; }
  PM2="$ROOT/node_modules/.bin/pm2"
  run_as "cd '$ROOT' && '$PM2' startOrReload ecosystem.config.js && '$PM2' save"
  if [[ -d /run/systemd/system ]]; then
    home=$(getent passwd "$SERVICE_USER" | cut -d: -f6)
    $SUDO env PATH="$PATH" "$PM2" startup systemd -u "$SERVICE_USER" --hp "$home"
    log "pm2 startup unit installed (pm2-$SERVICE_USER)"
  else
    warn "systemd not running — pm2 is up now but will not start on boot"
  fi
fi

log "done. Start: cd $ROOT && node web_server.js   (port $(node -p 'require("./config.json").port||9220'))"
