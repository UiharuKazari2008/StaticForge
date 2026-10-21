# Vista games (Yozora #609)

The web desktop's Games folder: Windows Vista's nine games recreated from their own resources,
plus two MeletonFX additions in the same style. All Programs › Games lists them; the Start menu's
Games place opens Games Explorer.

| Game | Script | Pack (`/static_images/vista-games/…`) | Feature |
| --- | --- | --- | --- |
| Minesweeper | `minesweeper.js` | `minesweeper` (MineSweeper.dll) | `vista_minesweeper` |
| Solitaire, Spider Solitaire, FreeCell, Hearts | `solitaire.js`, `spider.js`, `freecell.js`, `hearts.js` on `cardEngine.js` | `cardgames` (System32\CardGames.dll) + one per game for its MUI | `vista_solitaire` … (`vista_cards`) |
| Mahjong Titans | `mahjong.js` | `mahjong` | `vista_mahjong` |
| Purble Place | `purble*.js` | `purble` (PurblePlace.dll + PurblePlace2.dll) | `vista_purble` |
| Chess Titans | `chess*.js` | `chess` | `vista_chess` |
| InkBall | `inkball*.js` | `inkball` | `vista_inkball` |
| Block Drop, Brick Breaker (MeletonFX) | `blockdrop.js`, `brickbreaker.js` | `blockdrop`, `brickbreaker` (own art, `scripts/build-vista-arcade-art.js`) + Minesweeper's frame and sounds, CardGames' particles and sounds, Mahjong's tile clacks; Block Drop also plays Teleport's `/sounds/planet/innerlight.opus` as music | `vista_blockdrop`, `vista_brickbreaker` |
| JezzBall (Win 3.x, Entertainment Pack 4) | `jezzball.js` on `jezzballCore.js` + `jezzballReal.js`, `jezzballHelp.js`; `vista-jezzball.css` | `jezzball` (`scripts/build-vista-jezzball.js` from the game's own files) | `vista_jezzball` |
| Games Explorer | `gamesExplorer.js` | `explorer` (icons taken from gameux.dll; the `gameux` pack is built but not loaded) + each game's GDF | `vista_explorer` |

Scripts live in `public/scripts/comp/desktop-apps/vista-games/`; styles in
`public/css/desktop-apps/vista-games.css` (windows, dialogs, task dialogs, status bar) and
`vista-games-explorer.css`. `openVistaGame(id)` (featureLoader.js) loads a game's feature and opens it.
The Start menu's entries are `startMenuGameLaunchables` (modalUtils.js: the eleven games and Games
Explorer). Games Explorer lists the nine with the facts of their GDFs and the two MeletonFX games
with facts written in its `CATALOG`.

Icons: the caption, taskbar, Start menu and Games Explorer use the app-icon set,
`/static_images/app_icons/<size>/vista-<id>.webp` (`vista-games` for Games Explorer), which
`modules/appIconRuntimeAssets.js` compiles from the 256 px masters
`public/static_images/app_icons/vista-<id>.png`; the About boxes use
`/static_images/vista-games/icons/<id>-48.png`.

## Assets

`node scripts/build-vista-games.js [--src ~/.cache/vista-vm/games] [--only minesweeper,…]` turns
the resources dumped on the Vista VM (`C:\agent\dumpres.exe`, one folder per DLL/exe/MUI) into web
assets: each sprite sheet's D3DX JPEG + cabinet BMP alpha (and the 2x sheet, or its four quadrant
pages) → WebP, every XML → `data.json` (`{ t, a, c, v }` nodes, localisable `|id|cat|Text//note`
kept as Text), WMA → AAC, PNGs as they are, and the `.exe.mui` string tables, menus, DIALOGEX
templates, accelerators and Game Definition File. The game art is left out of the install pack
(`web_server.js` buildServiceWorkerCacheManifest); the service worker caches it on first use.

HiDPI: the sprite sheets' @2x pages and the images' x2 PNGs are the games' own (the stage switches
to them from 1.5x). The art the originals had only at 96 DPI, drawn as HTML (Change Appearance
thumbnails, Games Explorer glyphs and ESRB box, the command link arrow, Cartograph's command bar
glyphs and swoosh the Explorer shares), gets `<name>@2x.png` copies from
`scripts/build-vista-games-hidpi.sh` (Real-ESRGAN x4plus, brought down to 2x), used through
srcset / image-set. InkBall's bitmaps stay 1x: they are pixel art drawn nearest-neighbour.

## Engine (`vistaGameEngine.js`, `window.VistaGames`)

Packs and sprites (`pack.sprite(path)`), the canvas Stage (native size, scaled with the window,
the 2x sheets from 1.5x, Direct3D 9's half-texel bilinear look reproduced), animation scripts
(`VG.Animator`), sounds (`VG.Sounds`), scene XML (`VG.Scene`), tip balloons, the game window
(`VG.createGameWindow`: MUI menu bar + accelerators, aspect-locked resize through modalUtils'
`windowResizeConstrain`), dialog boxes laid out from the games' own templates (Segoe UI 8 pt,
1 DLU = 1.5 × 1.625 px), Vista task dialogs, and per-game storage (`localStorage`
`vistaGame:<id>`: settings, statistics, saved game).

## Card games (`cardEngine.js`)

