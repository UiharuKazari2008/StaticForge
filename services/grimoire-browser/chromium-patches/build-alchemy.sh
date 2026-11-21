#!/bin/bash
# Alchemy's Chromium (StaticForge #993): sync a stable tag, apply apply.py's patches, build, package.
# Runs on the build host (Sequenzia Core for now; a DL580 later) from ~/alchemy-chromium with depot_tools there,
# at the lowest CPU and IO priority. First build ~6 h on 12 threads; after a patch change, minutes.
#   ./build-alchemy.sh <tag> [all|sync|after-sync|gn|build|package]
#     all        sync, deps, hooks, patch, gn, build, package
#     after-sync deps, hooks, patch, gn, build, package (the checkout is already at the tag)
# Copy the whole chromium-patches folder to the build host (apply.py reads files/ and brand/ beside it; tar -h, as
# brand/alchemy.png is a link into public/) and run this script from there.
# The build is branded (brand.py) and its binary is already named alchemy. On the Dreamscape host: unpack the tarball
# into a new folder, swap it in as ~/.local/share/dreamscape/alchemy-chromium and pm2 restart grimoire-browser
# (it wins a version tie with the system Chromium; a newer system Chromium wins and Alchemy falls back to stock
# behaviour until this is rebuilt at that tag: security fixes come with every stable).
set -euo pipefail
TAG="${1:-156.0.8078.79}"
STAGE="${2:-all}"
ROOT="$HOME/alchemy-chromium"
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="$ROOT/depot_tools:$PATH"
cd "$ROOT"
say() { echo "[$(date '+%F %T')] $*"; }
if [[ "$STAGE" == all || "$STAGE" == sync ]]; then
  say "sync $TAG"
  [ -f .gclient ] || gclient config --spec 'solutions=[{"name":"src","url":"https://chromium.googlesource.com/chromium/src.git","managed":False,"custom_deps":{},"custom_vars":{"checkout_nacl":False,"checkout_pgo_profiles":False}}]'
  nice -n 19 gclient sync --nohooks --no-history --shallow --revision "src@refs/tags/$TAG" -j10
fi
if [[ "$STAGE" == all || "$STAGE" == sync || "$STAGE" == after-sync ]]; then
  say "deps"
  sudo ./src/build/install-build-deps.sh --no-prompt --no-arm --no-chromeos-fonts --no-nacl >/dev/null
  say "hooks"
  nice -n 19 gclient runhooks
  say "patch"
  python3 "$HERE/apply.py" src
fi
if [[ "$STAGE" == all || "$STAGE" == after-sync || "$STAGE" == gn ]]; then
  say "gn"
  mkdir -p src/out/Alchemy
  cat > src/out/Alchemy/args.gn <<'ARGS'
is_debug = false
is_component_build = false
is_official_build = false
symbol_level = 0
blink_symbol_level = 0
v8_symbol_level = 0
dcheck_always_on = false
treat_warnings_as_errors = false
enable_nacl = false
chrome_pgo_phase = 0
proprietary_codecs = true
ffmpeg_branding = "Chrome"
use_remoteexec = false
use_siso = false
ARGS
  (cd src && gn gen out/Alchemy)
fi
if [[ "$STAGE" == all || "$STAGE" == after-sync || "$STAGE" == build ]]; then
  say "build"
  (cd src && nice -n 19 ionice -c3 autoninja -C out/Alchemy chrome -j 10)
fi
if [[ "$STAGE" == all || "$STAGE" == after-sync || "$STAGE" == package ]]; then
  say "package"
  OUT=src/out/Alchemy
  # features: Blink features Alchemy turns on; patches: what this build carries (server.js checks for them)
  printf '{\n  "chromium": "%s",\n  "issue": "StaticForge #993",\n  "features": ["AlchemyEmulatedScaleCompositor"],\n  "patches": ["emulated-scale", "overscan", "ie-error-pages", "brand"],\n  "built": "%s"\n}\n' "$TAG" "$(date -Iseconds)" > "$OUT/alchemy-patches.json"
  ln -f "$OUT/chrome" "$OUT/alchemy"
  tar -czf "$ROOT/alchemy-chromium-$TAG.tar.gz" -C "$OUT" alchemy chrome chrome_crashpad_handler chrome_100_percent.pak chrome_200_percent.pak \
    resources.pak icudtl.dat v8_context_snapshot.bin libEGL.so libGLESv2.so libvk_swiftshader.so vk_swiftshader_icd.json \
    libvulkan.so.1 locales alchemy-patches.json
  say "package $ROOT/alchemy-chromium-$TAG.tar.gz"
fi
say "done $STAGE"
