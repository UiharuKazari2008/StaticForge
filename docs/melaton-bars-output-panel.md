# Melaton Bars: the output panel (roles `output.0` .. `output.8`)

StaticForge #1327. Quick Access's Output tile (`qa:output`) and the media session's output button
(`wmTitanium.js` `openOutputSwitcher`) open our own output selector, drawn by the Android app (CaféReady) from a layout
definition the page writes down, so it opens and moves media with the page asleep (`cafeready-background`). Android's own
Media output switcher is not opened. The layout definition is the rule `melaton-bars-native-layouts`; the full text of this
one is the header comment of `public/scripts/comp/wmOutputPanel.js` (builder), `public/css/wm-output-panel.css` (look).

## Roles

`output.N`, N = 0 .. 8: the panel with exactly N rows (N = the outputs the app lists now; `output.0` = none). The page cannot
know N, so it writes all nine (`wmQuickAccess.roles()` returns them, also with Quick Access switched off). Laid out by
`wmQuickAccess.open(role)`, which delegates to `wmOutputPanel.build`: the same edge (`cfg.side`), between the bars, the same
tint, glass, shadow fields (`qa-out` / `qa-in`) and width as Quick Access's panel (strip 1 or 2 columns, or the wide panel).
It takes Quick Access's place.

## Drawing list and actions

- Title: static text "Audio output".
- Row `i` (0-based) is a hit `android:out:<i>` (`data-android="out:<i>"`): the app moves media to the output it lists in row `i`.
  Its pictures: a highlight box and a check (both live `out-sel:<i>`), seven stacked glyph pictures (live `out-g:<i>:<glyph>`,
  glyph = `output headphones headset display jack speaker cast`, files `/static_images/quickaccess/out-<glyph>.png`, made
  from `wmShell.js` `GLYPHS` by `scripts/generate-output-glyphs.js`), and the name (live `out-name:<i>`).
- `output.0`: one text, live `out-empty` ("No other output is available."), no rows.
- Row height: 48 WM units in the strip, 40 in the wide panel (Quick Access's tile is 36), less only when N rows would not fit
  between the bars (never below 30).

## Live fields (what the app fills from its own route list)

| Field | Meaning |
| --- | --- |
| `out-name:<i>` | the output's name (the page's sample is only for the box; strip: centred on `cx`, wide: from `x`) |
| `out-g:<i>:<glyph>` | the row's picture: the app draws the one of the output's kind (`wmShell` `outputGlyph`) |
| `out-sel:<i>` | the highlight box and the check: drawn only for the output media plays on |
| `out-empty` | `output.0`'s text |

## Message handling

While up, the app updates the rows from its route list (switching to the role of the new row count when outputs come or go)
and the current mark after a move. A press outside the panel, Home or Back closes it, as Quick Access; a row press closes it
once the move is done or has failed. The page is asked for the layouts again when the workspace colour, side, layout or
columns change, or `wmOutputPanel.VERSION` is bumped (`wmQuickAccess.signature(role)`).
