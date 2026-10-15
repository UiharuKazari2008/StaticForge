#!/usr/bin/env bash
# Download large wiki/tag seeds that are not committed (see docs/CLEAN_INSTALL.md).
#
# PLACEHOLDER until Sala confirms the Yozora seeds folder is published.
# Default (override with SEED_BASE_URL):
#   https://yozora.bluesteel.737.jp.net/seeds/dreamscape/
#
#   SEED_BASE_URL=https://example.invalid/dreamscape-seeds bash scripts/fetch-seeds.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# PLACEHOLDER until Sala confirms.
SEED_BASE_URL="${SEED_BASE_URL:-https://yozora.bluesteel.737.jp.net/seeds/dreamscape/}"

FILES=(
    .cache/tag_wiki.db
    .cache/tag_search.db
    .cache/nax_tags.db
    danbooru_tagwiki.json
    e621_wiki_fixed.json
    danbooru_tag_groups_hierarchy.json
    nax_tags.json
)

if [[ -z "$SEED_BASE_URL" || "$SEED_BASE_URL" == "TODO" ]]; then
    echo "[fetch-seeds] SEED_BASE_URL is empty." >&2
    echo "[fetch-seeds] Set SEED_BASE_URL to the directory that hosts these files:" >&2
    printf '  %s\n' "${FILES[@]}" >&2
    echo "[fetch-seeds] Names, sizes, and sha256 are listed in docs/CLEAN_INSTALL.md." >&2
    exit 1
fi

base="${SEED_BASE_URL%/}"
for rel in "${FILES[@]}"; do
    dest="$ROOT/$rel"
    mkdir -p "$(dirname "$dest")"
    url="$base/$rel"
    echo "[fetch-seeds] $url"
    curl -fL --retry 3 --retry-delay 2 -o "$dest.partial" "$url"
    mv "$dest.partial" "$dest"
done

echo "[fetch-seeds] done. Compare sha256 with docs/CLEAN_INSTALL.md before building tag databases."
