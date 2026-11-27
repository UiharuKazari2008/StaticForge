#!/usr/bin/env bash
# Data seed of the live Dreamscape for Rack Manager replicas (docs/rack-manager/replicas.md). Runs on Dreamscape; read-only on the
# live tree: SQLite files go through `sqlite3 .backup` (consistent, WAL-safe) into a staging dir, plain files are rsynced as they are,
# then everything is rsynced over `ssh fat-misaka` to /srv/rack/replicas/seeds/<id>/ on the host.
#
#   bash scripts/rack/seed-replica.sh [--id ID] [--host SSH_ALIAS] [--images N] [--keys] [--stage DIR]
#     --id ID      seed id (default seed-YYYYMMDD-HHMMSS)
#     --images N   newest N pictures from images/ (default 25; 0 = none)
#     --keys       also store the NovelAI keys in the seed's .secret/ (copied into a replica only by create keys:'copy')
#
# Left out on purpose: secrets (.cache/secrets, secure.config.json, application_auth.db, account tokens, Claude account dirs), phones
# (activesync.db), private mail/messages/chat (dovecote, mailaccounts, textmessaging, chat, knowledge_memory), Director and telemetry
# databases, metadata.db and the other databases that follow the gallery (the replica rebuilds them), upload/trace/cache folders.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ID="seed-$(date +%Y%m%d-%H%M%S)"; HOST=fat-misaka; IMAGES=25; KEYS=0; STAGE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --id) ID="$2"; shift 2 ;; --host) HOST="$2"; shift 2 ;; --images) IMAGES="$2"; shift 2 ;;
    --keys) KEYS=1; shift ;; --stage) STAGE="$2"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac
done
[[ "$ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$ ]] || { echo "bad --id" >&2; exit 1; }
command -v sqlite3 >/dev/null || { echo "sqlite3 is required" >&2; exit 1; }
STAGE="${STAGE:-/var/tmp/seed-stage-$ID}"
t0=$(date +%s)
rm -rf "$STAGE"; mkdir -p "$STAGE/.cache" "$STAGE/data"
trap 'rm -rf "$STAGE"' EXIT
cd "$ROOT"

# SQLite databases a replica starts with (small or needed for tag search / characters); `.backup` is a consistent copy while live
DBS=(tag_search.db nax_tags.db tag_wiki.db characters.db generation_quips.db emphasis_segment_index.db)
for db in "${DBS[@]}"; do
  [[ -f ".cache/$db" ]] || { echo "skip .cache/$db (absent)"; continue; }
  sqlite3 -readonly ".cache/$db" ".backup '$STAGE/.cache/$db'"
done
# plain state files (desktop layout, favorites, custom words) and the non-secret config files
for f in .cache/workspace.json .cache/workspace-desktop.json .cache/favorites.json .cache/customWords.json; do
  if [[ -f "$f" ]]; then cp -p "$f" "$STAGE/$f"; fi
done
for f in config.json prompt.config.json director.config.json characters.json nax_generation_config.json; do
  if [[ -f "$f" ]]; then cp -p "$f" "$STAGE/$f"; fi
done
# newest pictures only
if [[ "$IMAGES" -gt 0 && -d images ]]; then
  mkdir -p "$STAGE/images"
  # (a closed pipe makes ls/grep exit non-zero under pipefail: that is expected here)
  { ls -1t images 2>/dev/null | grep -E '\.(png|jxl|webp)$' | head -n "$IMAGES" | while read -r f; do cp -p "images/$f" "$STAGE/images/$f"; done; } || true
fi
# NovelAI keys only on request
if [[ "$KEYS" -eq 1 ]]; then
  mkdir -p "$STAGE/.secret"
  node -e '
    const s = JSON.parse(require("fs").readFileSync("secure.config.json", "utf8"));
    const k = (s.novelai && s.novelai.keys) || [];
    require("fs").writeFileSync(process.argv[1], JSON.stringify(k), { mode: 0o600 });' "$STAGE/.secret/novelai.json"
fi
size=$(du -sb "$STAGE" | cut -f1)
node -e '
  const [id, size, from, timeS, keys] = process.argv.slice(1);
  require("fs").writeFileSync(process.argv[6], JSON.stringify({ id, takenAt: new Date().toISOString(), sizeB: +size, from, timeS: +timeS, keys: keys === "1" }));' \
  "$ID" "$size" dreamscape "$(( $(date +%s) - t0 ))" "$KEYS" "$STAGE/.seed.json"

# to the host: the seeds dir is owned by the ssh login user (the replicas role prepares it); a failed run leaves no half seed behind
ssh "$HOST" "rm -rf '/srv/rack/replicas/seeds/.$ID.part' && mkdir -p '/srv/rack/replicas/seeds/.$ID.part'"
rsync -a --delete -e ssh "$STAGE/" "$HOST:/srv/rack/replicas/seeds/.$ID.part/"
ssh "$HOST" "rm -rf '/srv/rack/replicas/seeds/$ID' && mv '/srv/rack/replicas/seeds/.$ID.part' '/srv/rack/replicas/seeds/$ID'"
t1=$(date +%s)
node -e 'console.log(JSON.stringify({ id: process.argv[1], sizeB: +process.argv[2], timeS: +process.argv[3] }))' "$ID" "$size" "$(( t1 - t0 ))"
