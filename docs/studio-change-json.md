# Studio change JSON

Stable contract so other bots (Hoshino, Sala, Frost, Grok, …) can hand Yukimi a **JSON blob** instead of “copy this and replace your prompts and UCs”.

Yukimi pastes the blob into Dreamscape Studio (or any prompt textarea). Studio parses it, shows a confirm dialog, and applies the selected fields.

In-app copy of this spec: Studio → **Copy change JSON** → **Copy AI spec**, or `window.STUDIO_CHANGE_AI_SPEC`.
Source of truth for the rules: this file. Keep `STUDIO_CHANGE_AI_SPEC` in `public/scripts/comp/studioChangeJson.js` in sync.

---

## How to emit

Reply with JSON only — no markdown unless fenced as `json`. One object. Omit keys you are not changing. A params-only object is a valid change (`model`, `steps`, `guidance`, `sampler`, and the other param keys). Those keys belong in `params`. The apply API also accepts them as siblings on the change object and moves them into `params`.

Discriminators Studio accepts:

| Field | Required | Allowed values |
|-------|----------|----------------|
| `dreamscape` | yes (preferred) | `"change"` |
| `type` / `kind` | alternate | `"dreamscape-change"` or `"studio-change"` |
| `v` | yes | `1` |
| `title` | no | short name shown on the apply dialog / desktop shortcut |
| `presetName` | no | Studio name field (`#manualPresetName`). This is the file label between the timestamp and the seed. Set it when the concept changes. Echoed by `GET /agent/session/state`. |

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
  "vSlider": [],
  "preciseReferences": [],
  "workspace": "default",
  "gensoLocks": [],
  "tokens": {}
}
```

### `params` — only include values to change

| Key | Type | Notes |
|-----|------|--------|
| `steps` | number | Typical 23–28 |
| `guidance` | number | CFG / prompt guidance, typical 5. Note: `0` remaps to `5.5` on the server; use `0.001` for near-zero CFG. |
| `rescale` | number | CFG rescale 0–1 |
| `sampler` | string | `k_euler_ancestral` (Euler Ancestral), `k_dpmpp_sde`, `k_dpmpp_2m`, `k_dpmpp_2m_sde`, `k_euler`, `k_dpmpp_2s_ancestral` |
| `noiseScheduler` | string | `karras`, `exponential`, `polyexponential` |
| `model` | string | e.g. `"v5"`. Live ids: MCP `get_studio_state.settings.models` |
| `effort` | string | V5 Full only. `high` (default) or `medium`. Medium uses `nai-diffusion-5-full-medium` (inpaint: `nai-diffusion-5-full-medium-inpainting`). Steps lock to 14, sampler locks to Euler Ancestral, undesired content locks to the heavy preset, and prompt guidance rescale is off. Guidance still applies. |
| `seed` | string or number | Specific seed, or `"last"` to lock the last used seed (same as `seedLock: true`). Copy / `GET /agent/session/state` echo the **actual seed that was used**, not a filename. |
| `seedLock` | boolean | `true` locks the last used seed via the existing Studio sprout control (Ivory A/B). `false` unlocks so the next generate rolls a new variation. Omit to leave lock state alone. No new chrome. |
| `resolution` | string | Named preset (`normal_portrait`=832×1216, `normal_landscape`=1216×832, `normal_square`=1024×1024, `small_*`, `large_*`, `xlarge_*`, `wallpaper_*`). **Omit `width`/`height` when using a named preset.** Custom size: `"custom"` plus `width` and `height`. Live px sizes: `settings.resolutions`. |
| `width` | number | Only with `"resolution": "custom"` |
| `height` | number | Only with `"resolution": "custom"` |
| `variety` | boolean | Variety+ (model-dependent) |
| `upscale` | boolean | Request 2× upscale after generate |
| `strength` | number | img2img strength 0–1 (only if Studio is already in a strength-capable mode) |
| `noise` | number | img2img noise 0–1 |
| `image_bias` | number or object | Base-image crop bias. `0`–`4` preset (`0` top/left, `2` center, `4` bottom/right) or custom `{x, y, scale, rotate}` (same as the bias adjustment dialog). Applies only with a base image loaded, and is skipped while a mask exists (the editor would ask before discarding it). Echoed only when a base image is loaded. |
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
| `bake_newlines` | boolean | Bake newlines into the NovelAI request (requires `keep_newlines`; when true, server skips newline-destroying normalisation). |
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

### `text_overlays` — optional array

On-image speech, thought, and captions. Each row is `{text, type, target, stages, disabled}`. When present, including `[]`, it **replaces** the Studio text list (`loadTextOverlays`). Snapshots (Copy change JSON, `GET /agent/session/state`) echo the current list. Do not also paste `Text:` into the prompt. Several lines on the same target belong in one row, separated by a blank line. They compile to one `Text:` with the type tags written once in front. A second row on that target is joined the same way, so it does not open another `Text:`. Separate bubbles in different places are character slots: the line in double quotes, a blank line, a placement phrase (`on the left,` / `on the right,`), and `position` `{x, y}`. The full script stays in the one overlay. Judge a print against the compiled prompt; edit this array and the input prompt.

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

Shorthand also accepted: top-level `"prompt"` / `"uc"` / `"promptNegative"` as a string (treated as full replace). An empty string (`"promptNegative": ""`), or a replace whose only chunk text is empty, clears that field. Omit the key to leave it alone.

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

Optional `promptNegative` on a character. An empty string on `prompt`, `uc`, or `promptNegative` clears that part of the slot; omit the key to leave it. Optional `enabled: false` turns that slot’s existing enable toggle off, and snapshots echo `enabled: false` for a slot that is off. `"action": "remove"` plus `index` deletes that slot.

`overwrite: true` (or sending `characterPrompts` instead of `characters`) treats the list as the full roster: slots that are not in the list are removed, then the list is written, including empty prompt text. `read_image_metadata` sets this. `center` is accepted as `position`. Expander `stages` are kept when present.

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

Between catalog stops, emit **both** adjacent texts as a NovelAI emphasis crossfade — leaving stop **de**-emphasised, approaching stop **over**-emphasised (not both over):

```
t = (value - at_i) / (at_{i+1} - at_i)
N_left  = round(1 - t * 0.5, 2)   // 1.00 → 0.50 (start / leaving)
N_right = round(1 + t * 0.5, 2)   // 1.00 → 1.50 (end / approaching)
```

Example mid (`t = 0.5`): `0.75::skinny::, 1.25::slightly chubby::`.

Exact stop = that `text` only (no `N::` wrapper). Omit left when `N >= 0.98`, omit right when `N <= 1.02`. Each xypad/star axis blends into its own target. Do not hang this mixer on Weight Rack. Do not write Phasewalker `_P` / `_N` expanders.

Axes need `stops[{at,text}]` and a required `default` (median stop unless the request justifies a bias). Dropdown `default` is an option `id`. `commit` is `"expander"` (default) or `"prompt"`. Confirm dialog: one row **Install vSlider widgets**.

### `expanders` — request-level `!prefix` text replacements

If you include `"expanders"` (even `[]`), Studio **replaces every current request expander** and installs only this list with full bodies (not an ambiguous append). Put long/repeated blocks here. In prompts write `!prefix` only — do not paste the expander value again.

```json
{ "prefix": "alice_base", "value": "long shared appearance, hair, body" }
```

Alias: `text_replacements` (same shape). Optional `extend: true`.

### `vibes` — optional vibe-transfer ids

If present, Studio **replaces** the current vibe list with this one. Each entry is an id Studio already knows (from Reference / vibe cache), not a new upload.

```json
{ "id": "vibe-cache-id", "ie": "v4full", "strength": 0.7, "inject_text": true }
```

`ie` is the selected information-extracted encoding. Omit `vibes` to leave current vibes alone. A snapshot may add `preview` (`/cache/preview/…`) so the picture can be opened. V5 does not run vibe transfer yet. Do not send `preview` back on apply.

### `preciseReferences` — tune attached references

Studio precise references (the character / style pictures on the reference row). Echoed only when one is attached; a disabled row echoes `enabled: false`.

```json
{ "source": "cache:hash", "type": 1, "role": "character and style", "strength": 1, "fidelity": 1, "enabled": true, "preview": "/cache/preview/hash.webp" }
```

`role` is `character`, `style`, or `character and style` (`type` 2, 3, or 1). `preview` is a host image URL and is ignored on apply.

On apply, each entry updates a reference **already attached** in Studio: matched by `source`, else by list index. `strength` / `fidelity` (0–1), `type` or `role`, and `enabled` are written to the existing row controls. It never attaches a new reference; an entry with no match is skipped. Look at the picture, then write what it was holding into the prompt.

### `dynamicGeneration` — optional Enshutsuka dynagen

Enable or configure the **existing** Studio dynamic-generation toggle (no new chrome). Echoed by `GET /agent/session/state` and MCP `get_studio_state`. A dynagen-only payload is still a change (`dreamscape:"change"`). If this object is present on a Studio snapshot or gallery image (`forge_data.dynamic_generation`), Grok **must integrate and act**.

| Key | Type | Notes |
|-----|------|--------|
| `enabled` | boolean | Open / close `#dynamicGenerationGroup` |
| `cacheLocked` / `contextLocked` | boolean | Freeze Changes / Freeze Context |
| `tod` / `weather` / `season` | string, `true` (auto), or `false`/`null` (off) | Existing carousel buttons |
| `location` | string | Weather button `data-location` |
| `directive` | string | Creative directive textarea |
| `force_strategy` / `tool_passes` / `dialogs_count` | string / number | Existing carousel dataset (legacy Grok knobs; Wren ignores them) |
| `integrated` | boolean | Write-only. `true` says you already baked the resolved scene into prompt/uc/characters/expanders. Studio stamps `compiled_prompt` as agent-integrated, so its next Generate does not ask Wren again. |
| `creative` | boolean | Rentan creative button (`#creativeBtn`) on/off, with the same side effects as clicking it |
| `creative_clothing` / `creative_action` | boolean | Creative button context-menu toggles (clothing / action) |
| `creative_level` | `light` \| `medium` \| `high` | Creative menu Creativity level (default `medium`; `high` may reframe the shot and move the location) |
| `novel` | boolean or object | Novel button. `true`/`false`, or `{ enabled, tone, style, explicitness, persuasiveness, auto_generate }`. Enable is refused (left off) until there is a creative directive or a loaded novel — send `directive` in the same object. Does not open the Novel editor window. |

