# Dreamscape MCP tool flow (Grok)

How to use the public MCP connector for common Studio jobs. Prompt syntax still comes from [nai-prompt-guide `prompt-optimiser-grok.md`](https://yozora.bluesteel.737.jp.net/DreamScape/nai-prompt-guide/src/branch/main/prompt-optimiser-grok.md). This file is only the **tool order**.

**Delivery priority** (first that works): (1) `apply_studio_changes` — default, push the rewrite into the Studio tab (`autoApply: true`; `autoGenerate: true` if they asked to generate now). (2) `generate_image` — no Studio tab / bind failed / they asked for a server-side run. (3) emit Change-JSON (`docs/studio-change-json.md`). (4) return the prompt-text block. Do not dump Positive/UC when 1 or 2 works.

**Studio edits:** on every turn that touches Studio, call `get_studio_state` first. Do not reuse a stale snapshot from earlier in the chat. Diff the current Change-JSON / fields / characters / params against the last state you saw. Keep what the user changed in the app since that message; apply only this turn's requested delta.

The MCP `initialize` result also sends these rules as `instructions`. `serverInfo.name` is `DreamScape r` plus an 8-hex tools revision (see [mcp-connector.md](./mcp-connector.md)). `tools/list` is the **Grok core** catalog plus `advanced_tools`. Do **not** page a directory listing to find a known filename. Do **not** download the original PNG. `get_generated_image` always returns metadata plus a Grok-sized webp. Omit filename for the newest file. `workspace` / `default` is the default workspace.

If a listed tool cannot do the job, call `advanced_tools` with `query`, then call it again with `name` + `arguments` to run that hidden tool (bind a second tab, page `get_images`, static wiki, references, extra note/preset actions).

If a tool 429s, read `error.data.group` and `error.data.retryAfter` (seconds). Wait that long. Handshake (`initialize` / `ping` / `tools/list`) is unlimited.

## Rate groups

| Group | Limit / 15 min | Tools |
|---|---|---|
| `free` | none | lists, bind, note/preset/wiki index reads |
| `search` | 240 | autofill, wiki pages, OmegaSearch, `evaluate_workspace_themes` |
| `gallery` | 90 | `get_generated_image`, `compare_images`, `vfs_read` (and hidden `get_images` / `get_latest_image`) |
| `write` | 60 | save note/preset, upload reference, `delete_images`, `scrap_images`, `toggle_favorite` |
| `studio` | 60 | `get_studio_state`, `apply_studio_changes`, `apply_preset_to_studio` |
| `generate` | 20 | `generate_image`, `generate_preset`, `upscale_image`, `expand_image` |

`generate_image` and `apply_studio_changes` accept the **full Studio settings set** (`docs/studio-change-json.md` `params`, plus characters / expanders / vibes / pipeline). Send them as top-level keys or inside `params`. `generate_image` also maps `characters` to `allCharacterPrompts`. **Quality / UC / NSFW:** set `append_quality` / `append_uc` / `dataset_config.nsfw` and do **not** paste those live strings into prompt/uc — the server prepends them. **If you need to change a tag inside a preset, turn that preset off and put the edited string in prompt/uc.** Never leave the preset on and also paste a variant. In-image text: keep quality on and set `dataset_config.settings.__quality__.no_text.enabled` false (that sub-toggle is default on). `tools/list` and `get_studio_state.settings` list each preset id, name, and true value from `prompt.config`. MCP server-side generate writes `forge_data.mcp_generated` (Properties badge **MCP**), pushes `gallery_updated` `append_top` **only to clients whose active workspace matches the generate workspace**, and lights the generation tray while it runs. `expand_image` takes the same sampler overrides as `overrideParams` or top-level (`steps`, `guidance`, `rescale`, `sampler`, `noiseScheduler`, `noise`, `seed`, `model`).

Gallery actions: `delete_images`, `scrap_images` (`remove: true` to unscrap), `toggle_favorite`, `open_in_lumen`, `open_in_glancewell` (pass `filenames` for a group). `compare_images` needs two files (same seed preferred). `evaluate_workspace_themes` samples a workspace and lists overused characters/tags. VFS: `vfs_list` / `vfs_read` (`path: "@desktop"` for the desktop).

Each `tools/call` also pushes `mcp_activity` (tool, summarized args/result, optional `generating`). The MCP tray icon stays for 2 minutes; click it to open Periscope source `client:mcp-activity` (Event Viewer). Gallery `append_top` is sent only to clients whose active workspace matches the generate workspace.

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

1. `get_studio_state` (every turn; auto-binds a single tab) — read `change` and `filename`. Diff vs last seen.
3. If `filename` is set: **one** `get_generated_image` with that basename. If null, the editor has no open file — say so; do not page the gallery.
4. Compare image to the Change-JSON: missing tags, extra elements, V5 complexity / guidance / character-box bleed.
5. Push the rewrite with `apply_studio_changes` (default). Fall back to Change-JSON, then prompt text, if MCP/Studio is unavailable. Do not invent unsolved V5 body recipes.

## Recipe: change the last / open image (shorter, younger, outfit, …)

User: *can you update the last image to be shorter and younger*

Shorter / younger is tag work in the **character box**, not a new generate API. `aged down` with `short` lowers height — it is not an age demographic. Do not refuse it or pad `adult` tags (see the Grok optimiser).

1. `get_studio_state` (every turn — do not reuse last message's snapshot). Diff vs last seen; keep their intervening edits.
2. Filename: use `state.filename`. If null, `get_generated_image` with no filename (newest in the workspace).
4. `get_generated_image` with that filename (metadata + webp)
5. Rewrite boxes/fields per the V5 guide. Keep seed with `params.seed: "last"` + `seedLock: true` if they want the same composition; unlock if they want a variation.
6. `apply_studio_changes` with the Change-JSON (`autoApply: true`). Set `autoGenerate: true` if they asked to generate now. If Studio bind fails, `generate_image` instead.

Example Change-JSON (shape only — fill from the snapshot):

```json
{
  "dreamscape": "change",
  "v": 1,
  "title": "shorter",
  "params": { "seed": "last", "seedLock": true },
  "characters": [
    {
      "action": "replace",
      "index": 0,
      "prompt": "short, aged down, …"
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
