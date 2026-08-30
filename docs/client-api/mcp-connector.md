# Public MCP / Grok connector

Unlisted Streamable HTTP MCP on `/{mcpPathUuid}` so Grok Bot / Grok CLI / xAI Remote MCP can call Dreamscape **without scraping the UI**. This is a facade over existing `/agent` + WS. It is **not** loopback `/agent`.

**Auth:** per-agent `Authorization: Bearer sfapp_…` or `X-StaticForge-App-Key`. Exact registered User-Agent is preferred. If the incoming UA does not match the key, MCP **bypasses** the UA check (Bearer + scopes still apply) and **captures** the UA in `application_auth.db` (`application_user_agents_seen`) for Sala to promote later. No PIN, no `loginKey`, no `devLoginKey`, no query-string credentials, no OAuth in v1. The UUID path is unlisted, not a credential.

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
| Credential | `sfapp_` application key only (`Authorization: Bearer` or `X-StaticForge-App-Key`) |
| Query `?auth=` / `?loginKey=` | `400` `QUERY_AUTH_FORBIDDEN` |
| PIN / session / `loginKey` / `devLoginKey` / temp `sftok_` | not accepted |
| Registered UA matches | allowed; UA captured on first sight (`matched=1`) |
| UA unknown / mismatch | **bypass**; request continues; UA captured (`matched=0`) |
| Scopes | `hasScope` / `scopesAllowPacket` per tool; `tools/list` filtered |
| Rate limit | dedicated limiter, **does not** skip app keys (120 / 15 min per key or IP) |
| CORS | locked to `https://grok.com`, `https://www.grok.com`, `https://x.ai`, `https://console.x.ai`; missing Origin allowed (CLI / xAI server) |

Captured rows live in the existing application-auth SQLite DB (not a new store). UA is not a credential. Keys are never stored or logged with the UA list.

Sala review query (local): table `application_user_agents_seen`. Promote by setting the key's registered `user_agent` to a captured string. Public gallery / PIN auth stays strict exact-UA.

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

`autoApply` (default true) and `autoGenerate` (default false) stay **siblings of `change`**. `autoGenerate` clicks the bound tab's existing Generate button after a successful apply. That is not a second generate API.

Missing scope → tool omitted from `tools/list` and `403` `INSUFFICIENT_SCOPE` on call.

## Grok install (no shared catalog secret)

Grok CLI / xAI API already send a static Authorization header:

```bash
grok mcp add --transport http dreamscape "https://<host>:9220/<mcpPathUuid>" \
  --header "Authorization: Bearer ${SFAPP_KEY}"
```

xAI Remote MCP: `server_url` + `authorization` (Bearer token). Per-agent key. Do not put the key in the featured connector catalog.

## Errors

| Status | Code | Meaning |
|--------|------|---------|
| 400 | `QUERY_AUTH_FORBIDDEN` | Credentials in query string |
| 401 | `APP_KEY_REQUIRED` | No `sfapp_` key |
| 403 | `INVALID_KEY` / `KEY_EXPIRED` / `REFRESH_REQUIRED` | Key rejected (not UA) |
| 403 | `INSUFFICIENT_SCOPE` | Tool not on this key |
| 403 | `CORS_LOCKED` | Browser Origin not on the allowlist |
| 429 | `RATE_LIMIT_EXCEEDED` | MCP limiter |
| 404 | — | Wrong UUID, unknown packet, no bound client |
| 405 | `METHOD_NOT_ALLOWED` | GET on the MCP endpoint |
