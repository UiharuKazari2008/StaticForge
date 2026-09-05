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
  "vibes": [],
  "dynamicGeneration": {},
  "director": {},
  "vSlider": []
}
```

### `params` — only include values to change

| Key | Type | Notes |
|-----|------|--------|
| `steps` | number | Typical 23–28 |
| `guidance` | number | CFG / prompt guidance, typical 5 |
| `rescale` | number | CFG rescale 0–1 |
| `sampler` | string | `k_euler_ancestral` (Euler Ancestral), `k_dpmpp_sde`, `k_dpmpp_2m`, `k_dpmpp_2m_sde`, `k_euler`, `k_dpmpp_2s_ancestral` |
| `noiseScheduler` | string | `karras`, `exponential`, `polyexponential` |
| `model` | string | e.g. `"v5"`. Live ids: MCP `get_studio_state.settings.models` |
| `seed` | string or number | Specific seed, or `"last"` to lock the last used seed (same as `seedLock: true`). Copy / `GET /agent/session/state` echo the **actual seed that was used**, not a filename. |
| `seedLock` | boolean | `true` locks the last used seed via the existing Studio sprout control (Ivory A/B). `false` unlocks so the next generate rolls a new variation. Omit to leave lock state alone. No new chrome. |
| `resolution` | string | Named preset (`normal_portrait`=832×1216, `normal_landscape`=1216×832, `normal_square`=1024×1024, `small_*`, `large_*`, `xlarge_*`, `wallpaper_*`). **Omit `width`/`height` when using a named preset.** Custom size: `"custom"` plus `width` and `height`. Live px sizes: `settings.resolutions`. |
| `width` | number | Only with `"resolution": "custom"` |
| `height` | number | Only with `"resolution": "custom"` |
| `variety` | boolean | Variety+ (model-dependent) |
| `upscale` | boolean | Request 2× upscale after generate |
| `strength` | number | img2img strength 0–1 (only if Studio is already in a strength-capable mode) |
| `noise` | number | img2img noise 0–1 |
| `append_quality` | boolean | Quality preset on/off. **Prefer this over pasting the quality string.** If you need to edit those tags, set false and put the edited string in `prompt`. Live text (per model) is in MCP `get_studio_state.settings.quality` / `tools/list`. |
| `append_uc` | number | `0` None, `1` Human Focus, `2` Light, `3` Heavy, `4` Curated, `5` Furry Focus. **Prefer the id.** If you need to edit that UC, set `0` and put the edited string in `uc`. Live text is in `settings.uc`. |
| `append_transparency` | boolean | Transparency preset on/off. Server prepends "transparent background". Do not also add that tag by hand. |
| `nsfw` | number | `3` Nude, `2` Skimpy, `1` Allow, `0` Neutral, `-1` Remove, `-2` Clense. Sets the Studio NSFW dropdown. Same as `dataset_config.nsfw` or top-level `nsfw` on MCP `apply_studio_changes`. **Prefer the id.** Do not also paste that level's add/remove tags. Live strings are in `settings.nsfw`. |
| `n` | number | Studio prints count 1–8 (`#manualPrintsCount`). On `generate_image` this is server copies; on `apply_studio_changes` / autoGenerate it is the Studio input. |
| `normalize_vibes` | boolean | Vibe normalize toggle (`#vibeNormalizeToggle`). |
| `use_coords` | boolean | `true` = use character coords (Auto Position **off**). `false` = Auto Position on. Also implied when `characters[].position` is set. |
| `save_base_output` | boolean | Save stage 0 / base output (`#saveStage0Btn`). |
| `skip_pipeline_stages` | boolean | `true` skips pipeline stage generation (Enable stages **off**). |
| `nsfw_bias` | number | NSFW preset bias (typical `1.0`). Same as `dataset_config.nsfw_bias`. |
| `quality_preset_bias` | number | Quality preset bias (typical `1.0`). |
| `transparency_bias` | number | Transparency preset bias (typical `1.0`). |
| `keep_newlines` | boolean | Keep prompt newlines. |
| `auto_char_numerize` | boolean | Auto character numerize. |
| `prompt_normalize` | boolean | Prompt normalize. |
| `deduplicate_tags` | boolean | Deduplicate tags. |
| `auto_clean_uc` | boolean | Auto-clean UC phrases that also appear in the prompt. |

