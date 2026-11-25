#!/usr/bin/env bash
# Checks scripts/gitea-mcp.sh picks the right token file per FLEET_SESSION. Uses temp token files and a fake
# binary that prints a fingerprint of the token (never the token); no network, no Yozora.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home/.secrets"
printf 'CLAUDE_TOKEN_A\n' > "$T/home/.secrets/yozora-claude.token"
printf 'GROK_TOKEN_B\n' > "$T/home/.secrets/yozora-grok.cursor.token"
printf 'YOZORA TOKEN C\n' > "$T/home/.secrets/yozora-yozora.token"
printf 'OTHER_D\n' > "$T/other.token"
cat > "$T/fake" <<'EOS'
#!/usr/bin/env bash
echo "args=$* host=$GITEA_HOST tok=$(printf %s "$GITEA_ACCESS_TOKEN" | sha256sum | cut -c1-12)"
EOS
chmod +x "$T/fake"
fp() { printf %s "$1" | sha256sum | cut -c1-12; }
fail=0
check() { # name expected-token env...
  local name="$1" tok="$2"; shift 2
  local out; out="$(env -i PATH="$PATH" HOME="$T/home" GITEA_MCP_BIN="$T/fake" "$@" bash "$DIR/gitea-mcp.sh" 2>&1)"
  local want="args=-t stdio host=https://yozora.bluesteel.737.jp.net tok=$(fp "$tok")"
  if [ "$out" = "$want" ]; then echo "ok   $name"; else echo "FAIL $name"; fail=1; fi
}
check "host session uses the claude token" CLAUDE_TOKEN_A
check "FLEET_SESSION=1 uses the default yozora token (whitespace stripped)" "YOZORATOKENC" FLEET_SESSION=1
check "FLEET_SESSION=1 honours YOZORA_TOKEN_FILE" OTHER_D FLEET_SESSION=1 "YOZORA_TOKEN_FILE=$T/other.token"
rm "$T/home/.secrets/yozora-claude.token"
check "host session falls back to the grok.cursor token" GROK_TOKEN_B
rm "$T/home/.secrets/yozora-grok.cursor.token"
out="$(env -i PATH="$PATH" HOME="$T/home" GITEA_MCP_BIN="$T/fake" bash "$DIR/gitea-mcp.sh" 2>&1)"; rc=$?
if [ $rc -ne 0 ] && ! echo "$out" | grep -q "TOKEN"; then echo "ok   no token file exits non-zero"; else echo "FAIL no token file"; fail=1; fi
exit $fail
