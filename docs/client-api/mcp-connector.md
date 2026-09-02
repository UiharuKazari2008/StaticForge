# Public MCP / Grok connector

Unlisted Streamable HTTP MCP on `/{mcpPathUuid}` so Grok Bot / Grok CLI / xAI Remote MCP can call Dreamscape **without scraping the UI**. This is a facade over existing `/agent` + WS. It is **not** loopback `/agent`.

**Auth:** per-agent `Authorization: Bearer sfapp_…`, `X-StaticForge-App-Key`, **or OAuth 2.1 + PKCE access token** (`Authorization: Bearer mcoat_…`). Exact registered User-Agent is preferred. If the incoming UA does not match the key, MCP **bypasses** the UA check (Bearer + scopes still apply) and **captures** the UA in `application_auth.db` (`application_user_agents_seen`) for Sala to promote later. No PIN, no `loginKey`, no `devLoginKey`, no query-string credentials. The UUID path is unlisted, not a credential.

**Not in this surface:** Studio chrome, `/mcp` on the public root, reuse of `vfsPathUuid` / `logViewerPathUuid`, reuse of loopback `devAuthMiddleware` (that stack skips UA and rate limits).

See [agent-session.md](./agent-session.md) for the loopback bind/drive API this wraps. Grok recipes (Studio compare, rewrite last image): [mcp-tool-flow.md](./mcp-tool-flow.md).

## Mount

Same process and port as the app (9220). Auto-generated into `secure.config.json` as `mcpPathUuid` on first boot (same pattern as `vfsPathUuid`). Sala may replace the production value.

| Method | Path | Effect |
|--------|------|--------|
| `POST` | `/{mcpPathUuid}` | Streamable HTTP JSON-RPC (`initialize`, `tools/list`, `tools/call`, `ping`) |
| `POST` | `/{mcpPathUuid}/mcp` | Same handler (Grok URL convenience; still under the UUID) |
| `OPTIONS` | same | CORS preflight |
| `GET` | same | `405` — POST only |

Wrong UUID is `404` (no route). Do not mount `/mcp` or public `/agent`.

## Connector card (`initialize.serverInfo`)

`initialize` advertises Grok's connector name, publisher, and icon. `capabilities.tools.listChanged` is `false`, so Grok may keep a stale tool list after a ship. The **name includes a tools revision** so a stale connector is obvious.

| Field | Value |
|-------|--------|
| `name` / `title` | `DreamScape r` + 8 hex (e.g. `DreamScape r3a1c9e02`) |
| `version` | same 8 hex |
| `description` | `Academy City Research P.S.R.` |
| `websiteUrl` | public hostname (`public_hostname`, `https` unless localhost) |
| `icons[0]` | `{websiteUrl}/static_images/apple-touch-icon.png` (`180x180`, PNG) |

The revision is the first 8 hex chars of SHA-256 over every tool's `name` / `description` / `inputSchema` (core + hidden), plus `advanced_tools`, plus `instructions`. Live `prompt.config` catalog strings are **not** in the hash. After a tools ship, reconnect or re-add the connector if the name did not change.

OAuth `resource_name` stays `DreamScape` (resource identity, not the tool cache).

CLI alias `grok mcp add … dreamscape` is local only and does not have to match `serverInfo.name`.

## Auth (public MCP only)

`createMcpAuthMiddleware` in `modules/auth.js`. Not loopback-gated.

| Rule | Behavior |
|------|----------|
| Credential | `sfapp_` application key (`Authorization: Bearer` or `X-StaticForge-App-Key`) **or** OAuth 2.1 access token (`Authorization: Bearer mcoat_...`) |
| Query `?auth=` / `?loginKey=` | `400` `QUERY_AUTH_FORBIDDEN` |
| PIN / session / `loginKey` / `devLoginKey` / temp `sftok_` | not accepted |
| Registered UA matches | allowed; UA captured on first sight (`matched=1`) |
| UA unknown / mismatch | **bypass**; request continues; UA captured (`matched=0`) |
| OAuth access token | validated against `oauth_access_tokens` table; inherits scopes from bound app key |
| Scopes | `hasScope` / `scopesAllowPacket` per tool; `tools/list` filtered |
| Rate limit | Per **tool group**. Handshake unlimited. `tools/call` over-limit returns MCP `isError` with `group` + `retryAfter` (and `Retry-After`). Other methods still HTTP 429. See [mcp-tool-flow.md](./mcp-tool-flow.md). |
| CORS | MCP tools locked to `https://grok.com`, `https://www.grok.com`, `https://x.ai`, `https://console.x.ai`; missing Origin allowed (CLI / xAI server). OAuth register/authorize/token also allow the issuer origin (consent form), `Origin: null` / same-origin document navigations, loopback, and `https://cursor.com` / `https://www.cursor.com`. |

