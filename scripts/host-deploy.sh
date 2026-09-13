#!/usr/bin/env bash
# Host deploy: merge trigger remote into live tree, mirror to the other forge,
# then apply opt-in PR labels (restart server / push clients / restart clients).
#
# Usage:
#   bash scripts/host-deploy.sh
#   bash scripts/host-deploy.sh --dry-run
#   TRIGGER_REMOTE=Public DEPLOY_RESTART_SERVER=1 DEPLOY_REASON='...' bash scripts/host-deploy.sh
#
# Environment:
#   STATICFORGE_LIVE_ROOT     Live tree (default: /home/kanmi/staticforge)
#   TRIGGER_REMOTE            Public (GitHub) or origin (Yozora). Default: Public
#   MIRROR_REMOTE             Other remote (auto: origin if Public, else Public)
#   TRIGGER_REF               Branch on trigger remote (default: main)
#   DEPLOY_RESTART_SERVER     1/true to PM2 restart
#   DEPLOY_PUSH_CLIENTS       1/true to SW notify
#   DEPLOY_RESTART_CLIENTS    1/true to broadcast restart
#   DEPLOY_REASON             Toast / restart dialog message
#   DEPLOY_PR_URL             Optional PR URL for comments / handoff
#   DEPLOY_PR_NUMBER          Optional PR number
#   DEPLOY_SOURCE             github | yozora (for PR comments)
#   STATICFORGE_DEPLOY_ENV    Host secrets file (default: ~/.secrets/staticforge-deploy.env)
#   YOZORA_TOKEN_FILE         Default: ~/.secrets/yozora-grok.cursor.token
#   CURSOR_AGENT_ENV          Default: ~/.secrets/cursor-agent.env
#   HOST_DEPLOY_LOCK          flock path (default: /tmp/staticforge-host-deploy.lock)
#   STATICFORGE_HTTP_PORT     Readiness port (default: 9220)

set -euo pipefail

ROOT_SCRIPT="$(cd "$(dirname "$0")/.." && pwd)"
# Prefer invoking via live tree: bash /home/kanmi/staticforge/scripts/host-deploy.sh
LIVE_ROOT="${STATICFORGE_LIVE_ROOT:-/home/kanmi/staticforge}"
TRIGGER_REMOTE="${TRIGGER_REMOTE:-Public}"
TRIGGER_REF="${TRIGGER_REF:-main}"
DEPLOY_ENV_FILE="${STATICFORGE_DEPLOY_ENV:-$HOME/.secrets/staticforge-deploy.env}"
YOZORA_TOKEN_FILE="${YOZORA_TOKEN_FILE:-$HOME/.secrets/yozora-grok.cursor.token}"
CURSOR_AGENT_ENV="${CURSOR_AGENT_ENV:-$HOME/.secrets/cursor-agent.env}"
HOST_DEPLOY_LOCK="${HOST_DEPLOY_LOCK:-/tmp/staticforge-host-deploy.lock}"
HTTP_PORT="${STATICFORGE_HTTP_PORT:-9220}"
YOZORA_API="${YOZORA_API:-https://yozora.bluesteel.737.jp.net/api/v1}"
YOZORA_REPO="${YOZORA_REPO:-DreamScape/StaticForge}"
AGENT_LOCK_NAME=".agent-host-deploy"
# Always use scripts from the live tree (never Actions checkout).
PARSE_JS="$LIVE_ROOT/scripts/ci/parse-deploy-flags.js"

DRY_RUN=0
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        -h|--help)
            sed -n '2,28p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            echo "[host-deploy] ERROR: unknown option: $arg" >&2
            exit 2
            ;;
    esac
done

log() { echo "[host-deploy] $*"; }
die() { echo "[host-deploy] ERROR: $*" >&2; exit 1; }

truthy() {
    case "${1:-}" in
        1|true|TRUE|yes|YES|on|ON) return 0 ;;
        *) return 1 ;;
    esac
}

if [[ "$TRIGGER_REMOTE" == "Public" ]]; then
    MIRROR_REMOTE="${MIRROR_REMOTE:-origin}"
elif [[ "$TRIGGER_REMOTE" == "origin" ]]; then
    MIRROR_REMOTE="${MIRROR_REMOTE:-Public}"
else
    die "TRIGGER_REMOTE must be Public or origin (got: $TRIGGER_REMOTE)"
fi