### `dataset_config` — optional object (top-level or `params.dataset_config`)

Echoed by `GET /agent/session/state` / `get_studio_state`. `include` **replaces** the selected dataset list (it does not toggle). Omit `include` to leave the current list.

| Key | Type | Notes |
|-----|------|--------|
| `nsfw` | number | Same as `params.nsfw`. |
| `nsfw_bias` | number | Same as `params.nsfw_bias`. |
| `include` | string[] | Selected dataset ids. Replaces the current list. |
| `bias` | object | Per-dataset bias map (`{ "ds_id": 1.2 }`). |
| `settings` | object | Nested `{ [datasetValue]: { [settingId]: { enabled, bias, value } } }`. Quality no-text: `settings.__quality__.no_text.enabled` `false` for in-image text; keep `append_quality` on. |

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

### `vSlider` — optional intensity widgets

Optional array. Studio shows **one** tool window with a scrolling list of cards. Drag/select is preview; **Generate** applies live blends into request expanders without removing widgets. **Finalise** permanently bakes the resolved text into the prompt (replaces `!prefix`), removes that expander, and deletes the widget from the catalog. Studio can also author widgets via the vSlider editor. Catalog + values persist as `forge_data.vSlider` and are echoed by Copy change JSON and `GET /agent/session/state`.

| `kind` | Control | Blend |
|--------|---------|-------|
| `slider` | 1 axis, `glass-slider` | yes |
| `xypad` | 2 axes | yes, per axis |
| `star` | 2–8 axes, spokes | yes, per axis |
| `dropdown` | custom-dropdown | no — one option `text` |

`slider` ≠1 axis, `xypad` ≠2, and `star` &lt;2 are ignored. Star default is a regular N-gon at each axis median.

Between catalog stops, emit **both** adjacent texts as NovelAI emphasis:

```
t = (value - at_i) / (at_{i+1} - at_i)
N_left  = round(1 + (1-t) * 0.5, 2)
N_right = round(1 + t * 0.5, 2)
```

Exact stop = that `text` only (no `N::` wrapper). Omit a block when `N <= 1.02`. Nearer stop gets higher N (1.0–1.5). Each xypad/star axis blends into its own target. Do not hang this mixer on Weight Rack. Do not write Phasewalker `_P` / `_N` expanders.

Axes need `stops[{at,text}]` and a required `default` (median stop unless the request justifies a bias). Dropdown `default` is an option `id`. `commit` is `"expander"` (default) or `"prompt"`. Confirm dialog: one row **Install vSlider widgets**.

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

### `dynamicGeneration` — optional Enshutsuka dynagen

Enable or configure the **existing** Studio dynamic-generation toggle (no new chrome). Echoed by `GET /agent/session/state` and MCP `get_studio_state`. A dynagen-only payload is still a change (`dreamscape:"change"`). If this object is present on a Studio snapshot or gallery image (`forge_data.dynamic_generation`), Grok **must integrate and act**.

| Key | Type | Notes |
|-----|------|--------|
| `enabled` | boolean | Open / close `#dynamicGenerationGroup` |
| `cacheLocked` / `contextLocked` | boolean | Freeze Changes / Freeze Context |
| `tod` / `weather` / `season` | string, `true` (auto), or `false`/`null` (off) | Existing carousel buttons |
| `location` | string | Weather button `data-location` |
| `directive` | string | Creative directive textarea |
| `force_strategy` / `tool_passes` / `dialogs_count` | string / number | Existing carousel dataset |

### `director` — optional attached director prompt

`{ sessionId, messageId, prompt }` on the existing Director button + creative directive. Same must-act rule as `dynamicGeneration`. Image chaining is out of scope.

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
and `POST /agent/session/studio`. MCP `apply_studio_changes` / `generate_image` accept the same keys **top-level** or inside `params` / `change` — they are assembled into this object before apply. See [client-api/agent-session.md](./client-api/agent-session.md).


---

## Compact AI spec (keep in sync with `STUDIO_CHANGE_AI_SPEC`)

