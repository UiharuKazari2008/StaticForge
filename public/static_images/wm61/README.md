# Windows Mobile 6.1 art

Source: Windows Mobile 6.1 Professional ROM (VGA build), dumped from the Device
Emulator. Yozora #709.

- `<name>.png` = 1x (96 dpi), `<name>@2x.png` = 2x (192 dpi). Sizes are exactly 2:1.
- `<name>@4x.png` (dense phones) comes from the @2x art: 1-bit glyphs (status,
  title-bar, menu and SIP icons) are point-upscaled so their pixel steps stay
  as the ROM draws them; colour icons go through 4x-UltraSharp
  (`~/.cache/wm61/up4/run.js`).
- Straight-alpha PNG32. Magenta keys and icon AND masks are converted to alpha.
- `manifest.json` lists the source module and resource id of every file, its pixel
  sizes and flags. This ROM ships mostly 192-dpi DLLs, so many 1x files are
  box-downscaled from the 2x art (`1x-downscaled-from-2x`). Nothing is upscaled.
- `title-close`, `title-ok`, `menu-check` and `menu-submenu-arrow` are glyph masks
  (white or black); the button and menu colours around them are drawn, not bitmaps.
- `wait-N` frames are opaque tiles in the ROM (no mask).
- The OS mark is the Melaton emblem (`../melaton/`). The Windows flag
  (`start-flag`, shellres icon 4609) is only for the opt-in Settings > Menus >
  Start (Windows flag) choice Yukimi asked for (2026-11-07), never the default.

## Drawn chrome (2x pixels, 480x640 screen)

- Title bar: 50 px, flat #004918, then a 2 px #292C29 line (y=50..51).
- Title-bar button (close and ok): 38x34 at x=436..473, y=8..41. 2 px border
  #214D08; inside it a 2 px light top edge (#84D34A), 2 px sides (#73CF31),
  2 px bright bottom edge (#5AC318 / #63C718), and a vertical fill from #63A239
  (top) to #4A9218 / #429210 (bottom). The glyph is white, drawn from the
  `title-close` / `title-ok` cell at x=433, y=0.
- Soft-key bar: starts with a 2 px #292C29 line at y=588, then a glossy green
  gradient that is lighter in the middle. No separators between the soft keys.
- Scroll bar: 26 px wide (x=454..479). 2 px black left edge, face #CEEBCE.
  Arrow buttons are 38 px tall with a 2 px black edge on the content side.
  The arrows are black filled triangles, 15x8 (rows 1,3,...,15 px). The thumb
  has the face colour with a 2 px black edge, and a grip of three 16x2 black bars
  with 2 px gaps. The track is white.
- List-header drop-down arrow: black filled triangle, 13x7.
- SIP arrow next to the keyboard: white filled triangle, 13x7.
