# ResourcesSaverExt automation overlay

Upstream **Save All Resources** (`up209d/ResourcesSaverExt`, GPL-3.0+) is a DevTools
panel extension. StaticForge’s dump (Chrome for Testing + CDP preferred, xvfb headed fallback; no Playwright) talks to it via page `postMessage`, which
stock upstream does not implement.

`setup-dump-deps.sh` downloads a pinned upstream tree into gitignored
`tools/ResourcesSaverExt/`, then this overlay:

1. Copies `automation-bridge.js` into `unpacked2x/`
2. Patches `manifest.json` to register it as a content script

## Protocol (must stay in sync with `dump-novelai-webapp.js`)

Page → extension:

```json
{ "type": "RESOURCES_SAVER_AUTOMATION_SAVE", "requestId": "save-…" }
```

Extension → page:

```json
{
  "type": "RESOURCES_SAVER_AUTOMATION_SAVE_RESULT",
  "requestId": "save-…",
  "response": { "ok": true, "filename": "novelai.net.zip", "...": "…" }
}
```

## Notes

- Automation mode **re-fetches** discovered URLs (Performance Resource Timing + DOM).
  It is not a full DevTools `getResources` capture; it is enough for public chunk /
  contract review dumps.
- `tools/` stays gitignored — do not commit the unpacked extension.
- Keep GPL notices; do not strip upstream LICENSE.
