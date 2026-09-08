# StaticForge docs

## Start here (API / clients)

| Doc | Purpose |
|-----|---------|
| [client-api/README.md](./client-api/README.md) | Client API index (REST + WebSocket + agent + MCP) |
| [studio-change-json.md](./studio-change-json.md) | Studio Change JSON (agent / MCP / clipboard) |
| [local-host.md](./local-host.md) | Localhost / host wiring notes |
| [dreamscape-app-names.md](./dreamscape-app-names.md) | Dreamscape app / DSAP naming |
| [ANDROID_BRIDGE.md](./ANDROID_BRIDGE.md) | WebView native bridges (not server API) |
| [LOGGING_SYSTEM.md](./LOGGING_SYSTEM.md) | Server logging |
| [../README-CHILD.md](../README-CHILD.md) | Child / ephemeral replication ops |

Domain WS packets live under [client-api/ws/](./client-api/ws/). MCP tools: [client-api/mcp-connector.md](./client-api/mcp-connector.md) and [client-api/mcp-tool-flow.md](./client-api/mcp-tool-flow.md).

## Design notes (still useful)

| Doc | Topic |
|-----|-------|
| [design/gallery-cache-revision-system.md](./design/gallery-cache-revision-system.md) | Gallery cache revisions |
| [design/emphasis-group-id-syntax.md](./design/emphasis-group-id-syntax.md) | Emphasis group ids |
| [design/emphasis-weight-management-todo.md](./design/emphasis-weight-management-todo.md) | Weight management TODO |
| [design/prompt-naturalizer-research.md](./design/prompt-naturalizer-research.md) | Prompt naturalizer research |
| [DESKTOP_POSITIONING_SYSTEM.md](./DESKTOP_POSITIONING_SYSTEM.md) | Desktop icon positioning |
| [SEGMENT_INDEX_SYSTEM.md](./SEGMENT_INDEX_SYSTEM.md) | Segment index |
| [WORD_SEQUENCE_INDEX.md](./WORD_SEQUENCE_INDEX.md) | Word sequence index |
| [PERIOD_RANGES.md](./PERIOD_RANGES.md) | Period ranges |
| [LOCAL_PROMPT_OPTIMIZER.md](./LOCAL_PROMPT_OPTIMIZER.md) | Local prompt optimizer |

## Archive / historical (do not treat as current API)

Plans, migrations, and superseded guides. Prefer `client-api/` for anything a client must implement.

- `websocket_android_guide.md` — superseded by `client-api/`
- `modal-listener-refactor-plan.md`, `modal-keyboard-shortcuts-audit.md`
- `appjs-refactor-removal-manifest.md`
- `ANIME_FURRY_TAG_SEARCH_MIGRATION_REVIEW.md`, `TAG_LOOKUP_UPDATES_NEEDED.md`
- `BLOAT_ANALYSIS.md`, `PLUMBING_MIGRATION_EXAMPLES.md`
- `cursor_optimize_image_generation_and_da.md`
- `TESTING_DTEXT_CONVERSION.md`
- `referenceManager_inventory.md`
- `flow-maps/` examples
- `Archive.zip` — binary archive; not documentation

## Source of truth when docs drift

| Concern | Location |
|---------|----------|
| REST | `web_server.js`, `modules/agentClientBridge.js`, `modules/replication/routes/*.js` |
| WS packets | `modules/ws/handlers/*.js`, `modules/vfsWebSocketHandlers.js`, `modules/referencesWebSocketHandlers.js` |
| MCP tools | `modules/mcpAgentFacade.js` |
| Change JSON | `docs/studio-change-json.md` + `public/scripts/comp/studioChangeJson.js` |