```
Dreamscape studio change JSON. Paste into Studio to apply. Reply with JSON only — no markdown unless fenced as json.

{"dreamscape":"change","v":1,"title":"short name",
 "params":{"steps":28,"guidance":5,"sampler":"k_euler_ancestral","noiseScheduler":"karras","model":"v5","resolution":"normal_portrait","append_uc":3,"nsfw":3},
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
 "vibes":[{"id":"vibe-id","ie":"v4full","strength":0.7,"inject_text":true}],
 "vSlider":[{"id":"body_weight","kind":"slider","commit":"expander","value":{"weight":0.55},"axes":[{"id":"weight","default":0.55,"target":{"kind":"expander","prefix":"body"},"stops":[{"at":0,"text":"skinny"},{"at":0.55,"text":"slightly chubby"},{"at":1,"text":"fat"}]}]}]}

Rules:
- characters: ALWAYS replace + index. NEVER add. index 0 = first slot, index 1 = second. add+index is illegal (treated as replace). Do not copy slot 0 into slot 1.
- Optional per-character position: {x,y} and/or cell A1–E5 (maps to Studio slot dataset / existing position dialog / V5 freeform tool). Echoed by GET /agent/session/state. Omit if unused. No new chrome.
- fields = prompt | uc | promptNegative only. Always replace. Named chunks are your groups, not comma-splits. Never character:N:... ids.
- expanders: if present, DELETE all request expanders and install only this list. In text use !prefix. Do not repeat expander values.
- vibes: if present, REPLACE current vibe transfers with this id list (ids Studio already has). Omit to leave vibes unchanged. No image uploads.
- Default action is replace. remove = delete a span or slot. Omit unused keys. Only include params you want to change.
- params.nsfw: 3 Nude, 2 Skimpy, 1 Allow, 0 Neutral, -1 Remove, -2 Clense. Prefer the id over pasting that level's add/remove tags. dataset_config.nsfw is the same field.
- params.append_transparency / n / normalize_vibes / use_coords / save_base_output / skip_pipeline_stages / keep_newlines / auto_char_numerize / prompt_normalize / deduplicate_tags / auto_clean_uc: existing Studio toggles. n is Studio prints (1–8). use_coords true = Auto Position off.
- dataset_config: include (replace list), bias, settings (e.g. settings.__quality__.no_text.enabled false for in-image text; keep append_quality on), nsfw, nsfw_bias. Echoed on GET /agent/session/state.
- Named resolution preset (e.g. normal_portrait): omit width/height. Custom size: resolution "custom" plus width and height.
- params.seed: specific seed (number). params.seedLock: true locks the last used seed (existing Studio sprout). seed: "last" is the same as seedLock: true. Unlock (seedLock: false) rolls a new variation. Copy change JSON and GET /agent/session/state echo the actual seed used plus seedLock. Filename is not a contract.
- Optional dynamicGeneration: {enabled, cacheLocked, contextLocked, location, tod, weather, season, directive, force_strategy, tool_passes, dialogs_count}. Enable/configure Enshutsuka dynamic generation on the existing Studio toggle (no new chrome). Echoed by GET /agent/session/state. If present on a read image or Studio snapshot, integrate and act — do not ignore it.
- Optional director: {sessionId, messageId, prompt}. Attached director prompt / session on the existing Director button + creative directive. Same must-act rule.
- Optional vSlider: array of widgets; Studio shows one scrolling tool. kind: slider (1 axis) | xypad (2) | star (2+) | dropdown (named presets). Axes: stops[{at,text}] + required default (median stop unless the request justifies a bias). Between stops: emit BOTH adjacent texts as NovelAI emphasis N::text:: (nearer = higher N, 1.0-1.5). Exact stop = that text only, no wrapper. This is how intensity slides. dropdown: options[{id,label,text}] fill the target expander. Use for scenes/presets to evaluate. No blend. commit expander (default) or prompt. Generate/compile applies live slider values into expanders without removing widgets. Finalise bakes resolved text into the prompt (replaces !prefix), removes that expander, and deletes the widget from the catalog. Studio can author widgets via the vSlider editor. Echoed in forge_data.vSlider and GET /agent/session/state.
```
