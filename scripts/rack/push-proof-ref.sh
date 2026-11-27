#!/usr/bin/env bash
# Push the working tree (tracked changes + the listed untracked paths) to the replicas mirror on the host as refs/proof/<name>, without
# touching this checkout's index, branches or stash, so `replicas image-build {ref:'refs/proof/<name>'}` can test uncommitted work.
#   bash scripts/rack/push-proof-ref.sh <name> [extra untracked path ...]
set -euo pipefail
name="${1:?name}"; shift || true
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; cd "$root"
tmp="$(mktemp -u /var/tmp/proof-index.XXXXXX)"; trap 'rm -f "$tmp"' EXIT
export GIT_INDEX_FILE="$tmp"
git read-tree HEAD
git add -u
for p in "$@"; do git add -f -- "$p"; done
tree="$(git write-tree)"
commit="$(git -c user.name=proof -c user.email=proof@localhost commit-tree "$tree" -p HEAD -m "proof $name")"
unset GIT_INDEX_FILE
git push --receive-pack='sudo git-receive-pack' -f "ssh://fat-misaka/srv/rack/replicas/mirror.git" "$commit:refs/proof/$name"
echo "$commit"