# shellcheck disable=SC1090
[[ -f "$DEPLOY_ENV_FILE" ]] && source "$DEPLOY_ENV_FILE" || true

RESTART_SERVER=0
PUSH_CLIENTS=0
RESTART_CLIENTS=0
REASON="${DEPLOY_REASON:-}"

if truthy "${DEPLOY_RESTART_SERVER:-0}"; then RESTART_SERVER=1; fi
if truthy "${DEPLOY_PUSH_CLIENTS:-0}"; then PUSH_CLIENTS=1; fi
if truthy "${DEPLOY_RESTART_CLIENTS:-0}"; then RESTART_CLIENTS=1; fi

# If labels/body/title were passed via env, re-parse (overrides DEPLOY_* bools except explicit DEPLOY_REASON).
if [[ -n "${DEPLOY_LABELS:-}" || -n "${DEPLOY_PR_BODY:-}" || -n "${DEPLOY_PR_TITLE:-}" ]]; then
    [[ -f "$PARSE_JS" ]] || die "missing $PARSE_JS"
    PARSED="$(
        PARSE_JS="$PARSE_JS" \
        DEPLOY_LABELS="${DEPLOY_LABELS:-}" \
        DEPLOY_PR_BODY="${DEPLOY_PR_BODY:-}" \
        DEPLOY_PR_TITLE="${DEPLOY_PR_TITLE:-}" \
        node - <<'NODE'
const { parseDeployFlags } = require(process.env.PARSE_JS);
let labels = process.env.DEPLOY_LABELS || '';
try { const j = JSON.parse(labels); if (Array.isArray(j)) labels = j; } catch (_) {}
const r = parseDeployFlags({
    labels,
    body: process.env.DEPLOY_PR_BODY || '',
    title: process.env.DEPLOY_PR_TITLE || ''
});
if (r.error) {
    console.error(r.error);
    process.exit(1);
}
process.stdout.write(JSON.stringify(r));
NODE
    )" || die "failed to parse deploy flags"
    RESTART_SERVER="$(node -e "const r=JSON.parse(process.argv[1]); process.stdout.write(r.restartServer?'1':'0')" "$PARSED")"
    PUSH_CLIENTS="$(node -e "const r=JSON.parse(process.argv[1]); process.stdout.write(r.pushClients?'1':'0')" "$PARSED")"
    RESTART_CLIENTS="$(node -e "const r=JSON.parse(process.argv[1]); process.stdout.write(r.restartClients?'1':'0')" "$PARSED")"
    if [[ -z "${DEPLOY_REASON:-}" ]]; then
        REASON="$(node -e "const r=JSON.parse(process.argv[1]); process.stdout.write(r.reason||'')" "$PARSED")"
    fi
fi

cd "$LIVE_ROOT" || die "cannot cd to LIVE_ROOT=$LIVE_ROOT"

exec 9>"$HOST_DEPLOY_LOCK"
if ! flock -n 9; then
    die "another host-deploy holds $HOST_DEPLOY_LOCK"
fi

cleanup_agent_lock() {
    rm -f "$LIVE_ROOT/$AGENT_LOCK_NAME"
}
PLANTED_AGENT_LOCK=0

plant_agent_lock() {
    printf 'agent: host-deploy\nstarted: %s\nintent: host-deploy merge+flags\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        > "$LIVE_ROOT/$AGENT_LOCK_NAME"
    PLANTED_AGENT_LOCK=1
    trap 'cleanup_agent_lock' EXIT
}

foreign_agent_locks() {
    # Prints paths of .agent-* other than our own
    local f
    shopt -s nullglob
    for f in "$LIVE_ROOT"/.agent-*; do
        [[ "$(basename "$f")" == "$AGENT_LOCK_NAME" ]] && continue
        printf '%s\n' "$f"
    done
    shopt -u nullglob
}

yozora_token() {
    if [[ -n "${YOZORA_TOKEN:-}" ]]; then
        printf '%s' "$YOZORA_TOKEN"
        return
    fi
    [[ -f "$YOZORA_TOKEN_FILE" ]] || return 1
    tr -d '\n' < "$YOZORA_TOKEN_FILE"
}