As CardGames.dll plays them on the VM: arrow keys move the yellow focus glow between stacks and
Space / Enter plays the focused card; click a card, then click where it goes; hints are the blue
stack glow and stay until the next input; with Show tips on, an idle table shows the next possible
move by itself. Tips come from each game's tips XML by Id. The window can shrink to ENGINE.XML's
640 x 480 (`minWindowW` / `minWindowH` on `VG.createGameWindow`).

## Checked against the VM

Each game was compared with the running original (screenshot of the VM at native size vs a
headless render): frame pieces located by search, layouts, dialogs, status bars, deals
(FreeCell #11850 card for card). Placement rules measured there: dialogs centre over their owner
but never above / left of its top-left corner; task dialogs centre 8 px left and 28 px up.

Limits of the reference: the VM's 3D driver draws none of the games' Direct3D text (counters, tip
text, labels), so text follows the layout data; the card games' debug "Force Win" cannot be
reached (MUI files refuse edits), so their win effects are built from CardGames.dll's emitters
and are not verified.

## JezzBall (Yozora #610)

The Windows 3.x game, as a 16-bit program looks on Vista: Vista draws its windows unthemed, so it
is Windows Classic in the Aero colour scheme (8 px raised sizing frame, flat 19 px gradient
caption, 17 x 15 bevelled caption buttons, flat menus with a drop shadow) on the Aero desktop. It
is listed in All Programs › Games, not in Games Explorer (a 16-bit game has no GDF).

Reference: the VM is Vista x64, which has no NTVDM, so the game runs there under otvdm
(`C:\agent\otvdm8`, the "for old Windows" 0.8.1 build: 0.9.0 imports Windows 7's K32* calls;
start it from a batch file with `__COMPAT_LAYER=VistaRTM` set, or it relaunches itself and dies).
otvdm disables theming for 16-bit windows, which is what NTVDM on 32-bit Vista shows too. The raw
resources, VM captures and the decompile notes are in `~/.cache/vista-vm/jezzball/`
(`notes/logic.md` rules, `ui.md` drawing and dialogs, `real48.md` the arithmetic, `help.txt`).

- **Rules and drawing** (`jezzballCore.js`): decompiled from JEZZBALL.EXE (Turbo Pascal for
  Windows + OWL). The client is a 496 x 322 GDI surface: 30 x 22 cells of 16 x 12 px (row 1 at the
  bottom), tiles SRCCOPY from the JEZZ-NEW sheet, balls XORed (SRCINVERT, frames pre-XORed with
  the tile under them), status text in the System font (`vgasys.fon`) as ExtTextOut(ETO_OPAQUE)
  with 8 px of black either side. Moves go in half steps, one per timer tick: 62.5 ms at Fast,
  109.375 ms at Slow (Vista rounds SetTimer(50 / 100) up to whole 15.625 ms periods; measured).
- **Arithmetic** (`jezzballReal.js`): score and area are TP 6-byte Reals, ported from the RTL and
  checked against its machine code. The area is a sum of n / 560 terms that drifts low: one cell
  at a time the level ends at 421 cells, and every exact 5% step reads one lower.
- **Random**: TP's `RandSeed * 134775813 + 1`, seeded from the clock; the demo seeds 17 and replays
  the original's 122 recorded clicks, and draws the VM's demo frames pixel for pixel.
- **The partial-wall trick**: each half starts on its own and only on a free cell, so a click on a
  ball starts the other half alone; it never stops part way, it anchors (scoring its cells and
  filling any region it closes) or a ball next to it kills it.
- **Window** (`jezzball.js`): the client's minimum is 496 x 322 and it is sizable (the board stays
  at the top left). Esc minimizes (the boss key), F1 / F2 / F3 Help, New Game, Pause, right click
  turns the wall builder (the system's ns / ew resize cursors), Ctrl+Shift+F12 is the original's
  cheat (area 101%, no bonus). The game freezes while the window is inactive or minimized, and
  runs on while a menu is open.
- **Dialogs**: Well done! is a 16-bit dialog (white client, System font) at (178, 106) of the
  client. The Entertainment Pack's boxes (WEP4UTIL.DLL: About, the name entry, Hall of Fame) are
  gray with a 1 px border, centred on the screen's width a third of the way down; their caption
  icon is WEP4UTIL's mono icon, part of it XORed with the caption. Game Over is a Vista message box.
- **Scores**: EntPack.dat's Hall of Fame and Today's list (five each; Today resets each day) and
  EntPack.ini's DefName, in localStorage `vistaGame:entpack`; settings (Speed, Sound) in
  `vistaGame:jezzball`.
- **Sounds**: only BOUNCE.WAV and JEZZDEAD.WAV ship with the game, so the other events are silent
  as in the original (tada.wav is looked for in the Windows directory, which has none on Vista).
- **Help**: Vista has no WinHlp32 for a .HLP, so Help opens a Windows Help window (themed, as
  Vista's WinHlp32 update) with JEZZBALL.HLP's topics, jumps and popups (`jezzballHelp.js`).
- **Assets**: `node scripts/build-vista-jezzball.js [--src ~/.cache/vista-vm/jezzball]` writes the
  sheet, the About logo and trophy, the icons, the caption-button glyphs (cut from VM shots), the
  WAVs and `jezzball.json` (the System and MS Sans Serif 24 px fonts as 1-bit atlases, the demo).

## Tests

`npm run test:vista-games` (deal, menus, animation scripts, card fans, Mahjong deals, MUI parsing,
and Block Drop / Brick Breaker rules); the games with their own suites: `scripts/test-vista-*.js`.
