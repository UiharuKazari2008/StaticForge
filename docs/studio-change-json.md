# Studio change JSON

Stable contract so other bots (Hoshino, Sala, Frost, Grok, …) can hand Yukimi a **JSON blob** instead of “copy this and replace your prompts and UCs”.

Yukimi pastes the blob into Dreamscape Studio (or any prompt textarea). Studio parses it, shows a confirm dialog, and applies the selected fields.

In-app copy of this spec: Studio → **Copy change JSON** → **Copy AI spec**, or `window.STUDIO_CHANGE_AI_SPEC`.
Source of truth for the rules: this file. Keep `STUDIO_CHANGE_AI_SPEC` in `public/scripts/comp/studioChangeJson.js` in sync.

---

## How to emit

Reply with JSON only — no markdown unless fenced as `json`. One object. Omit keys you are not changing.

Discriminators Studio accepts:

| Field | Required | Allowed values |
|-------|----------|----------------|
| `dreamscape` | yes (preferred) | `"change"` |
| `type` / `kind` | alternate | `"dreamscape-change"` or `"studio-change"` |
| `v` | yes | `1` |
| `title` | no | short name shown on the apply dialog / desktop shortcut |

Do **not** invent keys Studio cannot apply. Unknown keys are ignored. Director image uploads, inpaint masks, and raw PNG blobs are **not** in this contract.

---

## Shape (`v: 1`)

```json
{
  "dreamscape": "change",
  "v": 1,
  "title": "short name",
  "params": {},
  "expanders": [],
  "fields": [],
  "characters": [],
  "vibes": []
}
```

### `params` — only include values to change

| Key | Type | Notes |
|-----|------|--------|
| `steps` | number | |
| `guidance` | number | |
| `rescale` | number | |
| `sampler` | string | e.g. `"k_euler_ancestral"` |
| `noiseScheduler` | string | e.g. `"karras"` |
| `model` | string | e.g. `"v5"` |
| `seed` | string or number | |
| `resolution` | string | Named preset (`normal_portrait`, `normal_landscape`, …). **Omit `width`/`height` when using a named preset.** Custom size: `"custom"` plus `width` and `height`. |
| `width` | number | Only with `"resolution": "custom"` |
| `height` | number | Only with `"resolution": "custom"` |
| `variety` | boolean | |
| `upscale` | boolean | |
| `strength` | number | img2img strength (only if Studio is already in a strength-capable mode) |
| `noise` | number | img2img noise |
| `append_quality` | boolean | Quality preset on/off |
| `append_uc` | number | `0` None, `1` Human Focus, `2` Light, `3` Heavy, `4` Curated, `5` Furry Focus |

### `fields` — base prompt / UC only

`id` must be one of: `prompt`, `uc`, `promptNegative`.

Always `"action": "replace"`. Named `chunks` are **your** groups (Scene, Lighting, Quality) — not one chunk per comma. Do not split on commas. Never use `character:N:prompt` ids here; character slots belong in `characters`.

```json
{
  "id": "prompt",
  "action": "replace",
  "chunks": [
    { "name": "Subject", "text": "1girl, looking at viewer" },
    { "name": "Lighting", "text": "sunset, golden hour" }
  ]
}
```

Shorthand also accepted: top-level `"prompt"` / `"uc"` / `"promptNegative"` as a string (treated as full replace).

`remove` deletes a span that already exists. Default is replace (overwrite). Omit unused keys.

### `characters` — existing slots only

**ALWAYS `"action": "replace"` and ALWAYS set `"index"`.**  
`index` 0 = first slot, 1 = second, …  
**NEVER `"add"`.** If you write `"add"` it is wrong (Studio coerces it to replace).  
Never copy character 0's prompt/uc/name into character 1.

```json
{
  "index": 0,
  "action": "replace",
  "name": "Alice",
  "prompt": "!alice_base, school uniform, smile",
  "uc": "ganyu (genshin impact), goat horns"
}
```

Optional `promptNegative` on a character. `"action": "remove"` plus `index` deletes that slot.

### `expanders` — request-level `!prefix` text replacements

If you include `"expanders"` (even `[]`), Studio **deletes every current request expander** and installs only this list. Put long/repeated blocks here. In prompts write `!prefix` only — do not paste the expander value again.

```json
{ "prefix": "alice_base", "value": "long shared appearance, hair, body" }
```

