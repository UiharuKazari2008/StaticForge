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
| `seed` | string or number | Specific seed, or `"last"` to lock the last used seed (same as `seedLock: true`). Copy / `GET /agent/session/state` echo the **actual seed that was used**, not a filename. |
| `seedLock` | boolean | `true` locks the last used seed via the existing Studio sprout control (Ivory A/B). `false` unlocks so the next generate rolls a new variation. Omit to leave lock state alone. No new chrome. |
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
  "uc": "ganyu (genshin impact), goat horns",
  "position": { "x": 0.3, "y": 0.1, "cell": "B1" }
}
```

Optional `promptNegative` on a character. `"action": "remove"` plus `index` deletes that slot.

Optional `position` maps to the existing Studio slot dataset (`positionX` / `positionY` / `positionCell`) used by the A1–E5 position dialog and the V5 freeform centers tool. No new chrome.

| Shape | Notes |
|-------|--------|
| `{ "x": 0.3, "y": 0.1 }` | Normalized center (same as NovelAI `center`). |
| `{ "cell": "B1" }` | Grid cell A1–E5 (x/y derived). |
| `"B1"` | Same as `{ "cell": "B1" }`. |
| `{ "x": 0.3, "y": 0.1, "cell": "B1" }` | x/y win; `cell` is a label when it matches the 5×5 grid. |

`center: { x, y }` is accepted as an alias. Omit `position` to leave the slot’s current placement alone. `GET /agent/session/state` echoes `position` when the slot has stored coords. Applying a position turns Auto Position off so generate uses those centers.

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
      "uc": "ganyu (genshin impact), goat horns",
      "position": { "x": 0.3, "y": 0.1, "cell": "B1" }
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

Helpers in the page: `window.tryApplyStudioChangeJsonFromText(text)`, `window.openStudioChangeExportDialog()`, `window.buildStudioChangeSnapshot()`, `window.STUDIO_CHANGE_AI_SPEC`.

Loopback agents: `GET /agent/session/state` returns the current editor as this
same JSON in `change` (ungenerated / no open image is valid). Rewrite `change`
and `POST /agent/session/studio`. See [client-api/agent-session.md](./client-api/agent-session.md).


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
   {"index":0,"action":"replace","name":"Alice","prompt":"!alice_base, school uniform, smile","uc":"nude","position":{"x":0.3,"y":0.1,"cell":"B1"}},
   {"index":1,"action":"replace","name":"Bob","prompt":"bob prompt","uc":"alice (name)"}
 ],
 "vibes":[{"id":"vibe-id","ie":"v4full","strength":0.7,"inject_text":true}]}

Rules:
- characters: ALWAYS replace + index. NEVER add. index 0 = first slot, index 1 = second. add+index is illegal (treated as replace). Do not copy slot 0 into slot 1.
- Optional per-character position: {x,y} and/or cell A1–E5 (maps to Studio slot dataset / existing position dialog / V5 freeform tool). Echoed by GET /agent/session/state. Omit if unused. No new chrome.
- fields = prompt | uc | promptNegative only. Always replace. Named chunks are your groups, not comma-splits. Never character:N:... ids.
- expanders: if present, DELETE all request expanders and install only this list. In text use !prefix. Do not repeat expander values.
- vibes: if present, REPLACE current vibe transfers with this id list (ids Studio already has). Omit to leave vibes unchanged. No image uploads.
- Default action is replace. remove = delete a span or slot. Omit unused keys. Only include params you want to change.
- Named resolution preset (e.g. normal_portrait): omit width/height. Custom size: resolution "custom" plus width and height.
- params.seed: specific seed (number). params.seedLock: true locks the last used seed (existing Studio sprout). seed: "last" is the same as seedLock: true. Unlock (seedLock: false) rolls a new variation. Copy change JSON and GET /agent/session/state echo the actual seed used plus seedLock. Filename is not a contract.
```
