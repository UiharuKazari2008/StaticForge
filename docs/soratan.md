# SoraTan (Nanami desktop toy)

Yozora #633. `SoraTan.exe` (2009, a Direct3D 9 desktop toy showing Nanami) runs on the web desktop
as a port: double-click it in Explorer, loose or inside `SoraTan.iso` in Downloads, and she stands
on the desktop. Nothing of the exe runs; her art and motion are decoded from `nanami.sora`.

Since #638 she is a Melaton app, the first system package ([client-api/melaton-apps.md](client-api/melaton-apps.md)):

| Part | File |
| --- | --- |
| Package | `apps/soratan/` (`manifest.json`: `opens` SoraTan.exe, 999424 bytes; session runner) |
| Server half | `apps/soratan/server/main.js` reads the `.sora` next to the exe (a random one if several, as the exe does) and decodes it with `server/decoder.js` |
| Client half | `apps/soratan/client/soratan.js` (WebGL, overlay layer, tray icon, MENU 131) |
| Icons | `apps/soratan/assets/soratan-16/32/48.png` (the exe's RT_GROUP_ICON 128) |
| Test | `node scripts/test-soratan.js` (and `scripts/test-melaton-apps.js` for the runner) |

Nothing of the toy is in `public/` any more: the art and motion come from the user's own
`nanami.sora` at launch. With no `.sora` next to the exe she answers as the exe does, "Load Sora
file fail!". Exit (her menu or the tray's) ends her and her server process; so does closing the tab.

## nanami.sora

Worked out from the file and from `SoraTan.exe`'s loader (S_Archive / S_Serializer classes):

- Chunks: `[u32 0x6e39d92b][fourcc][u32 size][data]` for `CENT` (the entries) and `INFO`; `WIDE`
  (the directory) follows `CENT` as a bare `[fourcc][size]`.
- `WIDE` is XORed with `ABCD`, repeating from its data start. It lists the entries by absolute file
  offset and size: `nanami.png`, `MainData`, `ProjectData`, `SoraWorkspace`, `Dummy0..3`.
- Each entry is XORed with one byte of its own (the PNG's from its signature, MainData's from its
  first u32, which is 2).
- MainData (S_SceneLibrary) has three meshes: `nanami` (48 vertices, never shown by the toy), `口`
  (the mouth, 6 vertices) and `本体` (the body, 66 vertices). A mesh is a quad list (4 indices + 0)
  and baked frames of D3D vertices (FVF 0x337, stride 80: xyz at 0, colour at 0x28, uv at 0x2c), in
  pixels about the texture centre, y up.
- The mouth carries 7 shapes (`口`, `:D`, `A`, `E`, `I`, `O`, `U`): a UV offset (and, for I, a
  scale) that moves its quad onto another mouth of the texture. The toy shows `口`, the smile line.
- 13 clips (`Startup`, `Anime1`, `Anime2`, `DragL`, `DragR`, `A`..`U`, `-`, `test mouth`, `M`):
  `[0x1002][u32][size][duration ms]` + 124 bytes of 0xCD + groups 0x2000 (node: position, rotation
  wxyz, scale), 0x3000 (per mesh, meaning unknown, kept raw), 0x4000 (per mesh: vertex frame,
  mouth shape), 0x5000-0x7000 (empty). A track is `[size][clip][-1][interp][count]` + keys of
  `[u32 ms]` + value; interp 0x11 morphs between frames, 0 steps.
- Placement, fitted against the exe on the Vista VM: `world = node + scale * (vertex + offset) -
  (0, 256)`, the offsets being the per-mesh positions in the editor timeline (Clip001), the node's
  rest transform `Node01` (scale 1.0732). The view is x -256..256, y -512..0.

## Behaviour (as SoraTan.exe does it)

- A 500 x 500 topmost window (Size: 300 / 500 / 700 / 900), centred along the bottom of the screen
  with the taskbar over her feet. No taskbar button; a tray icon (the 16 px clover).
- Showing her fades her in (about 0.6 s) while Startup plays; then Anime1 and Anime2 loop at random.
- Dragged, she moves sideways only and is lifted onto the taskbar (window bottom 8 px under its top
  edge). A move of more than 5 px in a 20 ms tick leans her (DragL / DragR node pose, 640 ms in);
  standing still she rights herself over 5.76 s. The body keeps its idle animation meanwhile. The
  cursor is the clover.
- Right-click on her or the tray icon: Size, Hide, Auto Hide, Exit (MENU 131; MENU 132 adds the
  Option > Test entries and About of a test build). A click on the tray icon shows her.
- Auto Hide (checked by default in the exe) keeps her shown only while a voice line plays and 2.56 s
  after. The voice, `nanami.ogg` (15 lines, `nanami.svs`; mouth timing in `nanami.afpk`), is not in
  this copy, so the real toy never appears with Auto Hide on. The port starts with it off; on, she
  fades out 2.56 s after she shows.
- The exe draws through a colour key (#808080), so its edges are hard; the port keeps the texture's
  soft alpha.

## Not done

- No voice: the audio is not in the ISO. With `nanami.ogg` the lines would play on the A..U mouth
  shapes from `nanami.afpk` (`audfprintpeakV00`: peak data per sentence).
- Group 0x3000 values (80 / 90 on the mouth and body in Anime2) are not used.
- Dropping another `.sora` on her (the exe accepts dropped files and loads a random `*.sora` from its
  folder) is not ported.
