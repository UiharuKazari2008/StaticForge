#!/usr/bin/env bash
# Download large wiki/tag seeds that are not committed (see docs/CLEAN_INSTALL.md).
#
# The base URL is a placeholder until a bundle is published. Point it at a directory
# that contains the files below, using the same relative paths:
#
#   SEED_BASE_URL=https://example.invalid/dreamscape-seeds bash scripts/fetch-seeds.sh
#
# TODO: replace the default with the real seed host when the owner publishes one.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEED_BASE_URL="${SEED_BASE_URL:-TODO}"

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
    echo "[fetch-seeds] SEED_BASE_URL is TODO." >&2
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