comment_on_pr() {
    local body="$1"
    [[ -n "${DEPLOY_PR_NUMBER:-}" ]] || return 0
    local source="${DEPLOY_SOURCE:-}"
    if [[ "$source" == "github" || ( -z "$source" && "$TRIGGER_REMOTE" == "Public" ) ]]; then
        if command -v gh >/dev/null 2>&1; then
            gh pr comment "${DEPLOY_PR_NUMBER}" --repo "${GITHUB_REPO:-UiharuKazari2008/StaticForge}" --body "$body" || true
        fi
    fi
    if [[ "$source" == "yozora" || ( -z "$source" && "$TRIGGER_REMOTE" == "origin" ) || "$source" == "both" ]]; then
        local tok
        tok="$(yozora_token || true)"
        if [[ -n "$tok" ]]; then
            curl -sS -X POST -H "Authorization: token $tok" -H "Content-Type: application/json" \
                "$YOZORA_API/repos/$YOZORA_REPO/issues/${DEPLOY_PR_NUMBER}/comments" \
                -d "$(node -e "process.stdout.write(JSON.stringify({body:process.argv[1]}))" "$body")" >/dev/null || true
        fi
    fi
}

file_handoff_issue() {
    local title="$1"
    local body="$2"
    local tok
    tok="$(yozora_token || true)"
    [[ -n "$tok" ]] || { log "No YOZORA_TOKEN — skip handoff issue"; return 0; }

    # Label IDs looked up each call (do not hardcode forever — but cache this run)
    local labels_json label_ids
    labels_json="$(curl -sS -H "Authorization: token $tok" "$YOZORA_API/repos/$YOZORA_REPO/labels?limit=50")"
    label_ids="$(LABELS_JSON="$labels_json" node - <<'NODE'
const labels = JSON.parse(process.env.LABELS_JSON || '[]');
const want = ['type:infra', 'cursor-agent', 'status:ready'];
const ids = [];
for (const name of want) {
  const hit = labels.find((l) => l.name === name);
  if (hit) ids.push(hit.id);
}
process.stdout.write(JSON.stringify(ids));
NODE
)"
    local created
    created="$(curl -sS -X POST -H "Authorization: token $tok" -H "Content-Type: application/json" \
        "$YOZORA_API/repos/$YOZORA_REPO/issues" \
        -d "$(TITLE="$title" BODY="$body" node -e 'process.stdout.write(JSON.stringify({title:process.env.TITLE,body:process.env.BODY,assignees:["grok.cursor"]}))')")"
    local index
    index="$(echo "$created" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).number||'')}catch{console.log('')}}")"
    if [[ -n "$index" ]]; then
        curl -sS -X PUT -H "Authorization: token $tok" -H "Content-Type: application/json" \
            "$YOZORA_API/repos/$YOZORA_REPO/issues/$index/labels" \
            -d "{\"labels\":$label_ids}" >/dev/null || true
        curl -sS -X POST -H "Authorization: token $tok" -H "Content-Type: application/json" \
            "$YOZORA_API/repos/$YOZORA_REPO/issues/$index/comments" \
            -d '{"body":"@grok.rook please card. Host-deploy handoff — Cursor worker started (or attempted)."}' >/dev/null || true
        log "Handoff issue #$index"
        echo "$index"
    fi
}

