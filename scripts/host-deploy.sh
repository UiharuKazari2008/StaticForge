#!/usr/bin/env bash
# Host deploy: fast-forward the live tree to one exact commit (DEPLOY_SHA) on the
# trigger remote's main, mirror it to the other forge, then apply opt-in restarts
# (restart server / push clients / restart clients).
#
# Usage:
#   bash scripts/host-deploy.sh
#   bash scripts/host-deploy.sh --dry-run
#   TRIGGER_REMOTE=Public DEPLOY_RESTART_SERVER=1 DEPLOY_REASON='...' bash scripts/host-deploy.sh
#   TRIGGER_REMOTE=origin DEPLOY_EVENT=push DEPLOY_SHA=<40-hex> bash scripts/host-deploy.sh
#
# Environment:
#   STATICFORGE_LIVE_ROOT     Live tree (default: /home/kanmi/staticforge)
#   TRIGGER_REMOTE            Public (GitHub) or origin (Yozora). Default: Public
#   MIRROR_REMOTE             Other remote (auto: origin if Public, else Public)
#   TRIGGER_REF               Branch on trigger remote (default: main)
#   DEPLOY_SHA                Exact commit to deploy (full 40-hex). Must be on
#                             TRIGGER_REMOTE/TRIGGER_REF and a descendant of (or equal
#                             to) the live HEAD. Default: tip of TRIGGER_REMOTE/TRIGGER_REF.
#                             Required when DEPLOY_EVENT=push.
#   DEPLOY_EVENT              push | workflow_dispatch | (unset = manual)
#                             push: restart flags + reason come ONLY from the deploy:*
#                             labels / title of the PR(s) merged in HEAD..DEPLOY_SHA,
#                             looked up via the Yozora API; DEPLOY_RESTART_* /
#                             DEPLOY_REASON are ignored.
#                             otherwise: flags come from the DEPLOY_* vars below.
#   DEPLOY_RESTART_SERVER     1/true to PM2 restart (dispatch / manual)
#   DEPLOY_PUSH_CLIENTS       1/true to SW notify (dispatch / manual)
#   DEPLOY_RESTART_CLIENTS    1/true to broadcast restart (dispatch / manual)
#   DEPLOY_REASON             Toast / restart dialog message (dispatch / manual; no < or >)
#   DEPLOY_PR_URL             Optional PR URL for comments / handoff (push: set from lookup)
#   DEPLOY_PR_NUMBER          Optional PR number (push: set from lookup)
#   DEPLOY_SOURCE             github | yozora (for PR comments)
#   DEPLOY_MAX_COMMITS        Max first-parent commits scanned for PRs on push (default: 200)
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
DEPLOY_EVENT="${DEPLOY_EVENT:-}"
DEPLOY_SHA="${DEPLOY_SHA:-}"
DEPLOY_MAX_COMMITS="${DEPLOY_MAX_COMMITS:-200}"
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
            sed -n '2,39p' "$0" | sed 's/^# \?//'
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
REASON=""