Captured rows live in the existing application-auth SQLite DB (not a new store). UA is not a credential. Keys are never stored or logged with the UA list.

Sala review query (local): table `application_user_agents_seen`. Promote by setting the key's registered `user_agent` to a captured string. Public gallery / PIN auth stays strict exact-UA.

## OAuth 2.1 + PKCE (Grok Custom Connector)

OAuth support enables Grok.com Custom Connector integration. OAuth tokens are **bound to existing `sfapp_` application keys** — they do not create a new principal. The authorization flow issues access tokens that inherit scopes from the bound app key.

### Discovery endpoints (domain root)

MCP clients discover OAuth configuration via RFC 8414 / RFC 9728 well-known endpoints:

| Path | Content |
|------|---------|
| `/.well-known/oauth-protected-resource` | Protected resource metadata: `resource`, `authorization_servers`, `scopes_supported` |
| `/.well-known/oauth-authorization-server` | Authorization server metadata: `issuer`, `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `code_challenge_methods_supported: ["S256"]` |

A 401 response from the MCP endpoint includes:
```
WWW-Authenticate: Bearer resource_metadata="https://<host>/.well-known/oauth-protected-resource"
```

### OAuth endpoints (under UUID prefix)

All OAuth endpoints stay under `/{mcpPathUuid}/oauth/*` to remain unlisted:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/{mcpPathUuid}/oauth/register` | Dynamic client registration (RFC 7591) |
| `GET` | `/{mcpPathUuid}/oauth/authorize` | Authorization endpoint (consent page) |
| `POST` | `/{mcpPathUuid}/oauth/authorize` | Handle consent (approve/deny) |
| `POST` | `/{mcpPathUuid}/oauth/token` | Token endpoint (code exchange / refresh) |

### Grok Custom Connector form values

When using grok.com → New Connector → Custom, fill in:

| Field | Value |
|-------|-------|
| **Client ID** | Your registered OAuth `client_id` (from registration) |
| **Client Secret** | Leave empty |
| **Authorization Endpoint** | `https://<host>/{mcpPathUuid}/oauth/authorize` |
| **Token Endpoint** | `https://<host>/{mcpPathUuid}/oauth/token` |
| **Scopes** | `generation gallery workspace` (or subset) |
| **Token Auth Method** | `none (PKCE only, recommended)` |

### Client registration (RFC 7591 DCR)

Register an OAuth client before using the flow. `application_key` is **optional** on register. If omitted, `oauth_clients.application_key_id` stays null until consent: PIN, then auto-use a same-named matching key or pick/create one. Authorize does not accept a pasted `sfapp_` secret.

**Option A: Pre-mint with app key binding (recommended for CLI)**

```bash
curl -X POST "https://<host>/{mcpPathUuid}/oauth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "application_key": "sfapp_...",
    "client_name": "Grok Connector",
    "redirect_uris": ["https://grok.com/oauth/callback", "http://127.0.0.1:39123/callback"]
  }'
```

**Option B: Public client (for Grok discovery+DCR)**

Grok.com Custom Connector performs RFC 7591 DCR automatically. It cannot POST an `sfapp_` key, so register without one:

```bash
curl -X POST "https://<host>/{mcpPathUuid}/oauth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Grok Connector",
    "redirect_uris": ["https://grok.com/oauth/callback"]
  }'
```

Response (both options):
```json
{
  "success": true,
  "client_id": "mcp_...",
  "client_name": "Grok Connector",
  "redirect_uris": ["https://grok.com/oauth/callback"],
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"]
}
```

Use the returned `client_id` in the Grok form. If registered without an app key, the consent page asks for your PIN; a matching same-named key skips pick/create.

### Pre-minted client_id for Grok manual form

If Grok shows the manual form (Client ID / endpoints) instead of auto-discovery, pre-mint a client_id once:

```bash
curl -X POST "https://<host>/{mcpPathUuid}/oauth/register" \
  -H "Content-Type: application/json" \
  -d '{"client_name":"Grok","redirect_uris":["https://grok.com/oauth/callback"]}'
```

Copy the `client_id` from the response and paste it into the Grok form. On the consent page, sign in with your Dreamscape PIN. A key already named like the client with matching scopes is used automatically; otherwise pick or create a key.

### Authorization flow

1. Client redirects to `/{mcpPathUuid}/oauth/authorize` with:
   - `response_type=code`
   - `client_id=mcp_...`
   - `redirect_uri=...`
   - `scope=generation gallery autofill wiki presets references search notes`
   - `state=...`
   - `code_challenge=...` (SHA256 hash of verifier, base64url)
   - `code_challenge_method=S256`
   - `resource=https://<host>/{mcpPathUuid}` (optional)

2. User sees consent page showing the client name and PIN first. Requested permissions are collapsed (`details`) so the PIN field stays on screen.
   - Enter the **Dreamscape PIN** (same admin / user PIN as the login pad). PIN is only accepted on UUID `/oauth/authorize`. It is not MCP auth.
   - After PIN: if an active key is named like the client (`MCP <name>` or the same name) **and** already has the requested scopes, the picker is skipped and the code is issued.
   - Name match with missing scopes still shows the picker (no silent upgrade).
   - Otherwise pick an existing `sfapp_` key for that PIN, or **create a new** key (requested named scopes only, never `universal`). Partial matches stay in the list and are labeled `upgrade +notes, wiki` when Approve will add scopes. Raw keys are not shown or pasted.
   - If the client was already bound, the picker still lists that key (pre-selected) plus other active keys. Approve merges **requested named scopes only** onto the selected key. Never `universal`.
   - Consent session is a 5-minute HttpOnly cookie + CSRF field. Wrong PIN is rate-limited and lockouts after 5 failures.

3. On approve, redirect to `redirect_uri` with `code` and `state`.

4. Client exchanges code at `/{mcpPathUuid}/oauth/token`:
   ```
   POST /{mcpPathUuid}/oauth/token
   Content-Type: application/x-www-form-urlencoded
   
   grant_type=authorization_code
   &code=...
   &redirect_uri=...
   &client_id=mcp_...
   &code_verifier=...
   ```

5. Response:
   ```json
   {
     "access_token": "mcoat_...",
     "token_type": "Bearer",
     "expires_in": 3600,
     "refresh_token": "mcort_...",
     "scope": "generation gallery"
   }
   ```

6. Client calls MCP with `Authorization: Bearer mcoat_...`.

### Allowed redirect URIs

Only these hosts are allowed:
- `https://grok.com`, `https://www.grok.com`
- `https://x.ai`, `https://console.x.ai`
- `https://cursor.com`, `https://www.cursor.com`
- `http://127.0.0.1:*`, `http://localhost:*` (for CLI/dev)

### Token lifetime

| Token | TTL |
|-------|-----|
| Authorization code | 5 minutes |
| Access token | 1 hour |
| Refresh token | 30 days |

Use `grant_type=refresh_token` to get a new access token before expiry.

## Tools (v1)

Each tool wraps an existing `/agent` function or WS packet. No parallel generate API.

`tools/list` advertises the **core** set plus `advanced_tools`. Hidden tools stay on the server; Grok finds and runs them with `advanced_tools` (`query`, then `name` + `arguments`). A query that mentions memories / NAX / the prompt guide / session returns those **core** names and says to call them directly. If the query matches nothing, the result is the **full** core + hidden list. Direct `tools/call` of a hidden name still works for CLI.

### Core (`tools/list`)

| Tool | Wrap | Scope | Bind? |
|------|------|-------|-------|
| `generate_image` | Server generate on the **shared generation FIFO** (Studio Generate / preset / reroll use the same stack; 8–20s gap after each job). Default stalls until filename + Grok webp. `async: true` returns `jobId` immediately. Full Studio settings as top-level keys or `params`. `n` is print count 2–8. Writes `forge_data.mcp_generated`. Omitting `workspace` uses the bound / only connected tab. Paid Anlas/Opus (upscale, expand, large/xlarge/wallpaper) requires `userApprovedPaidRequest` (alias `allow_paid`) or the tool bounces before FIFO. `dynamicGeneration.enabled: false` or omit does not compile and does not 500. Unintegrated `dynamicGeneration` returns `needsIntegration` + resolved and does not enqueue. | `generation` | no |
| `get_generation_job` | Poll `jobId` from `async` generate. Status/position while queued; same image payload when done. | `generation` | no |
| `await_generation_job` | Block on `jobId` until complete, then return filename + Grok webp. | `generation` | no |
| `get_generated_image` | Metadata + Grok webp. Filename, seed, or omit for latest. `workspace` default is `default`. | `gallery` | no |
| `get_workspaces` | `workspace_list` — use the id on `get_generated_image` / `omegasearch` | `workspace` | no |
| `get_session_state` | Session snapshot. Default `view=live` (clients, windows, Studio). `view=catalog` slim settings. `view=full` live + slim catalog + promptGuide/NAX/memory pointers. Full per-model quality/UC strings are on `get_studio_state.settings` / `tools/list`. `hasClients` false or `studioReachable` false → `generate_image`. Grimoire window text is truncated; full text via `get_open_windows`. | `generation` | if clients |
| `get_studio_state` | Bound `get_state` for **this application key** (stays bound 15 min / until tray Unbind). One tab auto-binds. Several tabs: `needsClientChoice` + clients most recently used first — ask, then `bind_session`. Plus `settings`, `dynamicGeneration` (toggles + `resolved` time/weather/season/location; Director compile is nooped), `director`, and `mustAct` when those fields are present. Prefer `get_session_state`. | `generation` | yes |
| `get_open_windows` | Bound `get_windows`. Open Lumen / Glancewell / Grimoire / gallery / Studio with current data (filename, selected[], page text). `includeImage` default true attaches one Grok webp for the focused file. Prefer `get_session_state` `view=live`. | `generation` | yes |
| `get_client_physics` | Pre-resolve dynagen context (`resolved` + flat location / tod / date / weather / season). Works unbound; optional tod/weather/season/location. Missing location warns and defaults to client IP, does not 500. Bound tab still lights `#mcpPhysicsIndicator` and the Remote Access tray. | `generation` | yes |
| `list_clients` / `bind_session` | List tabs (this key's `bound` flag) / bind this key to a `clientId` | `generation` | bind |
| `apply_studio_changes` | `POST /agent/session/studio`. Full Change-JSON or top-level prompt/uc/params/characters/expanders/vibes/dynamicGeneration/director (same keys as Studio). Silent apply skips the autofill popup. | `generation` | yes |
| `get_linkxi_persona` | `get_persona_settings` without the photo blob (`hasPhoto` only). | `generation` | no |
| `save_linkxi_persona` | `save_persona_settings` (`user_name`, `backstory`, `default_verbosity` 1–5). Preserves an existing photo unless one is sent. | `generation` | no |
| `search_autofill` | `test_autofill_ranking` once per term (max 8 terms, 10 close hits each). Default `exactOnly`: exact or same name with `(qualifier)`. Hits are `{tag, count, confidence, exact}`. Empty + `untrained: true` means drop/replace. Accepts `terms: string[]` and/or `query` | `autofill` | no |
| `search_nax` | `queryTags` / `get_nax_tags`. Default kind ARTIST. Omit query for the current ranking. `sort=score` is top votes; `sort=ratio` is upvote ratio; `invert` reverses. Use `item.prompt` in Studio. | `search` (also listed for `autofill` keys) | no |
| `list_nax_galleries` | `getGalleries` plus expander kinds (ARTIST, CHARA, FACE, COPYRIGHT, HAIR, CURATED) | `search` (also listed for `autofill` keys) | no |
| `get_prompt_guide` | Read the Docubase page (clone `.cache/nai-prompt-guide`, wiki site `docubase`). Default `prompt-optimiser-grok`. Prior art, not laws — experiment, then `save_memory`. | `generation` | no |
| `list_memories` / `search_memories` / `get_memory` / `save_memory` | Onboard knowledge-memory DB (Memories applet). Aliases: `listKnowledgeMemories`, `searchKnowledgeMemories`, `retrieveKnowledgeMemory`, `saveKnowledgeMemory` (old paid API names). Grok Memory is not the store — the model must call these tools. `save_memory` refines: omitted graph fields kept, confidence +0–0.25 (new = 0.1). `model` defaults to `v4_5`. | `generation` | no |
| `search_wiki` | `search_tag_wiki` | `wiki` (also listed for `autofill` keys) | no |
| `get_wiki_page` | `get_tag_wiki_page` (`tagName`, optional `source`, `format`; markdown default). Returns `text` / `markdown` strings — never `html` as `{}`. Empty: `empty: true` + `next`. | `wiki` (also listed for `autofill` keys) | no |
| `save_preset` | `save_preset` — `presetName` + `config` (`name`, `prompt`, `model`) | `presets` | no |
| `apply_preset_to_studio` | `load_preset` then bound `apply_studio` Change-JSON | `presets` | yes |
| `upscale_image` | `upscale_image` (`filename`, optional `workspace`). Paid Opus — requires `userApprovedPaidRequest` / `allow_paid`. | `generation` | no |
| `expand_image` | `expand_image` (`filename`, `resolution`, `imageBias` 0–4). Paid Anlas — requires `userApprovedPaidRequest` / `allow_paid`. | `generation` | no |
| `omegasearch` | `omegasearch_query` (`query` / `terms` coerced to `blocks`; optional `workspace`) | `search` | no |
| `list_notes` / `get_note` / `save_note_content` | `notes_get_all_metadata` / `notes_get` / `notes_save_content` | `notes` | no |
| `delete_images` | `delete_images_bulk` | `gallery` | no |
| `scrap_images` | `workspace_bulk_add_scrap` / `workspace_remove_scrap` | `workspace` | no |
| `toggle_favorite` | `workspace_add_pinned` / `workspace_remove_pinned` | `workspace` | no |
| `open_in_lumen` / `open_in_glancewell` | Bound `open_viewer` or `mcp_open_viewer` push | `gallery` | client |
| `compare_images` | Sharp abs-diff of two gallery files; magenta webp + change % | `gallery` | no |
| `evaluate_workspace_themes` | Tag/character frequency on recent workspace files | `gallery` | no |
| `vfs_list` / `vfs_read` | `vfs_list_directory` / `vfs_read_system_file` or `vfs_download_file`. Path `@desktop` is the workspace desktop. | `vfs` | no |
| `advanced_tools` | Discover or run a hidden tool (`query`, or `name` + `arguments`). Memory/NAX/guide/session queries return core names. Empty match returns the full tool list. | any | — |

### Hidden (via `advanced_tools`)

| Tool | Wrap | Scope |
|------|------|-------|
| `get_latest_image` | Same as `get_generated_image` with no filename | `gallery` |
| `get_images` | Paged directory listing only | `gallery` |
| `list_static_wiki_sites` / `list_static_wiki_pages` / `search_static_wiki` / `get_static_wiki_page` | Grimoire / static wiki | `wiki` / `autofill` |
| `list_presets` / `search_presets` / `get_preset` / `generate_preset` | extra preset list/load/server-generate | `presets` / `generation` |
| `list_references` / `get_references_by_ids` / `list_workspace_references` / `upload_reference` | reference packets | `references` |
| `list_notes_by_workspace` / `create_note` / `update_note` | extra notepad CRUD | `notes` |
| `vfs_stat` / `vfs_write` / `vfs_delete` / `list_desktop_items` | VFS mutate + desktop shortcuts | `vfs` |

### Module Sets (sfapp_ scopes)

MCP tools are organized into **module sets**. Clients select which modules they use via named `sfapp_` scopes on their application key. A missing module scope means those tools are not available.

Example: Grok web must not get cake feeding → do not grant `sfapp_cake_pantry:feed`. A bot may have deliver without consume → grant `sfapp_cake_pantry:deliver` only.

Module scopes support submodule specifiers: `sfapp_cake_pantry:deliver` grants only `deliver_cake`. The full `sfapp_cake_pantry` grants all four pantry tools.

#### Cake Pantry Module (`sfapp_cake_pantry`)

Account-based cake tracking for Menma, Hoshino, Ivory. Preserves Menma's existing `.menma/cake-log.jsonl` + `state.json` structure; extends to per-account ledgers.

| Tool | Description | Submodule |
|------|-------------|-----------|
| `deliver_cake` | Add slices to a pile with reason (reward for ship/work). Pass `accountId`, `slices` (or `line_counts` for auto-calc: 1/40 lines or 10KB, min 1 cap 16), `reason`, `cake_type`, `credit` (`grok.menma` = 1.25x). | `deliver` |
| `feed_cake` | Yukimi grants slices (promotion or just because). Distinct from deliver. Pass `accountId`, `slices`, `reason`, `cake_type`, `from`. | `feed` |
| `inspect_pantry` | View piles, past consumes, kg history. Returns data, not a wall of text. Pass `accountId`, optional `log_limit`. | `inspect` |
| `consume_cake` | Eater eats pending slices. Returns usual response data plus **before and after image refs** and kg before/after. Visual QA invariants: empty plates, visible growth, hip contrast, up to 10 gens. | `consume` |

**Cake math:**
- 0.12kg per slice
- Cleanup: 1 slice per 40 lines or 10KB removed (min 1, cap 16)
- 1.25x multiplier for `grok.menma` / `Lead` credit

**Accounts:** `menma`, `hoshino`, `ivory`. Menma's look is locked (breakfast prompts). Hoshino/Ivory ledgers start with their own identity fields.

#### Report Issue Module (`sfapp_report_issue`)

Development QA reporting for Grok and other agents. Reports: tool failures, taking too long, too much data, too bloated / hard to understand.

| Tool | Description |
|------|-------------|
| `report_issue` | Report a QA issue. Pass `type` (critical, failure, slow, too_much_data, bloated, hard_to_understand, etc.), `tool`, `message`, `context`, `reporter`, `severity` 1–5. |

**Report levels (config):**
| Level | Name | Accepts |
|-------|------|---------|
| 0 | critical | Recurring failure/confusion only |
| 1 | errors | Any misunderstandings and errors (default) |
| 2 | detailed | More detailed level 1 (warnings, slow, bloat) |
| 3 | all | All good and bad reviews of tools and guides |

Reports are filtered by the configured level. Level 0 drops non-critical reports; level 3 accepts everything. Stored in `.issues/reports.jsonl`.

#### Usage Module (`sfapp_usage`)

Structured NovelAI account/subscription data. Grok web may receive this module.

| Tool | Description |
|------|-------------|
| `get_usage` | Get structured usage data. Returns `fixedAnlas`, `paidAnlas`, `opusV5BatteryRemaining` (percent), `withinRefillRate`, `generationCount24h`, `hoursUntilRenewal`. |

**Response fields:**
| Field | Type | Description |
|-------|------|-------------|
| `fixedAnlas` | number | Included/fixed Anlas remaining |
| `paidAnlas` | number | Paid Anlas remaining |
| `totalAnlas` | number | Sum of fixed + paid |
| `opusV5BatteryRemaining` | number\|null | V5 Opus meter/battery percent remaining |
| `opusV5IsNegative` | boolean\|null | true if over-draining the Opus meter |
| `opusV5TimeUntilNextPercent` | number\|null | Seconds until next percent refills |
| `withinRefillRate` | boolean | true if current usage is within refill rate (not over-draining) |
| `generationCount24h` | number | Generations in the last 24 hours (rolling window from `imageCounter.js`) |
| `hoursUntilRenewal` | number\|null | Hours until subscription reset/renewal |
| `subscriptionTier` | number\|null | 0 Paper, 1 Tablet, 2 Scroll, 3 Opus |
| `subscriptionActive` | boolean | Subscription active |

**Notes:**
- Upscale uses Anlas, not the Opus meter
- Img2img drain follows Strength not Noise (see #91)
- Does NOT invent remaining gens from usageToolManager's 17.3 * percent
- Uses existing `opusUsage.js` / account endpoints

---

`search_autofill` returns `{ success, results: [{ term, success, untrained, results: [{ tag, count, confidence, exact }] }] }`. Default `exactOnly`. That is the existing ranking-test search, not a new search API. `search_nax` returns `{ success, query, kind, slugs, sort, items: [{ tag, prompt, gallerySlug, score, upvotes, downvotes, ratio, favorite, tryMark }], total, hasMore, next }`. That is the existing NAX `queryTags` ranking, not a new dataset. `get_wiki_page` is tag wiki (danbooru / e621) and returns `text` / `markdown` strings — never `html: {}`. Static / Grimoire pages use hidden `list_static_wiki_*` / `search_static_wiki` / `get_static_wiki_page`. Notes use the existing notepad packets — request the `notes` scope on consent.

`autoApply` (default true) and `autoGenerate` (default false) stay **siblings of `change`**. `autoGenerate` clicks the bound tab's existing Generate button after a successful apply. That is not a second generate API.

Missing scope → tool omitted from `tools/list` and `403` `INSUFFICIENT_SCOPE` on call.

## Grok install

### Option 1: Static Bearer token (CLI / xAI API)

Grok CLI / xAI API can send a static Authorization header:

```bash
grok mcp add --transport http dreamscape "https://<host>:9220/<mcpPathUuid>" \
  --header "Authorization: Bearer ${SFAPP_KEY}"
```

xAI Remote MCP: `server_url` + `authorization` (Bearer token). Per-agent key. Do not put the key in the featured connector catalog.

### Option 2: OAuth 2.1 + PKCE (Grok Custom Connector)

For grok.com Custom Connector UI that requires OAuth:

1. Register an OAuth client (see OAuth section above).
2. In grok.com → New Connector → Custom, enter:
   - **Authorization Endpoint**: `https://<host>/{mcpPathUuid}/oauth/authorize`
   - **Token Endpoint**: `https://<host>/{mcpPathUuid}/oauth/token`
   - **Client ID**: Your `mcp_...` client ID from registration
   - **Scopes**: `generation gallery workspace autofill wiki presets references search notes chat` (or subset). Enshutsuka minimum: `generation gallery workspace chat`. Live URLs and a project paste-block live on Grim `dsap://mcp.dreamscape.jp/`.
   - **Token Auth Method**: `none (PKCE only, recommended)`
3. Click Save & Connect. You'll see the consent page.
4. Approve. Missing requested named scopes are added to the selected key. Grok gets an access token bound to that key's scopes.

### Grok project files

Paste the Grim block into the **project instructions** field only. Do **not** attach `nai-prompt-guide`, Docubase, memories, or other Dreamscape markdown as project knowledge. Grok will read the stale file and skip MCP (`get_prompt_guide`, `search_memories` / `save_memory`, `search_nax`). The paste is the same text as MCP `initialize.instructions` plus a short MCP-only preamble (`modules/mcpInstructions.js`). Re-paste after `DreamScape r########` changes. Delete any old uploaded copies.

## Errors

| Status | Code | Meaning |
|--------|------|---------|
| 400 | `QUERY_AUTH_FORBIDDEN` | Credentials in query string |
| 400 | `invalid_request` | OAuth: missing required parameter |
| 400 | `invalid_grant` | OAuth: code/token invalid or expired |
| 400 | `unsupported_grant_type` | OAuth: only `authorization_code` / `refresh_token` |
| 401 | `APP_KEY_REQUIRED` | No valid credential (includes WWW-Authenticate header) |
| 403 | `INVALID_KEY` / `KEY_EXPIRED` / `REFRESH_REQUIRED` | Key rejected (not UA) |
| 403 | `INSUFFICIENT_SCOPE` | Tool not on this key |
| 403 | `CORS_LOCKED` | Browser Origin not on the allowlist |
| 403 | `access_denied` | OAuth: user denied authorization |
| 429 | `RATE_LIMIT_EXCEEDED` | Tool-group limiter. Body `error.data.group` + `retryAfter` (seconds). Header `Retry-After`. |
| 404 | — | Wrong UUID, unknown packet, no bound client |
| 405 | `METHOD_NOT_ALLOWED` | GET on the MCP endpoint |
