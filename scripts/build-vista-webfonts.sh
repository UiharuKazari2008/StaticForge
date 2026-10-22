#!/usr/bin/env bash
# Builds the Windows Vista web fonts (public/protected/fonts/vista/*.woff2) that public/css/vista-fonts.css
# declares under their Windows family names (Segoe UI, Tahoma, Consolas, Meiryo ...), so the desktop
# draws Vista's own font versions on every client instead of whatever the OS has.
#
# Source: C:\Windows\Fonts on the Vista VM (~/.config/vista-vm/vm.sh), bundled with makecab and
# unpacked with 7z. Conversion: fontTools + brotli in a venv under ~/.cache/vista-vm/fonttools-venv;
# a .ttc keeps its first face (Cambria, not Cambria Math; Meiryo, not Meiryo Italic). Glyphs and
# hinting are kept whole. They are Microsoft's files, so they live under /protected/ (signed-in
# sessions only, never in the install pack); the CSS falls back to local() and Selawik before sign-in.
#
# Usage: bash scripts/build-vista-webfonts.sh [outdir]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/public/protected/fonts/vista}"
VM="$HOME/.config/vista-vm/vm.sh"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/vista-vm"
VENV="$CACHE/fonttools-venv"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FILES=(
    segoeui.ttf segoeuib.ttf segoeuii.ttf segoeuiz.ttf segoepr.ttf segoeprb.ttf segoesc.ttf segoescb.ttf
    tahoma.ttf tahomabd.ttf verdana.ttf verdanab.ttf verdanai.ttf verdanaz.ttf
    calibri.ttf calibrib.ttf calibrii.ttf calibriz.ttf cambria.ttc cambriab.ttf cambriai.ttf cambriaz.ttf
    Candara.ttf Candarab.ttf Candarai.ttf Candaraz.ttf consola.ttf consolab.ttf consolai.ttf consolaz.ttf
    constan.ttf constanb.ttf constani.ttf constanz.ttf corbel.ttf corbelb.ttf corbeli.ttf corbelz.ttf
    lucon.ttf trebuc.ttf trebucbd.ttf trebucbi.ttf trebucit.ttf
    arial.ttf arialbd.ttf arialbi.ttf ariali.ttf ariblk.ttf times.ttf timesbd.ttf timesbi.ttf timesi.ttf
    cour.ttf courbd.ttf courbi.ttf couri.ttf georgia.ttf georgiab.ttf georgiai.ttf georgiaz.ttf
    pala.ttf palab.ttf palabi.ttf palai.ttf micross.ttf comic.ttf comicbd.ttf impact.ttf
    meiryo.ttc meiryob.ttc
)

command -v 7z >/dev/null || { echo "7z is required" >&2; exit 1; }
[[ -x "$VM" ]] || { echo "the Vista VM helper $VM is required" >&2; exit 1; }

if [[ ! -x "$VENV/bin/python" ]]; then
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install -q fonttools brotli
fi

{
    echo ".Set CabinetNameTemplate=vfonts.cab"
    echo ".Set DiskDirectoryTemplate=C:\\agent"
    echo ".Set MaxDiskSize=0"
    echo ".Set CompressionType=LZX"
    for f in "${FILES[@]}"; do echo "C:\\Windows\\Fonts\\$f"; done
} > "$WORK/vfonts.ddf"
"$VM" put "$WORK/vfonts.ddf" 'C:\agent\vfonts.ddf' >/dev/null
"$VM" run 'cd /d C:\agent && makecab /f C:\agent\vfonts.ddf' 300 >/dev/null
"$VM" get 'C:\agent\vfonts.cab' "$WORK/vfonts.cab" >/dev/null
mkdir -p "$WORK/ttf"
7z x -y -o"$WORK/ttf" "$WORK/vfonts.cab" >/dev/null

mkdir -p "$OUT"
"$VENV/bin/python" -I - "$WORK/ttf" "$OUT" <<'PY'
import os, sys
from fontTools.ttLib import TTFont, TTCollection
src, out = sys.argv[1], sys.argv[2]
for name in sorted(os.listdir(src)):
    base, ext = os.path.splitext(name.lower())
    path = os.path.join(src, name)
    font = TTCollection(path).fonts[0] if ext == '.ttc' else TTFont(path)
    font.flavor = 'woff2'
    font.save(os.path.join(out, base + '.woff2'))
    print(f"{base}.woff2  {font['name'].getDebugName(1)} {font['name'].getDebugName(2)}")
PY
