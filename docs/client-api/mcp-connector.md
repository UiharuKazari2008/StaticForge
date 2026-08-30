# Public MCP / Grok connector

Unlisted Streamable HTTP MCP on `/{mcpPathUuid}` so Grok Bot / Grok CLI / xAI Remote MCP can call Dreamscape **without scraping the UI**. This is a facade over existing `/agent` + WS. It is **not** loopback `/agent`.

**Auth:** per-agent `Authorization: Bearer sfapp_…`, `X-StaticForge-App-Key`, **or OAuth 2.1 + PKCE access token** (`Authorization: Bearer mcoat_…`). Exact registered User-Agent is preferred. If the incoming UA does not match the key, MCP **bypasses** the UA check (Bearer + scopes still apply) and **captures** the UA in `application_auth.db` (`application_user_agents_seen`) for Sala to promote later. No PIN, no `loginKey`, no `devLoginKey`, no query-string credentials. The UUID path is unlisted, not a credential.

**Not in this surface:** Studio chrome, `/mcp` on the public root, reuse of `vfsPathUuid` / `logViewerPathUuid`, reuse of loopback `devAuthMiddleware` (that stack skips UA and rate limits).

See [agent-session.md](./agent-session.md) for the loopback bind/drive API this wraps.

## Mount

Same process and port as the app (9220). Auto-generated into `secure.config.json` as `mcpPathUuid` on first boot (same pattern as `vfsPathUuid`). Sala may replace the production value.

| Method | Path | Effect |
|--------|------|--------|
| `POST` | `/{mcpPathUuid}` | Streamable HTTP JSON-RPC (`initialize`, `tools/list`, `tools/call`, `ping`) |
| `POST` | `/{mcpPathUuid}/mcp` | Same handler (Grok URL convenience; still under the UUID) |
| `OPTIONS` | same | CORS preflight |
| `GET` | same | `405` — POST only |

Wrong UUID is `404` (no route). Do not mount `/mcp` or public `/agent`.

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
| Rate limit | dedicated limiter, **does not** skip app keys (120 / 15 min per key or IP) |
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

Register an OAuth client before using the flow. `application_key` is **optional** on register. If omitted, `oauth_clients.application_key_id` stays null until consent: PIN, then pick or create a key. Authorize does not accept a pasted `sfapp_` secret.

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

Use the returned `client_id` in the Grok form. If registered without an app key, the consent page asks for your PIN and a key pick/create.

### Pre-minted client_id for Grok manual form

If Grok shows the manual form (Client ID / endpoints) instead of auto-discovery, pre-mint a client_id once:

```bash
curl -X POST "https://<host>/{mcpPathUuid}/oauth/register" \
  -H "Content-Type: application/json" \
  -d '{"client_name":"Grok","redirect_uris":["https://grok.com/oauth/callback"]}'
```

Copy the `client_id` from the response and paste it into the Grok form. On the consent page, sign in with your Dreamscape PIN and pick or create a key.

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

2. User sees consent page (ui-review) showing client name and requested scopes.
   - Enter the **Dreamscape PIN** (same admin / user PIN as the login pad). PIN is only accepted on UUID `/oauth/authorize`. It is not MCP auth.
   - After PIN: pick an existing `sfapp_` key for that PIN, or **create a new** key (requested named scopes only, never `universal`). Partial matches stay in the list and are labeled `upgrade +notes, wiki` when Approve will add scopes. Raw keys are not shown or pasted.
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

| Tool | Wrap | Scope | Bind? |
|------|------|-------|-------|
| `generate_image` | `POST /agent/packet` `{ type: "generate_image" }` | `generation` | no |
| `get_generated_image` | `request_image_metadata` + existing `images/` file (same as `GET /images/:filename`) | `gallery` | no |
| `get_images` | `request_gallery` | `gallery` | no |
| `get_workspaces` | `workspace_list` | `workspace` | no |
| `list_clients` | `GET /agent/clients` | `generation` | no |
| `bind_session` | `POST /agent/bind` `{ clientId }` or `{ code }` | `generation` | — |
| `apply_studio_changes` | `POST /agent/session/studio` | `generation` | yes |
| `search_autofill` | `test_autofill_ranking` once per term (max 20). Same live autocomplete pipeline. Accepts `terms: string[]` and/or `query` | `autofill` | no |
| `search_wiki` | `search_tag_wiki` | `wiki` (also listed for `autofill` keys) | no |
| `get_wiki_page` | `get_tag_wiki_page` (`tagName`, optional `source`, `format`) | `wiki` (also listed for `autofill` keys) | no |
| `list_static_wiki_sites` | `get_wiki_home` | `wiki` / `autofill` | no |
| `list_static_wiki_pages` | `get_static_wiki_site_index` | `wiki` / `autofill` | no |
| `search_static_wiki` | substring filter over existing site indexes (`query`, optional `siteId`) | `wiki` / `autofill` | no |
| `get_static_wiki_page` | `get_static_wiki_page` | `wiki` / `autofill` | no |
| `list_presets` / `search_presets` / `get_preset` / `save_preset` | `get_presets` / `search_presets` / `load_preset` / `save_preset` | `presets` | no |
| `apply_preset_to_studio` | `load_preset` then bound `apply_studio` Change-JSON | `presets` | yes |
| `generate_preset` | `generate_preset` (server generate, not bound-tab click) | `generation` | no |
| `upscale_image` | `upscale_image` (`filename`, optional `workspace`) | `generation` | no |
| `expand_image` | `expand_image` (`filename`, `resolution`, `imageBias` 0–4) | `generation` | no |
| `list_references` / `get_references_by_ids` / `list_workspace_references` / `upload_reference` | matching reference packets | `references` | no |
| `omegasearch` | `omegasearch_query` (`query` / `terms` coerced to `blocks`) | `search` | no |
| `list_notes` / `list_notes_by_workspace` / `get_note` | `notes_get_all_metadata` / `notes_get_by_workspace` / `notes_get` | `notes` | no |
| `create_note` / `update_note` / `save_note_content` | `notes_create` / `notes_update` / `notes_save_content` (`append` does `notes_get` first) | `notes` | no |

`search_autofill` returns `{ success, results: [{ term, success, results, spellCheck }] }`. That is the existing ranking-test search, not a new search API. `get_wiki_page` is tag wiki (danbooru / e621). Static / Grimoire pages use `list_static_wiki_*` / `search_static_wiki` / `get_static_wiki_page`. Notes use the existing notepad packets — request the `notes` scope on consent.

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
   - **Scopes**: `generation gallery workspace autofill wiki presets references search notes` (or subset)
   - **Token Auth Method**: `none (PKCE only, recommended)`
3. Click Save & Connect. You'll see the consent page.
4. Approve. Missing requested named scopes are added to the selected key. Grok gets an access token bound to that key's scopes.

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
| 429 | `RATE_LIMIT_EXCEEDED` | MCP limiter |
| 404 | — | Wrong UUID, unknown packet, no bound client |
| 405 | `METHOD_NOT_ALLOWED` | GET on the MCP endpoint |