start_cursor_worker() {
    local reason_kind="$1"
    local detail="$2"
    local prompt
    prompt=$(cat <<EOF
Host-deploy handoff on $LIVE_ROOT.

Kind: $reason_kind
Detail:
$detail

PR: ${DEPLOY_PR_URL:-none} (#${DEPLOY_PR_NUMBER:-?})
Trigger remote: $TRIGGER_REMOTE / $TRIGGER_REF
Mirror remote: $MIRROR_REMOTE

Rules:
- Auth / ship comments as grok.cursor when using Yozora. credit: grok.menma on ships.
- Do NOT stash. Do NOT git restore / checkout dirty files to peel commits.
- Do NOT force-push main.
- Do NOT delete another agent's .agent-* lock.
- After the tree is clear and remotes reconciled, re-run:
  TRIGGER_REMOTE=$TRIGGER_REMOTE bash scripts/host-deploy.sh
  (with the same DEPLOY_* flags if known) OR leave a Done comment explaining blockers.
- Stay off greg / unapproved ui-review.
EOF
)
    local log_dir="$LIVE_ROOT/logs"
    mkdir -p "$log_dir"
    local log_file="$log_dir/host-deploy-handoff-$(date -u +%Y%m%dT%H%M%SZ).log"

    if [[ "$DRY_RUN" -eq 1 ]]; then
        log "DRY-RUN: would start Cursor worker ($reason_kind) → $log_file"
        printf '%s\n' "$prompt" | sed 's/^/  | /'
        return 0
    fi

    if [[ -f "$CURSOR_AGENT_ENV" ]]; then
        # shellcheck disable=SC1090
        set -a
        # shellcheck disable=SC1090
        source "$CURSOR_AGENT_ENV"
        set +a
    fi

    if ! command -v agent >/dev/null 2>&1; then
        log "WARNING: agent CLI not found — handoff issue only"
        return 0
    fi

    # Detached persist session so CI can exit
    nohup agent persist --trust --workspace "$LIVE_ROOT" --force "$prompt" \
        >"$log_file" 2>&1 &
    local pid=$!
    log "Started Cursor worker pid=$pid log=$log_file kind=$reason_kind"
}

handoff() {
    local kind="$1"
    local detail="$2"
    local title="[Deploy handoff] $kind"
    local body
    body=$(cat <<EOF
## Host-deploy blocked: $kind

$detail

- Live root: \`$LIVE_ROOT\`
- Trigger: \`$TRIGGER_REMOTE/$TRIGGER_REF\`
- Mirror: \`$MIRROR_REMOTE\`
- PR: ${DEPLOY_PR_URL:-n/a}

Cursor worker was started (or attempted) to clear this. No stash / no force-push / do not delete foreign \`.agent-*\` locks.

Parent: host CI deploy (#191 if still open).
EOF
)
    comment_on_pr "**Host-deploy blocked ($kind)**

$detail

A Cursor worker was started to clear this. Deploy did not merge or restart."
    file_handoff_issue "$title" "$body" >/dev/null || true
    start_cursor_worker "$kind" "$detail"
    exit 0
}

# --- dry-run summary helpers ---
HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"

log "LIVE_ROOT=$LIVE_ROOT"
log "TRIGGER=$TRIGGER_REMOTE/$TRIGGER_REF MIRROR=$MIRROR_REMOTE"
log "flags restart_server=$RESTART_SERVER push_clients=$PUSH_CLIENTS restart_clients=$RESTART_CLIENTS"
log "reason=${REASON:-"(empty)"}"
log "HEAD=$HEAD_SHA dry_run=$DRY_RUN"

# Safety: foreign agent locks
mapfile -t FOREIGN_LOCKS < <(foreign_agent_locks || true)
if ((${#FOREIGN_LOCKS[@]} > 0)); then
    DETAIL="Foreign agent lock(s) present:\n"
    for f in "${FOREIGN_LOCKS[@]}"; do
        DETAIL+="- $f mtime=$(stat -c %y "$f" 2>/dev/null || echo '?')\n"
        DETAIL+="  $(tr '\n' ' ' < "$f" 2>/dev/null || true)\n"
    done
    DETAIL=$(printf '%b' "$DETAIL")
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log "DRY-RUN: would handoff agent_lock"
        printf '%s\n' "$DETAIL" | sed 's/^/  | /'
        start_cursor_worker "agent_lock" "$DETAIL"
        exit 0
    fi
    handoff "agent_lock" "$DETAIL"
fi

# Safety: dirty tree
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
    DETAIL="$(git status --porcelain; echo '---'; git diff --stat || true)"
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log "DRY-RUN: would handoff dirty_tree"
        printf '%s\n' "$DETAIL" | sed 's/^/  | /'
        start_cursor_worker "dirty_tree" "$DETAIL"
        exit 0
    fi
    handoff "dirty_tree" "$DETAIL"
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY-RUN: fetch $TRIGGER_REMOTE $MIRROR_REMOTE (read-only probe)"
fi

git fetch "$TRIGGER_REMOTE" "$TRIGGER_REF" || die "fetch $TRIGGER_REMOTE failed"
git fetch "$MIRROR_REMOTE" "$TRIGGER_REF" || die "fetch $MIRROR_REMOTE failed"

TRIGGER_SHA="$(git rev-parse "$TRIGGER_REMOTE/$TRIGGER_REF")"
MIRROR_SHA="$(git rev-parse "$MIRROR_REMOTE/$TRIGGER_REF")"
log "trigger_sha=$TRIGGER_SHA mirror_sha=$MIRROR_SHA"

# Is mirror ahead of trigger? (commits in mirror not in trigger)
MIRROR_AHEAD="$(git rev-list --count "$TRIGGER_SHA..$MIRROR_SHA" 2>/dev/null || echo 0)"
TRIGGER_AHEAD="$(git rev-list --count "$MIRROR_SHA..$TRIGGER_SHA" 2>/dev/null || echo 0)"
log "mirror_ahead=$MIRROR_AHEAD trigger_ahead=$TRIGGER_AHEAD"

if [[ "$MIRROR_AHEAD" != "0" ]]; then
    DETAIL="Mirror remote $MIRROR_REMOTE/$TRIGGER_REF is ahead of or diverged from $TRIGGER_REMOTE/$TRIGGER_REF.
trigger_sha=$TRIGGER_SHA
mirror_sha=$MIRROR_SHA
mirror_ahead_commits=$MIRROR_AHEAD
trigger_ahead_commits=$TRIGGER_AHEAD
Reconcile Public/main and origin/main, then re-run host-deploy."
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log "DRY-RUN: would handoff remote_ahead"
        printf '%s\n' "$DETAIL" | sed 's/^/  | /'
        start_cursor_worker "remote_ahead" "$DETAIL"
        exit 0
    fi
    handoff "remote_ahead" "$DETAIL"
fi

# Local main should be able to fast-forward/merge trigger
LOCAL_AHEAD_OF_TRIGGER="$(git rev-list --count "$TRIGGER_SHA..HEAD" 2>/dev/null || echo 0)"
if [[ "$LOCAL_AHEAD_OF_TRIGGER" != "0" ]]; then
    # Local has commits not in trigger — treat as conflict unless they are already mirrored weirdly
    DETAIL="Live HEAD has $LOCAL_AHEAD_OF_TRIGGER commit(s) not in $TRIGGER_REMOTE/$TRIGGER_REF.
HEAD=$(git rev-parse HEAD)
trigger_sha=$TRIGGER_SHA
Do not stash. Reconcile or park local commits, then re-run."
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log "DRY-RUN: would handoff local_ahead"
        printf '%s\n' "$DETAIL" | sed 's/^/  | /'
        start_cursor_worker "local_ahead" "$DETAIL"
        exit 0
    fi
    handoff "local_ahead" "$DETAIL"
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY-RUN: would merge $TRIGGER_SHA into main, push $MIRROR_REMOTE"
    log "DRY-RUN: planned verbs: toast=$([ -n "$REASON" ] && (( RESTART_SERVER+PUSH_CLIENTS+RESTART_CLIENTS > 0 )) && echo yes || echo no) restart_server=$RESTART_SERVER push_clients=$PUSH_CLIENTS restart_clients=$RESTART_CLIENTS"
    exit 0
fi

plant_agent_lock

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$CURRENT_BRANCH" == "main" ]] || die "live tree not on main (on $CURRENT_BRANCH)"

if [[ "$(git rev-parse HEAD)" != "$TRIGGER_SHA" ]]; then
    log "Merging $TRIGGER_REMOTE/$TRIGGER_REF ($TRIGGER_SHA) into main..."
    if ! git merge --ff-only "$TRIGGER_SHA"; then
        DETAIL="git merge --ff-only failed for $TRIGGER_SHA onto $(git rev-parse HEAD).
Remotes: Public=$(git rev-parse Public/main 2>/dev/null || echo '?') origin=$(git rev-parse origin/main 2>/dev/null || echo '?')"
        cleanup_agent_lock
        PLANTED_AGENT_LOCK=0
        trap - EXIT
        handoff "merge_failed" "$DETAIL"
    fi
else
    log "Already at trigger SHA"
fi

log "Pushing $(git rev-parse HEAD) to $MIRROR_REMOTE/$TRIGGER_REF..."
git push "$MIRROR_REMOTE" "HEAD:refs/heads/$TRIGGER_REF"

broadcast_notice() {
    local message="$1"
    local restart="${2:-false}"
    local title="${3:-Deploy}"
    local port="$HTTP_PORT"
    local key="${STATICFORGE_APP_KEY:-${DEPLOY_APP_KEY:-}}"
    local dev_key="${STATICFORGE_DEV_LOGIN_KEY:-${DEPLOY_DEV_LOGIN_KEY:-}}"

    if [[ -z "$message" ]]; then
        log "Skip broadcast — empty message"
        return 0
    fi

    local auth_args=()
    if [[ -n "$key" ]]; then
        auth_args=(-H "X-StaticForge-App-Key: $key" -H "Authorization: Bearer $key")
    elif [[ -n "$dev_key" ]]; then
        auth_args=(-H "Authorization: Bearer $dev_key")
    else
        log "WARNING: no STATICFORGE_APP_KEY / DEPLOY_DEV_LOGIN_KEY — skip broadcast"
        return 0
    fi

    local body
    if [[ "$restart" == "true" ]]; then
        body="$(MESSAGE="$message" TITLE="$title" node -e 'process.stdout.write(JSON.stringify({message:process.env.MESSAGE,title:process.env.TITLE,level:"info",restart:true}))')"
    else
        body="$(MESSAGE="$message" TITLE="$title" node -e 'process.stdout.write(JSON.stringify({message:process.env.MESSAGE,title:process.env.TITLE,level:"info",display:"toast"}))')"
    fi

    curl -sS -X POST "http://127.0.0.1:${port}/agent/broadcast" \
        -H "Content-Type: application/json" \
        "${auth_args[@]}" \
        -d "$body" || log "WARNING: broadcast failed"
}

DID_RESTART_WITH_NOTIFY=0

# Toast when reason set and any deploy label
if [[ -n "$REASON" ]] && (( RESTART_SERVER + PUSH_CLIENTS + RESTART_CLIENTS > 0 )); then
    # Defer restart-client dialog; toast first only when not restarting clients alone
    if (( RESTART_CLIENTS == 0 )); then
        log "Broadcasting deploy toast..."
        broadcast_notice "$REASON" "false" "Deploy"
    fi
fi

if (( RESTART_SERVER == 1 )); then
    if (( PUSH_CLIENTS == 1 )); then
        log "PM2 restart + SW notify..."
        bash "$LIVE_ROOT/scripts/notify-service-worker-update.sh" --restart
        DID_RESTART_WITH_NOTIFY=1
    else
        log "PM2 restart (./restart)..."
        # ./restart tails logs forever — run the pm2 steps only
        pm2 flush Dreamscape || true
        pm2 restart ecosystem.config.js --update-env
        pm2 reset Dreamscape || true
        # Wait ready
        STATICFORGE_HTTP_PORT="$HTTP_PORT" STATICFORGE_SERVER_WAIT_TIMEOUT_MS="${STATICFORGE_SERVER_WAIT_TIMEOUT_MS:-180000}" \
        node - <<'NODE'
const http = require('http');
const port = Number(process.env.STATICFORGE_HTTP_PORT || 9220);
const deadline = Date.now() + Number(process.env.STATICFORGE_SERVER_WAIT_TIMEOUT_MS || 180000);
function probe() {
  const req = http.request({ hostname: '127.0.0.1', port, path: '/status', method: 'OPTIONS' }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => {
      try {
        const status = JSON.parse(body);
        if (status.isReady === true && status.runtimeCompileComplete === true) process.exit(0);
      } catch (_) {}
      if (Date.now() >= deadline) process.exit(1);
      setTimeout(probe, 1000);
    });
  });
  req.on('error', () => {
    if (Date.now() >= deadline) process.exit(1);
    setTimeout(probe, 1000);
  });
  req.end();
}
probe();
NODE
    fi
fi

if (( PUSH_CLIENTS == 1 && DID_RESTART_WITH_NOTIFY == 0 )); then
    log "SW notify (no server restart)..."
    bash "$LIVE_ROOT/scripts/notify-service-worker-update.sh"
fi

if (( RESTART_CLIENTS == 1 )); then
    MSG="${REASON:-Deploy: client restart requested}"
    log "Broadcasting client restart..."
    broadcast_notice "$MSG" "true" "Deploy"
elif [[ -n "$REASON" ]] && (( RESTART_SERVER + PUSH_CLIENTS > 0 )); then
    : # toast already sent
fi

comment_on_pr "**Host-deploy complete**
- SHA: \`$(git rev-parse --short HEAD)\`
- Trigger: \`$TRIGGER_REMOTE\` → mirror \`$MIRROR_REMOTE\`
- restart_server=$RESTART_SERVER push_clients=$PUSH_CLIENTS restart_clients=$RESTART_CLIENTS
- reason: ${REASON:-"(none)"}"

log "Done HEAD=$(git rev-parse --short HEAD)"
