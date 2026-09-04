# Dreamscape MCP tool flow (Grok)

How to use the public MCP connector for common Studio jobs. The living [nai-prompt-guide](https://yozora.bluesteel.737.jp.net/DreamScape/nai-prompt-guide) clone (Grimoire **Docubase**, `get_prompt_guide`, default `prompt-optimiser-grok`) is **prior art**, not statute. Call the tool when you want those notes. Experiment, look at the webp, then write the working rule with `save_memory`. Do not keep a copy of that guide in the grok.com project. This file is only the **tool order**.

**Delivery priority** (first that works): (1) `apply_studio_changes` — default, push the rewrite into the Studio tab (`autoApply: true`; `autoGenerate: true` if they asked to generate now). (2) `generate_image` — no Studio tab / bind failed / they asked for a server-side run. (3) emit Change-JSON (`docs/studio-change-json.md`). (4) return the prompt-text block. Do not dump Positive/UC when 1 or 2 works.

**Studio edits:** on every turn that touches Studio, call `get_studio_state` first. Do not reuse a stale snapshot from earlier in the chat. Diff the current Change-JSON / fields / characters / params against the last state you saw. Keep what the user changed in the app since that message; apply only this turn's requested delta.

The MCP `initialize` result also sends these rules as `instructions`. `serverInfo.name` is `DreamScape r` plus an 8-hex tools revision (see [mcp-connector.md](./mcp-connector.md)). `tools/list` is the **Grok core** catalog plus `advanced_tools`. Do **not** page a directory listing to find a known filename. Do **not** download the original PNG. `get_generated_image` and `generate_image` always return metadata plus a Grok-sized webp — **show that webp to the user**. Omit filename for the newest file. `workspace` / `default` is the default workspace.

**First call:** `get_session_state` with no `view` (defaults to **`live`**: clients + windows + Studio). Do **not** pass `view=full` on chat start — that plus parallel memories/NAX/autofill/guide dumps makes Grok summarize and time out. `view=catalog` is a slim settings slice (current-model quality/UC only). Full per-model strings stay on `get_studio_state.settings` and `tools/list`. **Before every Studio or window edit:** `get_session_state` `view=live` again. If `hasClients` is false, **or** `studioReachable` is false / `error` is "Bound tab did not answer in time", `generate_image` (do not `apply_studio_changes`). A bound tab that does not answer is deaf — do not treat `hasClients: true` + `studio: null` as a live Studio path. If `generate_image` runs while a client is connected, the server opens Lumen for you. `await_generation_job` / sync `generate_image` return `filename` + Grok webp from `image_generation_response`, never a keep-alive or weather carousel.

If a listed tool cannot do the job, call `advanced_tools` with `query`, then call it again with `name` + `arguments` to run that hidden tool (bind a second tab, page `get_images`, static wiki, references, extra note/preset actions).

If a tool 429s, read `error.data.group` and `error.data.retryAfter` (seconds). Wait that long. Handshake (`initialize` / `ping` / `tools/list`) is unlimited.

## Rate groups

| Group | Limit / 15 min | Tools |
|---|---|---|
| `free` | none | lists, bind, note/preset/wiki index reads, `get_linkxi_persona` |
| `search` | 240 | autofill, NAX (`search_nax`), wiki pages, OmegaSearch, `evaluate_workspace_themes` |
| `gallery` | 90 | `get_generated_image`, `compare_images`, `vfs_read` (and hidden `get_images` / `get_latest_image`) |
| `write` | 60 | save note/preset, `save_memory`, upload reference, `delete_images`, `scrap_images`, `toggle_favorite`, `save_linkxi_persona` |
| `studio` | 60 | `get_studio_state`, `get_open_windows`, `get_client_physics`, `apply_studio_changes`, `apply_preset_to_studio` |
| `generate` | 20 | `generate_image`, `generate_preset`, `upscale_image`, `expand_image` |

`generate_image` waits on the shared generation FIFO (Studio uses the same stack). Omit `async` to stall until the webp is ready. `async: true` returns `jobId` — then `await_generation_job` or `get_generation_job`. `generate_image` and `apply_studio_changes` accept the **full Studio settings set** (`docs/studio-change-json.md` `params`, plus characters / expanders / vibes / pipeline / `dynamicGeneration` / `director` / `dataset_config`). Send them as top-level keys or inside `params`. `generate_image` also maps `characters` to `allCharacterPrompts`, `dynamicGeneration` to `dynamic_generation`, and `director` session/message ids onto the generate body. `n` (1–8) is print copies on `generate_image` / `generate_preset` (`filenames[]` when `n` > 1) and the Studio prints input on `apply_studio_changes` / autoGenerate. **Quality / UC / NSFW / transparency:** set `append_quality` / `append_uc` / `append_transparency` / `dataset_config.nsfw` (or `params.nsfw` / top-level `nsfw` on `apply_studio_changes`) and do **not** paste those live strings into prompt/uc — the server prepends them. Auto-apply sets the matching Studio dropdowns and toggles (`dataset_config.include` replaces the selected dataset list; `dataset_config.settings` writes sub-toggles). **If you need to change a tag inside a preset, turn that preset off and put the edited string in prompt/uc.** Never leave the preset on and also paste a variant. In-image text: keep quality on and set `dataset_config.settings.__quality__.no_text.enabled` false (that sub-toggle is default on). `tools/list` and `get_studio_state.settings` list each preset id, name, and true value from `prompt.config`. MCP server-side generate writes `forge_data.mcp_generated` (Properties badge **MCP**), pushes `gallery_updated` `append_top` **only to clients whose active workspace matches the generate workspace**, and lights the generation tray while it runs. `expand_image` takes the same sampler overrides as `overrideParams` or top-level (`steps`, `guidance`, `rescale`, `sampler`, `noiseScheduler`, `noise`, `seed`, `model`).

If `mustAct` is present, bake `dynamicGeneration.resolved` and retry with `integrated=true`. `mustAct` is **not** set after a failed compile or after `integrated=true` — do not re-integrate a failed compiler. `dynamicGeneration.resolved` is the live time/weather/season/location capture (Director API is nooped — you compile). Pre-resolve with `get_client_physics` (works unbound; optional tod/weather/season/location; missing location warns and defaults to client IP, no 500) or use the resolved object already on get-state. Passing `dynamicGeneration.enabled: false` (or omitting the key) to `generate_image` does **not** compile and does **not** 500. Passing unintegrated dynagen toggles to `generate_image` / `generate_preset` / `apply_studio_changes` `autoGenerate` returns `needsIntegration` and does **not** enqueue — bake `resolved` into prompt/uc/characters, then retry with `dynamicGeneration.integrated=true`. Paid Anlas/Opus (upscale, expand, large/xlarge/wallpaper) requires `userApprovedPaidRequest` (alias `allow_paid`) or MCP bounces before FIFO. Honor an attached director prompt. LinkXi: `get_linkxi_persona` / `save_linkxi_persona`. Image chaining is out of scope. Grim setup page: `dsap://mcp.dreamscape.jp/`.

What they are looking at: `get_open_windows` (Lumen/Glancewell current file + optional webp, Grimoire `data.text`, gallery `data.selected`). Then `get_generated_image` for metadata or gallery tools on the selected names.

Gallery actions: `delete_images`, `scrap_images` (`remove: true` to unscrap), `toggle_favorite`, `open_in_lumen`, `open_in_glancewell` (pass `filenames` for a group). `compare_images` needs two files (same seed preferred). `evaluate_workspace_themes` samples a workspace and lists overused characters/tags. VFS: `vfs_list` / `vfs_read` (`path: "@desktop"` for the desktop).

Each `tools/call` also pushes `mcp_activity` (tool, summarized args/result, optional `generating`, `actorName` from the application token). The Remote Access tray icon stays for 2 minutes and quotes the token name (e.g. Your session was accessed by "Grok"); click it to open Periscope source `client:mcp-activity` (Event Viewer). `generate_image` with no `workspace` uses the bound Studio tab (or the only connected tab). Gallery `append_top` is sent to clients whose active workspace matches that save workspace.

## Studio bind

The bind is stored on **this application key**, not the whole server. `get_studio_state` (and apply / physics) auto-bind when exactly one Studio tab is connected. That bind stays until the user Disconnects from the Remote Access tray or 15 minutes pass with no studio commands.

Several tabs: `get_studio_state` returns `needsClientChoice` and `clients` (most recently used first). Ask the user which tab, then `bind_session` `{ "clientId": "…" }`. `list_clients` is also a core tool. Server-side `generate_image` does not need a bind.

`get_client_physics` pre-resolves dynagen context (same `resolved` object as get-state, plus flat `location` / `tod` / `time` / `date` / `weather` / `season`). It works without a bind. Optional `tod` / `weather` / `season` / `location` or `dynamicGeneration` override the snapshot. A bound tab still lights the location-arrow physics icon and the Remote Access tray (Your location was accessed by "Grok"). `date.month` is **1-based** (September = 9); holiday tables stay 0-based internally.

## Recipe: what they are looking at

User: *look at this image / this wiki page / my selected gallery files*

1. `get_open_windows` — binds like `get_studio_state`
2. Active Lumen / Glancewell: webp is on the result (`includeImage` default true). Metadata: `get_generated_image` `{ "filename" }`
3. Grimoire: `windows[].data.url` + `data.text` — implement or quote from that text
4. Gallery: `windows[].data.selected` — then `delete_images` / `scrap_images` / `toggle_favorite` / `open_in_lumen`

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
5. Push the rewrite with `apply_studio_changes` (default). Fall back to Change-JSON, then prompt text, if MCP/Studio is unavailable. An unsolved V5 body page is prior art — try, look, `save_memory`.

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

## Recipe: Enshutsuka on grok.com (analyse / create / efficiency)

User: *analyse my prompt* / *create* / *efficiency*

1. `get_studio_state` — read `change`, `dynamicGeneration`, `director`, `mustAct`, `filename`.
2. Analyse / efficiency: `get_generated_image` on `filename` (or latest). If `mustAct` or image `dynamic_generation` / `director_session_id` is set, integrate that data into the rewrite.
3. Create: no image required. Invent from the user text + Studio state.
4. If they asked to enable or retune dynamic generation, `apply_studio_changes` with `dynamicGeneration` (or `generate_image` `dynamic_generation`). Same for `director`.
5. Push the rewrite with `apply_studio_changes`. `autoGenerate` if they asked to generate now.
6. Persona as themselves: `get_linkxi_persona` (and `save_linkxi_persona` if they asked to update it).

Connector URLs and this paste-block: Grim `dsap://mcp.dreamscape.jp/`.

## Recipe: first snapshot, then live

User opens a chat / *what is on screen* / *change Studio*

1. `get_session_state` — default `view=live` (clients, windows, Studio). Do not pass `view=full` on chat start. Do not also dump memories + NAX + autofill + prompt guide in the same turn.
2. `hasClients` false → `generate_image`. Show the webp. Stop. Do not apply Studio changes.
3. Several clients → `needsClientChoice` → `bind_session` `{ "clientId" }`.
4. Need preset ids: `view=catalog` (slim) or `get_studio_state.settings` / `tools/list` (full per-model strings).
5. Before any later edit: `get_session_state` `{ "view": "live" }` again. Diff. Apply only this turn's delta.
6. Trained tags: `search_autofill` with **1–3 terms** (max 8). Default `exactOnly` (qualifier in parens only). Hits are `{tag, count, confidence, exact}`. `untrained: true` / empty results → drop or replace. Then `get_wiki_page` for that one tag — `text` / `markdown` strings, never `html: {}`. Empty wiki: use aliases or the last Studio character box; do not invent appearance.
7. Artists / NAX: `search_nax` only for this job (`sort=score` = top votes). Use `item.prompt`.
8. Guide text: `get_prompt_guide` when you want prior art (default `prompt-optimiser-grok`), not a ban list. Not on every chat start. Then try, look, `save_memory`.
9. Memories: `search_memories` for **this topic**. Apply only high-confidence rows (≥60%; prefer ≥80%). Create or upsert related memories the same turn (`save_memory`).

## Recipe: NAX artists / top votes

User: *find an artist* / *top voted artists* / *who draws like this*

1. `search_nax` — omit `query` for the current ranking. `sort` defaults to `score` (top votes first). Pass `query` for a name substring. `kind` defaults to `ARTIST` (model `v4_5` unless you pass `v5` / `v4`).
2. Other rankings: `sort: "ratio"` (upvote ratio), `sort: "name"` (A-Z), `invert: true` (lowest votes / ratio). Marks: `markFilter: "favorites"` or `"try"`.
3. Other datasets: `kind: "CHARA"` / `"FACE"` / `"COPYRIGHT"` / `"HAIR"` / `"CURATED"`, or `list_nax_galleries` then `gallerySlug`.
4. Prefer `item.prompt` in Studio (`artist:name` or `art by …`). A different string is an experiment — record it with `save_memory`.

## Recipe: memories (search, create, refine)

User: *any real Studio / prompt / technique job*

1. You **must** call `search_memories` (or `searchKnowledgeMemories`) for the topic. Chat recall / Grok Memory is not the store. `get_memory` / `retrieveKnowledgeMemory` on hits you might apply.
2. Treat `needsRefinement` / confidence &lt; 60% as a hypothesis, not a fact. Prefer ≥80% before you lean on it. Wiki, NAX, Docubase, and memories are starting notes — generate and look.
3. After a try, you **must** call `save_memory` or `saveKnowledgeMemory` to create or upsert (omit fields you are not changing), including when a gen broke a guide note and it worked. Saying "I will remember" does nothing. Confidence on refine is a +0–25% bump; new memories start at 10%. Write what you checked in `observations` (plain strings are fine). Set `model` (`v4_5` default; existing rows are V4.5).
4. Do this often. Do not wait for a dedicated "remember this" request.

Example: top 10 artists — `{ "sort": "score", "limit": 10 }`. Named hit — `{ "query": "kago", "sort": "score" }`.

## Recipe: known gallery filename (no Studio)

User: *look at `1782…_generated_….png` in the default workspace*

1. `get_generated_image` `{ "filename": "1782…_generated_….png" }`
2. Stop. Metadata + webp is enough for a V5 recommendation.

## Recipe: write the rewrite into Studio and generate

1. Bind
2. Build Change-JSON from `get_studio_state` plus what you are trying (guide notes are a start, not a statute)
3. `apply_studio_changes` `{ "change": {…}, "autoApply": true, "autoGenerate": true }`
4. `autoGenerate` clicks the bound tab's Generate button. Do not also call `generate_image` unless they asked for a **server-side** run (different session).

## search_indexes_ready / omegasearch wait

`generate_image` and `await_generation_job` wait until saved filenames have `search_indexes_ready=1` (short timeout) before the tool returns, so an immediate `omegasearch` can hit. If search still returns `total: 0` while indexes are pending, ingest waits one beat and retries once. A timeout still returns the image (`searchIndexed: false`).

## Recipe: character card (wiki + expander + Studio box + NAX CHARA)

User: *who is Rapi* / *appearance for alice (nikke)* / *don't invent this character*

1. `get_character_card` `{ "name": "rapi (nikke)" }` — optional `franchise` / `model`.
2. Read `wiki.text` / `wiki.markdown`. If `wiki.empty` is true, **do not invent appearance**. Use `aliases`, `expander.value` (full request-expander body), `studioBox` (`action: replace` + `index` snapshot), and `naxChara.prompt` (best `search_nax` `kind=CHARA` hit).
3. `next` is the same empty-wiki guidance as `get_wiki_page` when wiki or expander is empty. A missing wiki is not a ban.
4. No new Studio chrome. Characters stay `action: replace` + `index` (`docs/studio-change-json.md`).