# Exact-SHA format check up front (ancestry is checked after fetch).
if [[ -n "$DEPLOY_SHA" && ! "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]]; then
    die "DEPLOY_SHA must be a full 40-hex lowercase commit SHA (got: $DEPLOY_SHA)"
fi

if [[ "$DEPLOY_EVENT" == "push" ]]; then
    # Push deploys take flags ONLY from merged-PR labels (resolved after fetch, below).
    # Never from env, workflow outputs, PR body or title.
    [[ -n "$DEPLOY_SHA" ]] || die "DEPLOY_EVENT=push requires DEPLOY_SHA"
    [[ "$TRIGGER_REMOTE" == "origin" ]] || die "DEPLOY_EVENT=push is only supported with TRIGGER_REMOTE=origin (Yozora)"
    if [[ -n "${DEPLOY_RESTART_SERVER:-}${DEPLOY_PUSH_CLIENTS:-}${DEPLOY_RESTART_CLIENTS:-}${DEPLOY_REASON:-}" ]]; then
        log "WARNING: DEPLOY_RESTART_*/DEPLOY_REASON ignored for push (labels only)"
    fi
    unset DEPLOY_PR_NUMBER DEPLOY_PR_URL
else
    # workflow_dispatch / manual: explicit flags from the caller.
    REASON="${DEPLOY_REASON:-}"
    if truthy "${DEPLOY_RESTART_SERVER:-0}"; then RESTART_SERVER=1; fi
    if truthy "${DEPLOY_PUSH_CLIENTS:-0}"; then PUSH_CLIENTS=1; fi
    if truthy "${DEPLOY_RESTART_CLIENTS:-0}"; then RESTART_CLIENTS=1; fi
    if [[ "$REASON" == *[\<\>]* ]]; then
        die "DEPLOY_REASON must be plain text (no < or >)"
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

# curl against the Yozora API with the token sent as a header from a process
# substitution (never on the command line / in ps). Returns 1 if no token.
yozora_curl() {
    local tok
    tok="$(yozora_token || true)"
    [[ -n "$tok" ]] || return 1
    curl -sS -m 60 -H @<(printf 'Authorization: token %s\n' "$tok") "$@"
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
        yozora_curl -X POST -H "Content-Type: application/json" \
            "$YOZORA_API/repos/$YOZORA_REPO/issues/${DEPLOY_PR_NUMBER}/comments" \
            -d "$(node -e "process.stdout.write(JSON.stringify({body:process.argv[1]}))" "$body")" >/dev/null || true
    fi
}

file_handoff_issue() {
    local title="$1"
    local body="$2"
    [[ -n "$(yozora_token || true)" ]] || { log "No YOZORA_TOKEN — skip handoff issue"; return 0; }

    # Label IDs looked up each call (do not hardcode forever — but cache this run)
    local labels_json label_ids
    labels_json="$(yozora_curl "$YOZORA_API/repos/$YOZORA_REPO/labels?limit=50")"
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
    created="$(yozora_curl -X POST -H "Content-Type: application/json" \
        "$YOZORA_API/repos/$YOZORA_REPO/issues" \
        -d "$(TITLE="$title" BODY="$body" node -e 'process.stdout.write(JSON.stringify({title:process.env.TITLE,body:process.env.BODY,assignees:["grok.cursor"]}))')")"
    local index
    index="$(echo "$created" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).number||'')}catch{console.log('')}}")"
    if [[ -n "$index" ]]; then
        yozora_curl -X PUT -H "Content-Type: application/json" \
            "$YOZORA_API/repos/$YOZORA_REPO/issues/$index/labels" \
            -d "{\"labels\":$label_ids}" >/dev/null || true
        yozora_curl -X POST -H "Content-Type: application/json" \
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
log "event=${DEPLOY_EVENT:-manual} deploy_sha=${DEPLOY_SHA:-"(trigger tip)"}"
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

# --- Exact-SHA validation -------------------------------------------------------
# Deploy exactly DEPLOY_SHA (default: trigger tip at fetch time). Refuse anything that
# is not on TRIGGER_REMOTE/TRIGGER_REF (origin/main for Yozora) or would not be a pure
# fast-forward of the live HEAD (no rollback, no side branches).
LIVE_HEAD="$(git rev-parse HEAD)"
if [[ -z "$DEPLOY_SHA" ]]; then
    DEPLOY_SHA="$TRIGGER_SHA"
    log "DEPLOY_SHA not set - using $TRIGGER_REMOTE/$TRIGGER_REF tip $DEPLOY_SHA"
fi
git cat-file -e "${DEPLOY_SHA}^{commit}" 2>/dev/null \
    || die "DEPLOY_SHA $DEPLOY_SHA is not a commit in the live repo after fetch"
git merge-base --is-ancestor "$DEPLOY_SHA" "$TRIGGER_SHA" \
    || die "DEPLOY_SHA $DEPLOY_SHA is not on $TRIGGER_REMOTE/$TRIGGER_REF ($TRIGGER_SHA) - refusing"
if [[ "$LIVE_HEAD" != "$DEPLOY_SHA" ]] && ! git merge-base --is-ancestor "$LIVE_HEAD" "$DEPLOY_SHA"; then
    if git merge-base --is-ancestor "$DEPLOY_SHA" "$LIVE_HEAD"; then
        die "DEPLOY_SHA $DEPLOY_SHA is older than live HEAD $LIVE_HEAD (already deployed past it) - refusing rollback"
    fi
    die "DEPLOY_SHA $DEPLOY_SHA is not a descendant of live HEAD $LIVE_HEAD - refusing"
fi
log "deploy_sha=$DEPLOY_SHA (on $TRIGGER_REMOTE/$TRIGGER_REF, fast-forward of $LIVE_HEAD)"

# --- Push: restart flags from merged-PR labels (API lookup, read-only) -----------
# For every first-parent commit in LIVE_HEAD..DEPLOY_SHA, ask Yozora which PR was
# merged as that commit (GET /repos/{o}/{r}/commits/{sha}/pull, Gitea >= 1.22).
# Flags = UNION of deploy:* labels across the range (Gitea 1.25 cancels older push
# runs, so an earlier PR's labels must not be lost). Reason = title of the newest
# PR that carries any deploy:* label. PR bodies are never read.
# Fails closed: any API error other than 404 aborts before the tree is touched.
resolve_push_flags() {
    local commits=() c code tmp count
    mapfile -t commits < <(git rev-list --first-parent --reverse "$LIVE_HEAD..$DEPLOY_SHA")
    count=${#commits[@]}
    log "PR lookup over $count first-parent commit(s) $LIVE_HEAD..$DEPLOY_SHA"
    if (( count == 0 )); then
        log "No new commits - no label flags (use workflow_dispatch to re-apply restarts)"
        return 0
    fi
    if (( count > DEPLOY_MAX_COMMITS )); then
        die "$count commits to deploy exceeds DEPLOY_MAX_COMMITS=$DEPLOY_MAX_COMMITS - deploy via workflow_dispatch with explicit flags"
    fi
    [[ -n "$(yozora_token || true)" ]] || die "no Yozora token ($YOZORA_TOKEN_FILE) - cannot resolve PR labels for push deploy"
    [[ -f "$PARSE_JS" ]] || die "missing $PARSE_JS"

    tmp="$(mktemp -d)"
    local prs_file="$tmp/prs.jsonl"
    : > "$prs_file"
    for c in "${commits[@]}"; do
        code="$(yozora_curl -o "$tmp/resp.json" -w '%{http_code}' -H 'Accept: application/json' \
            "$YOZORA_API/repos/$YOZORA_REPO/commits/$c/pull")" || code="curl-failed"
        case "$code" in
            200)
                COMMIT="$c" node -e '
const fs = require("fs");
const pr = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (pr && pr.merged === true && pr.merge_commit_sha === process.env.COMMIT) {
  process.stdout.write(JSON.stringify({
    number: pr.number,
    url: pr.html_url || "",
    title: typeof pr.title === "string" ? pr.title : "",
    labels: (pr.labels || []).map((l) => String(l && l.name || ""))
  }) + "\n");
}' "$tmp/resp.json" >> "$prs_file" || { rm -rf "$tmp"; die "bad PR JSON for commit $c"; }
                ;;
            404) : ;;  # direct push / non-merge commit: no PR
            *) rm -rf "$tmp"; die "PR lookup for $c failed (HTTP $code) - refusing to guess flags" ;;
        esac
    done

    local result
    result="$(PARSE_JS="$PARSE_JS" node - "$prs_file" <<'NODE'
const fs = require('fs');
const { parseDeployFlags } = require(process.env.PARSE_JS);
const prs = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const out = { restartServer: false, pushClients: false, restartClients: false, reason: '', number: '', url: '', prs: [] };
for (const pr of prs) {               // oldest -> newest
  const r = parseDeployFlags({ labels: pr.labels, title: pr.title });  // labels + title only, never body
  const any = r.restartServer || r.pushClients || r.restartClients;
  out.restartServer = out.restartServer || r.restartServer;
  out.pushClients = out.pushClients || r.pushClients;
  out.restartClients = out.restartClients || r.restartClients;
  if (any) out.reason = r.error ? '' : r.reason;   // newest flagged PR wins; drop titles with < >
  out.number = String(pr.number);
  out.url = pr.url;
  out.prs.push(`#${pr.number}[${pr.labels.filter((l) => l.startsWith('deploy:')).join(',')}]${r.error ? '(title rejected)' : ''}`);
}
process.stdout.write([
  out.restartServer ? 1 : 0, out.pushClients ? 1 : 0, out.restartClients ? 1 : 0,
  out.number, out.url, out.prs.join(' ') || '(none)', out.reason.replace(/[\r\n\t\x1f]+/g, ' ')
].map((v) => String(v).replace(/\x1f/g, ' ')).join('\x1f'));  // \x1f: non-whitespace IFS keeps empty fields
NODE
    )" || { rm -rf "$tmp"; die "failed to evaluate PR labels"; }
    rm -rf "$tmp"

    local prs_summary number url
    IFS=$'\x1f' read -r RESTART_SERVER PUSH_CLIENTS RESTART_CLIENTS number url prs_summary REASON <<<"$result"
    REASON="${REASON:-}"
    log "merged PRs in range: $prs_summary"
    if [[ -n "$number" ]]; then
        export DEPLOY_PR_NUMBER="$number" DEPLOY_PR_URL="$url"
    fi
}

