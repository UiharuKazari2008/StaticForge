# Pictures: model, storage, names, formats (#1156)

## The picture model

A picture is **pixels + ordered text fields + stealth data**.

- Pixels: lossless RGBA (or RGB when opaque).
- Fields: an ordered list of `[keyword, text]` pairs (`Comment`, `Software`, `Source`, ...), format-neutral. The same list is
  carried as PNG text chunks, as WebP EXIF (NovelAI's layout) and as the JXL `sfMD` box (`modules/pictureMeta.js`).
- Stealth data: NovelAI's alpha-channel LSB payload lives in the pixels, so every lossless format keeps it.

`modules/pngMetadata.js` and `modules/pictureMeta.js` read the model from a PNG, WebP or JXL buffer. Code that needs fields or
pixels reads the stored bytes (`imageStore.readStored`, `pixelPath`, `webpBytes`); it does not go through a PNG.

## Storage

- New pictures are written as lossless JPEG XL `<name>.jxl` by `imageStore.writePicture` (effort 3 at save; the nightly
  `scripts/image-jxl-idle.js` re-encodes at effort 7 when the host is idle and verifies pixels, fields and extras first).
- The JXL carries `sfMD` (fields, colour-profile flag) and `sfFT` (date created / modified, effort). Pictures converted from
  legacy PNGs before #1156 carry the PNG's own chunks in `sfPN` instead; both are still read (`sfMD` first).
- A legacy `x.png` may still be a PNG on disk (no JXL encoder, or not converted yet).
- No PNG is made when a picture is saved.

## Names

- **Picture ID**: 36 characters, UUIDv7 shape, **no extension** (`01a21141-79a2-73e2-8c5d-4e69bdc73baa`); stored as `<id>.jxl`.
  `modules/pictureIds.js` (`newId`, `isId`, `timeOf`). The name says nothing about the bytes.
- **Legacy name**: `x.png` (also `x_upscaled.png`, `.jpg`, `.gif`). A `x.png` may lie on disk as `x.jxl`; the name stays `x.png`
  everywhere (database, workspaces, URLs).
- Relations are not in the name: a picture's parent / upscale links are in `data/picture-links.jsonl` and the `images` table's
  `parent` column (`pictureIds.link / parentOf / upscaleOf`).

## Caches

| Cache | Directory | Holds | Used for |
|---|---|---|---|
| Display cache | `.cache/jxl-webp` | lossless WebP of a JXL picture, validated by the JXL's mtime, one encode at a time per picture, 2 GB cap, oldest dropped | browsers that cannot show JXL (`imageStore.displayWebpPath`) |
| Export cache | `.cache/jxl-png` | PNG decoded from a JXL, same validation and cap | explicit PNG exports only (`imageStore.exportPng` / `exportPngPath`) |

New pictures are not seeded into either cache. A rewrite, rename or removal of a name drops its copies. Tests move both with
`IMAGESTORE_CACHE_ROOT`.

## Who gets which format

| Consumer | Gets | Why |
|---|---|---|
| Browser display (`GET /images/:name`, an `<img>` / CSS image, or the service worker on its behalf) | stored **JXL** when the client shows JXL (`melaton_jxl` cookie or `Accept: image/jxl`); else lossless **WebP** from the display cache; a stored PNG / JPEG / GIF as it is | no decode on the request path; a WebP encode (~1 s) happens once per picture |
| `fetch()` readers of `/images/:name` (no image destination: clipboard copy, add as reference / vibe, Paint, metadata reads) | **PNG** (export cache) | several hand the bytes to the browser clipboard (PNG only) or sniff them; unchanged until each is moved |
| Downloads (`?download=true&format=`) | `png` (default), `jxl`, `webp`, `jpeg` | the download window; the file is `<stem>.<ext of the bytes>` |
| Clipboard (`?clipboard=true`, `?clipboardOrigin=true`), `?stripContext=true` | **PNG** | the browser clipboard takes PNG; stripContext rewrites PNG text chunks |
| Fit-preview fallback (`/previews/<stem>@fit.webp?wait=1`, last resort) and `GET /{vfs}/images/:name?ws=` | stored JXL for a JXL client, else WebP display copy | it only shows the picture |
| MCP gallery download (`handleMcpGalleryImageDownload`) | WebP display copy for a JXL-stored picture, the stored file otherwise | the type and extension come from the bytes |
| FUSE mount (`modules/vfsFuseHttp.js`) | a picture **ID**: stored **JXL** listed as `<id>.jxl` (`image/jxl`, size = the stored file's, exact, no decode); a legacy **`x.png`** name: **PNG** (`exportPng`, size from the export cache) | the mount presents legacy names as `.png` and its readers expect PNG; an ID has no PNG form |
| Replication (`/replication/assets/gallery-image/<name>`, journal checksum, replica fetch) | the **stored bytes** under the picture's name: `image/jxl` for an ID or `x.jxl`, `image/png` for a PNG still on disk; `?format=png` gives a PNG for a peer from before #1156 | the journal's sha256 is of the same stored bytes; the fetching replica stores what it gets with `imageStore.writePicture` under the same name (JXL as it is, PNG encoded to JXL). The checksum is the save-time one: the nightly re-encode changes the bytes, not the pixels |
| Sequenzia (send to library) | **PNG** (`exportPng`) | its library takes PNG files |
| Grimoire remote browser file chooser | **PNG** (`exportPngPath`), a legacy `.jpg` / `.gif` as it is | an arbitrary page's upload form; PNG is what pages accept |
| NovelAI Explore upload (`novelaiExploreGallery.js`) | lossless **WebP** with the fields as EXIF (a stored WebP / PNG as it is); the eligibility check reads the stored bytes | NovelAI's own format; the module's accept list is PNG or WebP |
| NovelAI generation inputs (img2img, inpaint, references, vibe encodes) | lossless **WebP** (`webpBytes`) | smaller than PNG, no PNG step |
| LLM / Director images (`promptManager`, `chatImpl`, `cursorDirector`) | lossless **WebP** (`webpBytes`) | smaller than PNG; `cursorDirector` falls back to `exportPng` only if no WebP can be made |
| Ruiko animate worker (`imageAnimation.js`) | lossless **WebP**, bare pixels (`webpBytes`, `fields: false`) | the worker opens the still with PIL (`services/ruiko-upscaler`), which reads WebP |
| MCP image tools (`image_inspect`, `compare_images`, `read_image_metadata`) | the stored file (pixels read with sharp, fields with `pictureMeta`) | they compare pixels and read fields; no PNG |
| NovelAI Explore post images cached for the clipboard / import (`ensureExplorePngExport`) | **PNG** (from NovelAI's blob) | clipboard needs PNG; not a gallery picture |