Alias: `text_replacements` (same shape). Optional `extend: true`.

### `vibes` — optional vibe-transfer ids

If present, Studio **replaces** the current vibe list with this one. Each entry is an id Studio already knows (from Reference / vibe cache), not a new upload.

```json
{ "id": "vibe-cache-id", "ie": "v4full", "strength": 0.7, "inject_text": true }
```

`ie` is the selected information-extracted encoding. Omit `vibes` to leave current vibes alone. Director **image** references (uploaded pics) are **not** in v1.

---

## Example

```json
{
  "dreamscape": "change",
  "v": 1,
  "title": "golden hour two-shot",
  "params": {
    "steps": 28,
    "guidance": 5,
    "sampler": "k_euler_ancestral",
    "noiseScheduler": "karras",
    "model": "v5",
    "resolution": "normal_portrait",
    "append_uc": 3
  },
  "expanders": [
    { "prefix": "alice_base", "value": "long shared appearance, hair, body" }
  ],
  "fields": [
    {
      "id": "prompt",
      "action": "replace",
      "chunks": [
        { "name": "Subject", "text": "1girl, looking at viewer" },
        { "name": "Lighting", "text": "sunset, golden hour" }
      ]
    },
    {
      "id": "uc",
      "action": "replace",
      "chunks": [{ "name": "Quality", "text": "blurry, lowres" }]
    }
  ],
  "characters": [
    {
      "index": 0,
      "action": "replace",
      "name": "Alice",
      "prompt": "!alice_base, school uniform, smile",
      "uc": "ganyu (genshin impact), goat horns"
    },
    {
      "index": 1,
      "action": "replace",
      "name": "Bob",
      "prompt": "bob prompt, sitting",
      "uc": "alice (name), school uniform"
    }
  ]
}
```

---

## How Yukimi applies it

1. Copy the JSON (fenced or raw).
2. Paste into Studio (the paste interceptor catches `"dreamscape": "change"` even inside a markdown fence).
3. Confirm which rows to apply.

To snapshot the current Studio as JSON: Studio context / **Copy change JSON**. That blob is the same schema, so bots can round-trip.

Helpers in the page: `window.tryApplyStudioChangeJsonFromText(text)`, `window.openStudioChangeExportDialog()`, `window.STUDIO_CHANGE_AI_SPEC`.

---

## Compact AI spec (keep in sync with `STUDIO_CHANGE_AI_SPEC`)

```
Dreamscape studio change JSON. Paste into Studio to apply. Reply with JSON only — no markdown unless fenced as json.

{"dreamscape":"change","v":1,"title":"short name",
 "params":{"steps":28,"guidance":5,"sampler":"k_euler_ancestral","noiseScheduler":"karras","model":"v5","resolution":"normal_portrait","append_uc":3},
 "expanders":[{"prefix":"alice_base","value":"long shared appearance, hair, body"}],
 "fields":[
   {"id":"prompt","action":"replace","chunks":[
     {"name":"Subject","text":"1girl, looking at viewer"},
     {"name":"Lighting","text":"sunset, golden hour"}
   ]},
   {"id":"uc","action":"replace","chunks":[{"name":"Quality","text":"blurry, lowres"}]}
 ],
 "characters":[
   {"index":0,"action":"replace","name":"Alice","prompt":"!alice_base, school uniform, smile","uc":"nude"},
   {"index":1,"action":"replace","name":"Bob","prompt":"bob prompt","uc":"alice (name)"}
 ],
 "vibes":[{"id":"vibe-id","ie":"v4full","strength":0.7,"inject_text":true}]}

Rules:
- characters: ALWAYS replace + index. NEVER add. index 0 = first slot, index 1 = second. add+index is illegal (treated as replace). Do not copy slot 0 into slot 1.
- fields = prompt | uc | promptNegative only. Always replace. Named chunks are your groups, not comma-splits. Never character:N:... ids.
- expanders: if present, DELETE all request expanders and install only this list. In text use !prefix. Do not repeat expander values.
- vibes: if present, REPLACE current vibe transfers with this id list (ids Studio already has). Omit to leave vibes unchanged. No image uploads.
- Default action is replace. remove = delete a span or slot. Omit unused keys. Only include params you want to change.
- Named resolution preset (e.g. normal_portrait): omit width/height. Custom size: resolution "custom" plus width and height.
```
