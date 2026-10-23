# Graphic Session Document (.gsd)

Melaton Paint's own file format (Yozora #632). A `.gsd` file holds the whole working
state of a Paint window, without loss, so that opening it puts you back where you saved:
the layers and everything about them, the selection, the guides, the view, the tools, and
(by default) the undo history.

Code: `public/scripts/comp/desktop-apps/paint/paintGsd.js` (`paintGsd.encode(w)`,
`paintGsd.decode(buffer)`, `paintGsd.apply(w, state)`).

Paint still opens the older `.mpi` files (JSON with PNG data URLs). It can also save them,
but `.mpi` is not lossless: PNG data URLs go through the canvas's premultiplied alpha.

## Why a new format

| Need | `.png` / `.jpg` | `.mpi` | `.gsd` |
| --- | --- | --- | --- |
| Layers, blend modes, opacity | no | yes | yes |
| Masks, layer styles, adjustment and type layers, groups | no | partly | yes |
| Exact pixels, including semi-transparent ones | PNG almost (premultiplied) | no | yes (raw RGBA) |
| Selection, guides, view, tools, colours | no | no | yes |
| Undo history | no | no | yes (optional) |
| Size | small | about 1.4x PNG (base64) | raw RGBA, deflated |

## Layout

All numbers are little-endian.

```
offset  size  field
0       4     magic: 47 53 44 1A  ("GSD" and Ctrl+Z, like PNG's own 1A byte)
4       2     version (u16) = 1
6       2     flags (u16): bit 0 = the history is included
8       4     manifest length in bytes (u32) = M
12      M     manifest: UTF-8 JSON (below)
12+M    ...   blob area: the blobs, one after another
```

Each blob is an entry in `manifest.blobs`, and other parts of the manifest refer to it by
its index:

```json
{ "offset": 0, "length": 18234, "encoding": "deflate-raw", "format": "rgba8", "width": 800, "height": 600 }
```

- `offset` is counted from the start of the blob area.
- `encoding` is `deflate-raw` (RFC 1951; the browser's `CompressionStream('deflate-raw')`)
  or `none`.
- `format`:
  - `rgba8`: width x height x 4 bytes, straight (not premultiplied) alpha, as `getImageData`
    returns it.
  - `gray8`: width x height bytes (selection masks, 0-255).
  - `bytes`: anything else.

A reader skips a blob whose `format` or `encoding` it does not know, and keeps any manifest
keys it does not know. Version 1 readers refuse a file whose version is greater than 1.

## Manifest

```jsonc
{
  "format": "gsd",
  "version": 1,
  "generator": "Melaton Paint",
  "saved": "2026-10-23T14:02:11.000Z",
  "name": "poster",
  "blobs": [ /* see above */ ],

  "document": {
    "width": 800, "height": 600,
    "active": 2,            // index into layers (bottom = 0)
    "editMask": false,      // the active layer's mask is what the tools paint
    "layers": [{
      "id": 7,              // ids stay stable so the history can find its layers
      "name": "Layer 2",
      "visible": true, "opacity": 1, "blend": "normal", "locked": false,
      "groupId": 12,        // or null
      "pixels": 0,          // blob index (rgba8, document size)
      "mask": { "pixels": 1, "enabled": true },        // or null; luminance shows, alpha too
      "styles": { "shadow": {}, "glow": {}, "stroke": {} },  // or null
      "adjust": { "kind": "levels", "params": {} },    // an adjustment layer, or null
      "text": { "content": "Hello", "face": "Arial", "size": 24, "bold": false,
                "italic": false, "underline": false, "color": "#c0392bff", "x": 40, "y": 40 }
    }],
    "groups": [{ "id": 12, "name": "Group 1", "visible": true, "opacity": 1, "blend": "normal", "collapsed": false }],
    "guides": [{ "axis": "v", "pos": 250 }, { "axis": "h", "pos": 100 }],
    "selection": {          // or null
      "x": 10, "y": 10, "w": 200, "h": 120,
      "path": [{ "x": 10, "y": 10 }],   // free-form / ellipse / lasso selections
      "mask": 5                          // blob index (gray8, w x h), for mask selections
    },
    "lastSelection": null   // what Select > Reselect brings back, same shape
  },

  "view": {
    "zoom": 1, "scrollLeft": 0, "scrollTop": 0,
    "grid": false, "rulers": true, "guidesShown": true, "guidesLocked": false, "snap": true,
    "panels": ["layers", "history", "navigator", "info"],
    "hidden": ["tools", "colors", "status", "settings"]   // bars switched off in View
  },

  "tools": {
    "tool": "brush", "fg": "#000000", "bg": "#ffffff",
    "options": { "size": 0, "opacity": 100, "hardness": 100, "tolerance": 32 },
    "text": { "face": "Arial", "size": 12, "bold": false, "italic": false, "underline": false }
  },

  "history": {              // present when flags bit 0 is set
    "index": 4,             // the step the picture is at (-1: before the first)
    "steps": [
      { "label": "Brush", "kind": "pixels", "layerId": 7,
        "rect": { "x": 10, "y": 20, "w": 64, "h": 64 }, "before": 2, "after": 3 },
      { "label": "Add Layer", "kind": "snapshot", "before": { /* snapshot */ }, "after": { /* snapshot */ } }
    ]
  }
}
```

A snapshot (whole-document steps: layer order, resize, crop, styles) has the same shape as
`document`, except that each layer's `pixels` and `mask.pixels` refer to blobs of that
moment. Undo restores it.

## What is not saved

- A floating selection, an open text box, or an unfinished Free Transform. Saving commits
  them first, the same as Save does for `.png`.
- Saved swatches and the Rulers setting. They belong to Paint itself and live in the
  registry (`HKCU\Software\Xyridian\Melaton\CurrentVersion\Applets\Paint`).
- A history larger than 256 MB of raw pixels. The file then has no history (flags bit 0
  clear) and says so in `manifest.historyDropped`.

## In the VFS

- Extension `.gsd`, MIME type `application/x-graphic-session`.
- Explorer opens a `.gsd` (and an `.mpi`) in Paint.
- Paint's Save As offers it first, and suggests it for any picture that a flat format would
  lose something from.
