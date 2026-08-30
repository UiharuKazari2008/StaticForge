# Dreamscape MCP tool flow (Grok)

How to use the public MCP connector for common Studio jobs. Prompt syntax still comes from [nai-prompt-guide `prompt-optimiser-grok.md`](https://yozora.bluesteel.737.jp.net/DreamScape/nai-prompt-guide/src/branch/main/prompt-optimiser-grok.md). Delivery to Studio is Change-JSON (`docs/studio-change-json.md`). This file is only the **tool order**.

The MCP `initialize` result also sends these rules as `instructions`. `tools/list` is the **Grok core** catalog plus `advanced_tools`. Do **not** page a directory listing to find a known filename. Do **not** download the original PNG. `get_generated_image` always returns metadata plus a Grok-sized webp. Omit filename for the newest file. `workspace` / `default` is the default workspace.

If a listed tool cannot do the job, call `advanced_tools` with `query`, then call it again with `name` + `arguments` to run that hidden tool (bind a second tab, page `get_images`, static wiki, references, extra note/preset actions).

If a tool 429s, read `error.data.group` and `error.data.retryAfter` (seconds). Wait that long. Handshake (`initialize` / `ping` / `tools/list`) is unlimited.

## Rate groups

| Group | Limit / 15 min | Tools |
|---|---|---|
| `free` | none | lists, bind, note/preset/wiki index reads |
| `search` | 240 | autofill, wiki pages, OmegaSearch |
| `gallery` | 90 | `get_generated_image` (and hidden `get_images` / `get_latest_image` via `advanced_tools`) |
| `write` | 60 | save note/preset, upload reference |
| `studio` | 60 | `get_studio_state`, `apply_studio_changes`, `apply_preset_to_studio` |
| `generate` | 20 | `generate_image`, `generate_preset`, `upscale_image`, `expand_image` |

## Studio bind

`get_studio_state` and `apply_studio_changes` auto-bind when exactly one Studio tab is connected. Several tabs: `advanced_tools` `{ "query": "bind" }` then run `bind_session`. Server-side `generate_image` does not need a bind.

## Recipe: image in a specific workspace

User: *find the latest / this file in Character Studies*

1. `get_workspaces` — match the display name to an id
2. Known file: `get_generated_image` `{ "filename": "…png", "workspace": "<id>" }`
3. Latest in that folder: `get_generated_image` `{ "workspace": "<id>" }` (omit filename)
4. Hunt by prompt: `omegasearch` `{ "query": "…", "workspace": "<id>" }` then `get_generated_image`

## Recipe: take this and make it a preset

User: *take this and make it a preset*

1. `get_generated_image` (filename / latest) or `get_studio_state` if “this” is the open tab
2. `save_preset` `{ "presetName": "…", "config": { "name": "…", "prompt": "…", "model": "…" } }` using metadata / Studio fields
3. To drop it on Studio later: `apply_preset_to_studio`

## Recipe: current Studio prompt vs the generated image

User: *take a look at my current prompt in the studio and compare the generated image for prompt cohesion*

1. `get_studio_state` (auto-binds a single tab) — read `change` and `filename`
3. If `filename` is set: **one** `get_generated_image` with that basename. If null, the editor has no open file — say so; do not page the gallery.
4. Compare image to the Change-JSON: missing tags, extra elements, V5 complexity / guidance / character-box bleed.
5. Reply with a Change-JSON rewrite (or `apply_studio_changes` if they asked you to put it in Studio). Do not invent unsolved V5 body recipes.

## Recipe: change the last / open image (shorter, younger, outfit, …)

User: *can you update the last image to be shorter and younger*

Age-down that reads as under 18 is **refuse** (see the Grok optimiser). Adult-presenting shorter / younger is tag work in the **character box**, not a new generate API.

1. `get_studio_state`
2. Filename: use `state.filename`. If null, `get_generated_image` with no filename (newest in the workspace).
4. `get_generated_image` with that filename (metadata + webp)
5. Rewrite boxes/fields per the V5 guide. Keep seed with `params.seed: "last"` + `seedLock: true` if they want the same composition; unlock if they want a variation.
6. `apply_studio_changes` with the Change-JSON. Set `autoGenerate: true` only if they asked to generate now.

Example Change-JSON (shape only — fill from the snapshot):

```json
{
  "dreamscape": "change",
  "v": 1,
  "title": "shorter younger adult",
  "params": { "seed": "last", "seedLock": true },
  "characters": [
    {
      "action": "replace",
      "index": 0,
      "prompt": "short, youthful adult, …"
    }
  ]
}
```

Characters are always `action: replace` + `index`. Never `add`.

## Recipe: known gallery filename (no Studio)

User: *look at `1782…_generated_….png` in the default workspace*

1. `get_generated_image` `{ "filename": "1782…_generated_….png" }`
2. Stop. Metadata + webp is enough for a V5 recommendation.

## Recipe: write the rewrite into Studio and generate

1. Bind
2. Build Change-JSON from `get_studio_state` + optimiser rules
3. `apply_studio_changes` `{ "change": {…}, "autoApply": true, "autoGenerate": true }`
4. `autoGenerate` clicks the bound tab's Generate button. Do not also call `generate_image` unless they asked for a **server-side** run (different session).