Read-only on the snapshot: `baked` (true when Studio's `compiled_prompt` is agent-integrated, Freeze Changes is on, or the Wren cache has not expired) and `bakedUntil` (ISO expiry). While `enabled` is true and `baked` is not, MCP `print_studio` and `apply_studio_changes` `autoGenerate` return `needsIntegration`.

**Rentan scene expanders.** The resolved scene lives in `expanders` whose prefix starts with `dg_` (`dg_time`, `dg_weather`, `dg_season`, `dg_holiday`, `dg_scene`), referenced as `!dg_weather` in the prompt or a character. Wren owns every `dg_` entry: a resolve replaces all of them and leaves your other expanders alone. A human Studio Generate with Rentan on and a stale scene asks Wren in a hidden per-workspace Director chat (thought clouds in the progress overlay), rewrites the request, and mirrors the result back onto Studio as one Change JSON (`expanders`, `prompt`, `uc`, `characters`). The scene is reused until the same expiry as before (time period, weather, cloud cover, temperature), until a `dg_` expander is removed or edited or its `!dg_` token leaves the prompt, or until the Rentan toggles or directive change. Other prompt edits keep the scene. Wren gets the full visible context (period lighting/atmosphere/UC tables with weights, sun phase, sky, cloud, wind, precipitation, recent weather, season guidelines, holiday, clothing options) plus one rule line per control (time of day, weather, season, holiday, guidance, clothing, action, creative, optimize, lock subject). The stamp keeps `compiled_prompt.controls`; flipping one starts a turn whose reason names it (`Rentan controls changed: action on`). When Wren edits the prompt, UC, or character prompts, `compiled_prompt.original_input` keeps the text from before (with any new `!dg_` tokens added) until you edit the prompt yourself; the carousel menu's **Restore Input Prompt** puts it back. Creative (every level) may also tighten the prompt, fix tags that fight the context, and turn non-visual text into visible tags. The carousel menu's **Open session in Director** opens that chat.

Prints with this stamp say `forge_data.software: "StaticForge v1.1"`. `v1.0` prints carry Tendai (`compiled_prompt.text_replacements` with `select_text`). Upscales and edits keep the file's version. Loading a `v1.0` print with Freeze Changes on replays its Tendai; otherwise Wren re-resolves the scene.

### `director` — optional attached director prompt

`{ sessionId, messageId, prompt }` on the existing Director button + creative directive. Same must-act rule as `dynamicGeneration`. Image chaining is out of scope.

### `workspace` — optional string

Studio workspace by id or name (case-insensitive). Applied **first**, then the rest of the change. Same as picking it in the Studio workspace dropdown: it switches the app's active workspace. An unknown name is skipped. `GET /agent/session/state` echoes the current workspace id. Copy JSON does not include it, so pasting a copy never switches workspaces.

### `gensoLocks` — optional boolean or string[]

Genso (expander seed) locks from the previous generation or loaded image. `true` locks every lockable seed, `false` unlocks all, and an array of keys (`["outfit"]` or `["!outfit"]`) locks exactly those and unlocks the rest. No seeds means nothing to lock. `GET /agent/session/state` echoes `gensoLocks` (locked keys) and `gensoAvailable` (lockable keys) when seeds exist; do not send `gensoAvailable` back.

### `tokens` — echoed on read

Studio adds this when it snapshots the editor. Do not send it on apply.

| Key | Notes |
|-----|--------|
| `model` / `tokenizer` | Open Studio model and its tokenizer (`qwen` on V5, `t5` on V4) |
| `limit` | Hard token cap from `config/model-features.json` |
| `recommended` | Soft budget (`recommendedTokens`, about 75% of `limit`) |
| `prompt` / `uc` | `editable`, `nonEditable` (quality, UC preset, expanders), `total` |
| `ofLimit` / `ofRecommended` | Floats. `1` means the whole budget. Percents are `percentOfLimit` / `percentOfRecommended` |

`count_prompt_tokens` counts text that is not in the editor yet. `change.tokens` is the live Studio total.

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
- characters: ALWAYS replace + index. NEVER add. index 0 = first slot, index 1 = second. add+index is illegal (treated as replace). Do not copy slot 0 into slot 1. The key is `characters`. `characterPrompts` is accepted as that same list. `center` is `position`.
- `overwrite: true`: `characters` is the whole roster. Slots that are not in the list are removed, then the list is written. `read_image_metadata` sets this so applying `change` restores that print. `text_overlays`, `expanders`, `vibes`, and `vSlider` already replace their lists when the key is present, including `[]`.
- Optional per-character position: {x,y} and/or cell A1–E5 (maps to Studio slot dataset / existing position dialog / V5 freeform tool). Echoed by GET /agent/session/state. Omit if unused. No new chrome.
- fields = prompt | uc | promptNegative only. Always replace. Named chunks are your groups, not comma-splits. Never character:N:... ids.
- Clearing: "" on a base prompt / uc / promptNegative, or on a character's prompt / uc / promptNegative, empties that field. Omit the key to leave it.
- expanders: if present, REPLACE all request expanders and install only this list with full bodies (not an ambiguous append). In text use !prefix. Do not repeat expander values.
- vibes: if present, REPLACE current vibe transfers with this id list (ids Studio already has). Omit to leave vibes unchanged. No image uploads.
- Default action is replace. remove = delete a span or slot. Omit unused keys. Only include params you want to change.
- params.nsfw: 3 Nude, 2 Skimpy, 1 Allow, 0 Neutral, -1 Remove, -2 Clense. Prefer the id over pasting that level's add/remove tags. dataset_config.nsfw is the same field.
- params.append_transparency / n / normalize_vibes / use_coords / save_base_output / skip_pipeline_stages / keep_newlines / bake_newlines / auto_char_numerize / prompt_normalize / deduplicate_tags / auto_clean_uc: existing Studio toggles. n is Studio prints (1–8). use_coords true = Auto Position off.
- dataset_config: include (replace list), bias, settings (e.g. settings.__quality__.no_text.enabled false for in-image text; keep append_quality on), nsfw, nsfw_bias. Echoed on GET /agent/session/state. Omit include (do not send include:[]) to leave the current dataset list.
- text_overlays: replaces the Studio text list. One row per target; blank line between lines; one compiled Text:. Separate bubbles are character slots with a quoted line, a placement phrase, and position. Do not also put Text: in the prompt. Judge compiled output; edit the input prompt and this array.
- Named resolution preset (e.g. normal_portrait): omit width/height. Custom size: resolution "custom" plus width and height.
- params.seed: specific seed (number). params.seedLock: true locks the last used seed (existing Studio sprout). seed: "last" is the same as seedLock: true. Unlock (seedLock: false) rolls a new variation. Copy change JSON and GET /agent/session/state echo the actual seed used plus seedLock. Filename is not a contract.
- Optional dynamicGeneration: {enabled, cacheLocked, contextLocked, location, tod, weather, season, directive, force_strategy, tool_passes, dialogs_count, creative, creative_clothing, creative_action, novel}. novel is true/false or {enabled, tone, style, explicitness, persuasiveness, auto_generate}; enabling needs a directive. Enable/configure Enshutsuka dynamic generation on the existing Studio toggle (no new chrome). Echoed by GET /agent/session/state. If present on a read image or Studio snapshot, integrate and act — do not ignore it.
- Optional director: {sessionId, messageId, prompt}. Attached director prompt / session on the existing Director button + creative directive. Same must-act rule.
- Optional params.image_bias: 0–4 preset (0 top/left, 2 center, 4 bottom/right) or {x, y, scale, rotate}. Only with a base image; skipped while a mask exists.
- Optional preciseReferences: [{source, type|role, strength, fidelity, enabled}] tunes references already attached (match source, else index). Never attaches new ones.
- Optional workspace: id or name. Switches the active workspace first.
- Optional gensoLocks: true (lock all), false (unlock all), or [keys] (lock exactly those). Echoed with gensoAvailable.
- Optional vSlider: array of widgets; Studio shows one scrolling tool. kind: slider (1 axis) | xypad (2) | star (2+) | dropdown (named presets). Axes: stops[{at,text}] + required default (median stop unless the request justifies a bias). Between stops: emit BOTH adjacent texts as NovelAI emphasis — leaving/start stop de-emphasised N=1−t·0.5 (1.0→0.5), approaching/end stop over-emphasised N=1+t·0.5 (1.0→1.5). Exact stop = that text only, no wrapper. This is how intensity slides. dropdown: options[{id,label,text}] fill the target expander. Use for scenes/presets to evaluate. No blend. commit expander (default) or prompt. Generate/compile applies live slider values into expanders without removing widgets. Finalise bakes resolved text into the prompt (replaces !prefix), removes that expander, and deletes the widget from the catalog. Studio can author widgets via the vSlider editor. Echoed in forge_data.vSlider and GET /agent/session/state.
```
