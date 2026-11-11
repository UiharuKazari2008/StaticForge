# Windows Mobile 6.1 icon style (Melaton Mobile)

How WM 6.1 Professional program icons are drawn, from the ROM art (Device Emulator dump in
`~/.cache/wm61/dump`, shell art in `public/static_images/wm61`, Yozora #709 / #732), and how our own
Dreamscape icons follow it. Tools: `scripts/generate-wm-icon.js` (CLI) and `scripts/wm-icon-studio.js`
(framing page), both on `modules/wmIconGenerator.js`.

Our icons are our own art in this style. Never copy a Microsoft icon or logo (no Windows flag, no
IE "e", no Messenger buddies, no Office marks); see `.cursor/rules/copyrights-not-1to1.mdc`.

## Sizes and files

| Frame | 1x (96 dpi) | 2x (192 dpi, VGA) | 4x (our HD set) | Used for |
| --- | --- | --- | --- | --- |
| small `app-<name>` | 16 | 32 | 64 | Start menu, title bar, lists, notifications |
| large `app-<name>-lg` | 32 | 64 | 128 | Programs grid (`wmPrograms` `wmLargeIcon()`) |

WM ships one multi-size icon group per program (16/32/64). The 32 px frame is both the 1x large and
the 2x small icon; the 16 px frame is a separate, simplified drawing, not a shrunk 32.
`wmShell` `art()` / `srcset()` read `app-<name>.png`, `@2x`, and `@4x` when the name is in `HD_ART`;
`wmLargeIcon()` uses `-lg` when `manifest.json` lists `app-<name>-lg`.

## Design language

- **Lineage.** The Vista-generation Microsoft look (2006-2008): glossy, bright, slightly 3D, but drawn
  for 64 px at most, so far simpler than Vista's 256 px art. Fewer, larger shapes; no fine texture.
- **Fill.** The art nearly fills the square: the long side is 56-64 of 64 px (0-4 px margin), centred.
  Tall or wide objects keep their proportion (the phone handset is 44 x 60). Our pipeline crops to the
  body with a 3% margin.
- **View.** Mostly front-on or a slight three-quarter turn (folders, cards, envelope, monitor). No
  strong isometric perspective, no floor, no scene.
- **Composition.** One main object; an optional small accessory overlapping the lower right
  (magnifier on a folder, gear on a folder or shield, key on an envelope, ribbon on a certificate,
  play arrow in a ring). Accessories are about 40-55% of the icon.
- **Outline.** Every shape has a thin outline in a darker shade of its own hue (dark blue on blue,
  brown on the amber folder, grey on paper), not black. At 16 px the outline is a full pixel and the
  edge is near binary (one step of anti-aliasing).
- **Light and shading.** Light from the upper left. Smooth vertical gradients, a crisp glossy band
  or spot highlight on the upper half of rounded shapes (globe, orbs, phone handset, buttons).
  Inner bevel on glass rings and buttons.
- **Palette.** Clear, saturated mid-tones: sky to royal blue (the most common), leaf green,
  warm amber/folder yellow, tomato red, orange (contact bust, calendar marker); off-white paper with
  pale blue-grey shading; cool steel grey for metal. Hardly any pure white or pure black.
- **No effects.** No drop shadow, contact shadow, reflection, glow or backdrop; transparent around
  the silhouette (a few page-curl shadows sit inside the object only).
- **16 px frames.** Redrawn, not scaled: straight front view, two or three shapes, thick outline,
  flat fills with one gradient (calendar becomes a 2 x 2 grid with an orange cell; contacts becomes a
  card with a bust and lines; the IE ring loses its gloss).

## How WM differs from our Vista desktop icons

| | Vista desktop (`app_icons`, `scripts/generate-app-icon.js`) | WM 6.1 phone (`wm61`, `scripts/generate-wm-icon.js`) |
| --- | --- | --- |
| Size | 256 px master, shown 28-64 | 64 max, shown 16 and 32 |
| View | three-quarter, isometric, still-life | front-on or slight turn |
| Detail | realistic materials, many props | a few large shapes, one accessory |
| Margin | 12% safe area, contact shadow allowed | about 3%, no shadow |
| Outline | none or soft | thin darker-hue outline on every shape |
| Small size | the same art scaled | its own simplified 16 px frame |

## Pipeline (modules/wmIconGenerator.js)

1. GPT Image (transparent model, default `gpt-image-2.5-sunburst`) draws a 1024 px master from the
   WM prompt; the desktop icon can be attached as a reference to keep the subject.
2. With `--small` a second request redraws the master as a 16 px frame (simplified, front-on).
3. Masters are kept in `.cache/wm-icons/originals/app-<name>.png` and `app-<name>-16.png` (not served).
4. Each master is cropped square around its body (alpha >= 128) with a 3% margin, haze at alpha <= 24
   cleared, then scaled with Lanczos (sharp premultiplies alpha). 16 px: supersampled at 2x,
   sharpened twice, +8% contrast, +10% saturation, alpha hardened (50-190 -> 0-255). 32 px: sharpen,
   alpha hardened 30-220. 64 px: light sharpen. 128 px: plain.
5. `manifest.json` gets `app-<name>` (16/32/64) and `app-<name>-lg` (32/64/128) entries flagged
   `generated`.

New names also need adding to `HD_ART` in `public/scripts/comp/wmShell.js` so the 4x files are used.

```bash
node scripts/generate-wm-icon.js --name teleport --small \
  --input "glass globe on a small chrome stand with two coloured location pins" \
  --from "Teleport (switches between workspaces, shown as planets)" \
  --ref public/static_images/app_icons/vista-teleport.png
node scripts/generate-wm-icon.js --resave teleport      # re-render sizes from the stored masters
node scripts/wm-icon-studio.js --port 9331             # frame, preview at 16/32/64, write sizes
```