if [[ "$DEPLOY_EVENT" == "push" ]]; then
    resolve_push_flags
fi
log "flags restart_server=$RESTART_SERVER push_clients=$PUSH_CLIENTS restart_clients=$RESTART_CLIENTS"
log "reason=${REASON:-"(empty)"}"

if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY-RUN: would fast-forward main $LIVE_HEAD -> $DEPLOY_SHA, push $MIRROR_REMOTE"
    log "DRY-RUN: planned verbs: toast=$([ -n "$REASON" ] && (( RESTART_SERVER+PUSH_CLIENTS+RESTART_CLIENTS > 0 )) && echo yes || echo no) restart_server=$RESTART_SERVER push_clients=$PUSH_CLIENTS restart_clients=$RESTART_CLIENTS"
    exit 0
fi

plant_agent_lock

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$CURRENT_BRANCH" == "main" ]] || die "live tree not on main (on $CURRENT_BRANCH)"

if [[ "$(git rev-parse HEAD)" != "$DEPLOY_SHA" ]]; then
    log "Fast-forwarding main to $DEPLOY_SHA ($TRIGGER_REMOTE/$TRIGGER_REF is $TRIGGER_SHA)..."
    if ! git merge --ff-only "$DEPLOY_SHA"; then
        DETAIL="git merge --ff-only failed for $DEPLOY_SHA onto $(git rev-parse HEAD).
Remotes: Public=$(git rev-parse Public/main 2>/dev/null || echo '?') origin=$(git rev-parse origin/main 2>/dev/null || echo '?')"
        cleanup_agent_lock
        PLANTED_AGENT_LOCK=0
        trap - EXIT
        handoff "merge_failed" "$DETAIL"
    fi
else
    log "Already at $DEPLOY_SHA"
fi
[[ "$(git rev-parse HEAD)" == "$DEPLOY_SHA" ]] || die "live HEAD $(git rev-parse HEAD) != DEPLOY_SHA $DEPLOY_SHA after fast-forward"

if git merge-base --is-ancestor "$DEPLOY_SHA" "$MIRROR_SHA"; then
    log "$MIRROR_REMOTE/$TRIGGER_REF ($MIRROR_SHA) already contains $DEPLOY_SHA - skip mirror push"
else
    log "Pushing $DEPLOY_SHA to $MIRROR_REMOTE/$TRIGGER_REF..."
    git push "$MIRROR_REMOTE" "$DEPLOY_SHA:refs/heads/$TRIGGER_REF"
fi

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
