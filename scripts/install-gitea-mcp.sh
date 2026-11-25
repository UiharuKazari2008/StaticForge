#!/usr/bin/env bash
# Installs the pinned prebuilt gitea-mcp (https://gitea.com/gitea/gitea-mcp, MIT) to ~/.local/bin/gitea-mcp.
# Idempotent: does nothing when the installed version is the pinned one. The download is untrusted: it goes
# into its own empty temp dir and is verified against the release's published checksum file before use.
set -euo pipefail
VERSION="${GITEA_MCP_VERSION:-1.13.0}"
DEST="${GITEA_MCP_DEST:-$HOME/.local/bin/gitea-mcp}"
BASE="https://gitea.com/gitea/gitea-mcp/releases/download/v${VERSION}"
case "$(uname -m)" in x86_64) ARCH=x86_64 ;; aarch64|arm64) ARCH=arm64 ;; *) echo "unsupported arch $(uname -m)" >&2; exit 1 ;; esac
[ "$(uname -s)" = Linux ] || { echo "Linux only" >&2; exit 1; }
if [ -x "$DEST" ] && "$DEST" --version 2>&1 | grep -q "${VERSION}"; then echo "gitea-mcp ${VERSION} already installed"; exit 0; fi
TAR="gitea-mcp_Linux_${ARCH}.tar.gz"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir "$TMP/dl" "$TMP/out"
curl -fsSL -o "$TMP/dl/$TAR" "$BASE/$TAR"
curl -fsSL -o "$TMP/dl/checksums.txt" "$BASE/gitea-mcp_${VERSION}_checksums.txt"
WANT="$(awk -v f="$TAR" '$2==f{print $1}' "$TMP/dl/checksums.txt")"
GOT="$(sha256sum "$TMP/dl/$TAR" | awk '{print $1}')"
[ -n "$WANT" ] && [ "$WANT" = "$GOT" ] || { echo "checksum mismatch for $TAR" >&2; exit 1; }
tar -xzf "$TMP/dl/$TAR" -C "$TMP/out" gitea-mcp
mkdir -p "$(dirname "$DEST")"
install -m 0755 "$TMP/out/gitea-mcp" "$DEST.new" && mv -f "$DEST.new" "$DEST"
echo "installed gitea-mcp ${VERSION} (sha256 $GOT) to $DEST"
