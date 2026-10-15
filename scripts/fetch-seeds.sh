#!/usr/bin/env bash
# Download the large wiki/tag seeds that are not committed (see docs/CLEAN_INSTALL.md)
# and verify each one against the SHA256SUMS hosted next to them.
#
# Default base (override with SEED_BASE_URL):
#   https://yozora.bluesteel.737.jp.net/seeds/dreamscape/
#
#   SEED_BASE_URL=https://example.invalid/dreamscape-seeds bash scripts/fetch-seeds.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEED_BASE_URL="${SEED_BASE_URL:-https://yozora.bluesteel.737.jp.net/seeds/dreamscape/}"

# Local path in the repo. SHA256SUMS and the download URL use the basename.
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
    echo "[fetch-seeds] SEED_BASE_URL is empty. Set it to the directory that hosts SHA256SUMS and:" >&2
    printf '  %s\n' "${FILES[@]##*/}" >&2
    exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
    sha256() { sha256sum "$1" | awk '{print $1}'; }
else
    sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
fi

base="${SEED_BASE_URL%/}"
sums="$(mktemp)"
trap 'rm -f "$sums"' EXIT

echo "[fetch-seeds] $base/SHA256SUMS"
curl -fsSL --retry 3 --retry-delay 2 -o "$sums" "$base/SHA256SUMS"

expected_for() {
    awk -v n="$1" '{f=$2; sub(/^\*/,"",f); if (f==n) {print $1; exit}}' "$sums"
}

# Check every seed is listed before downloading anything.
for rel in "${FILES[@]}"; do
    if [[ -z "$(expected_for "${rel##*/}")" ]]; then
        echo "[fetch-seeds] ${rel##*/} is missing from $base/SHA256SUMS" >&2
        exit 1
    fi
done

for rel in "${FILES[@]}"; do
    name="${rel##*/}"
    dest="$ROOT/$rel"
    want="$(expected_for "$name")"
    mkdir -p "$(dirname "$dest")"
    if [[ -f "$dest" && "$(sha256 "$dest")" == "$want" ]]; then
        echo "[fetch-seeds] $rel already up to date"
        continue
    fi
    echo "[fetch-seeds] $base/$name"
    curl -fL --retry 3 --retry-delay 2 -o "$dest.partial" "$base/$name"
    got="$(sha256 "$dest.partial")"
    if [[ "$got" != "$want" ]]; then
        rm -f "$dest.partial"
        echo "[fetch-seeds] sha256 mismatch for $name: expected $want, got $got" >&2
        exit 1
    fi
    mv "$dest.partial" "$dest"
done

echo "[fetch-seeds] done. All seeds match $base/SHA256SUMS."
