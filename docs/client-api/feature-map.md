# Feature Map

Matrix mapping major **web app features** to **REST** and **WebSocket** access.  
UI-only columns reference [client-only-features.md](./client-only-features.md).

Legend: **REST** = HTTP route; **WS** = WebSocket packet type; **—** = no direct server API; **Push** = server-initiated WS message.

---

## Authentication & connection

| Feature | REST | WS | Push | Client-only |
|---------|------|-----|------|-------------|
| PIN login | `POST /` login | — | — | Login UI, pin modal |
| Session check | `OPTIONS /app`, `POST /` ping | `connection` | — | localStorage sync |
| Logout | `POST /` logout | disconnect | — | Clear local state |
| Server readiness | `OPTIONS /status` | — | — | Connection dial UI |
| Bearer API key | `?auth=` / `Authorization` | — | — | — |
| Application key | `X-StaticForge-App-Key` + UA | `authenticate_application`, refresh, temp tokens | — | Security Center appkeys tab |
| WS reconnect | — | — | `connection`, restore msgs | Circuit breaker, refresh callbacks |

---

## Generation & images

| Feature | REST | WS | Push | Client-only |
|---------|------|-----|------|-------------|
| Manual generate | — | `generate_image` | `image_generation_progress`, `image_generation_response`, `gallery_updated` | Manual modal UI |
| Preset generate (in-app) | — | `generate_preset` | same + `queue_update` | Spellbook UI |
| Preset webhook | `GET /preset/:uuid` | — | `gallery_updated` (other clients) | — |
| Queued preset | `GET /pending/preset/:uuid`, `GET /pending/retrieval/:id` | — | — | — |
| Reroll (Recast) | `GET /reroll/:filename` (admin) | `reroll_image` | generation pushes | — |
| Upscale | — | `upscale_image` | `image_upscaling_response` | — |
| Expand canvas | — | `expand_image`, `preview_expand_image_prompt`, `reroll_expanded_image` | expansion responses | Image bias UI |
| Cancel generation | — | `cancel_generation` | — | — |
| Dynamic / Rentan | — | `resolve_dynamic_context`, `compile_dynamic_generation`, `apply_tendai_preview`, `dynamic_generation_progress` | `dynamic_generation_progress_update` | Carousel UI |
| Text replacements preview | — | `resolve_text_replacements` | — | — |
| View image file | `GET /images/:filename` | — | — | Lightbox |
| Slim / optimized download | `GET /image/slim/:filename`, `/image/opti/:filename` | — | — | — |
| Bias test | `POST /test-bias-adjustment` | — | — | Image bias modal |

---

## Gallery & workspaces

| Feature | REST | WS | Push | Client-only |
|---------|------|-----|------|-------------|
| List gallery | — | `request_gallery` | `gallery_updated` | Virtual scroll |
| Image metadata | — | `request_image_metadata` | — | — |
| Bulk delete | — | `delete_images_bulk` | `gallery_updated` | Selection UI |
| Pin / scrap | — | `workspace_add_pinned`, `workspace_remove_pinned`, `workspace_*_scrap` | `workspace_updated` | — |
| Move between workspaces | — | `workspace_move_files` | `workspace_image_added` | — |
| Workspace CRUD | — | `workspace_list`, `workspace_create`, … | `workspace_updated`, `workspace_activated` | Color/fonts/wallpaper UI |
| Gallery scroll restore | — | `gallery_position_hint` | `gallery_scroll_state` | — |
| Sequenzia export | — | `send_to_sequenzia_bulk` | — | — |
| Update image preset tag | — | `update_image_preset_bulk` | — | — |

---

## Presets & spellbook

| Feature | REST | WS | Push | Client-only |
|---------|------|-----|------|-------------|
| List / search presets | — | `get_presets`, `search_presets` | `preset_updated` | Preset manager UI |
| Load / save / delete | — | `load_preset`, `save_preset`, `update_preset`, `delete_preset` | `preset_updated` | — |
| Preset groups | — | `get_preset_groups`, `save_preset_group`, `delete_preset_group` | `preset_group_updated` | — |
| Regenerate UUID | — | `regenerate_preset_uuid` | — | — |

---

## Search, tags & wiki

| Feature | REST | WS | Push | Client-only |
|---------|------|-----|------|-------------|
| Tag search | — | `search_tags`, `search_dataset_tags` | — | Autocomplete UI |
| Autofill ranking config | — | `get_autofill_ranking`, `update_autofill_ranking`, `test_autofill_ranking` | `autofill_ranking_updated` | autofillConfigDsapApplet (admin) |
| File search | — | `search_files` | `search_results_*` | File search modal |
| Tag wiki / Grimoire | `GET /private/wiki/*` (cached pages) | `search_tag_wiki`, `get_tag_wiki_page`, `refresh_tag_wiki_page`, `resolve_grimoire_url` | — | DSAP router, panes |
| Static NovelAI docs | — | `get_static_wiki_site_index`, `get_static_wiki_page` | — | — |
| Character search | `GET /characters.json` | `search_characters` | — | Modal UI |
| Search index admin | — | `search_index_*` | `search_indexing_status` | — |
| Spellcheck custom word | — | `spellcheck_add_word` | — | — |
| NAX tags | `GET /naxCache/...` | `get_nax_*`, `set_nax_*`, `generate_nax_custom_tag` | — | NAX applets |

---

## References, uploads, vibes

| Feature | REST | WS | Push | Client-only |
|---------|------|-----|------|-------------|
| Reference library | `GET /cache/...` | `get_references`, `upload_reference`, … | — | Reference manager UI |
| Vibe encoding | — | `encode_vibe`, `check_vibe_encoding`, `import_vibe_*` | — | — |
| URL download | `GET /temp/...` | `download_url_file`, `fetch_url_info` | — | — |
| Workspace image upload | — | `upload_workspace_image` | `gallery_updated` | Upload handlers |

---

## VFS & desktop

| Feature | REST | WS | Push | Client-only |
|---------|------|-----|------|-------------|
| VFS file download | `GET /{vfsPathUuid}/files/:id` | `vfs_download_file` | `vfs_updated` | Explorer applet |
| System cache binary download | `GET /{vfsPathUuid}/system/:encodedKey` | `vfs_download_system_file` | — | Explorer / System folder |
| VFS CRUD | — | `vfs_*`, `desktop_*` | `vfs_updated`, `workspace_desktop_persisted` | Desktop shortcuts |

---

## Chat & director

| Feature | REST | WS | Push | Client-only |
|---------|------|-----|------|-------------|
| Chat sessions | — | `create_chat_session`, `get_chat_sessions`, … | `chat_streaming_*` | Chat UI |
| Director AI training | — | `director_*` | `director_*` | Director modals |

---

## Prompt editor

| Feature | REST | WS | Push | Client-only |
|---------|------|-----|------|-------------|
| Weight Rack (emphasis groups) | — | — | — | `emphasisGroupsToolManager.js`, forge `emphasis_normalization` |

---

## Notes & knowledge

| Feature | REST | WS | Push | Client-only |
|---------|------|-----|------|-------------|
| Notepad | — | `notes_*` | `note_*` | Notepad manager |
| Knowledge memories | — | `list_knowledge_memories`, … | — | Memories DSAP |

---

## Settings & admin

| Feature | REST | WS | Push | Client-only |
|---------|------|-----|------|-------------|
| User global settings | — | `get_user_global_settings`, `update_user_global_settings` | — | Settings modals |
| Persona | — | `get_persona_settings`, `save_persona_settings` | — | — |
| Text replacements CRUD | — | `get_text_replacements`, … | — | Text replacement manager |
| Favorites | — | `favorites_*` | — | — |
| Config editor | — | `config_editor_*` | — | Config editor applet |
| Security center | — | `get_blocked_ips`, `set_admin_pin`, `list_application_keys`, … | — | securityCenterDsapApplet |
| API keys | — | `get_api_key_services`, `add_api_key`, … | — | apiKeyModal |
| Log viewer | `GET /{logViewerPathUuid}/*` | — | — | logViewerApplet |
| Pending queue admin | `GET /pending` | `cancel_pending_requests` | — | serverManagement |
| Runtime recompile | — | `recompile_runtime_assets`, `refresh_server_cache` | `runtime_compile_*`, `service_worker_cache_update` | — |
| Generation quips | — | `get_generation_quips`, `generation_quips_run`, … | `generation_quips_*` | quipsDsapApplet |
| App options / account bootstrap | — | `get_app_options`, `retry_account_data` | `account_data_health_updated` | accountDataBootstrap.js |
| Traces | `GET /traces/*` | — | — | traces.js UI |

---

## Replication (master / child / ephemeral)

| Feature | REST | WS | Push | Client-only |
|---------|------|-----|------|-------------|
| Replication status | `GET /replication/status` | `replication_status` | — | DSAP Replication tab |
| Master separation bundle | `POST /replication/separation/prepare`, `GET …/status/:jobId`, `GET …/download/:manifestId` | `replication_separation_prepare`, `replication_separation_status` | `replication_progress`, `replication_maintenance` | dataManagementDsapApplet |
| Child bootstrap | `POST /replication/separation/bootstrap/preview`, `…/apply` | `replication_separation_bootstrap_preview`, `replication_separation_bootstrap_apply` | `replication_maintenance`, `replication_progress` | replicationDsapSeparation.js |
| Full sync (child) | `POST /replication/sync/begin`, `GET /replication/sync/status` | `replication_sync_begin`, `replication_sync_status`, `replication_sync_apply` | `replication_sync_status`, `replication_sync_complete`, `replication_maintenance` | replicationDsapSync.js |
| Partner sync (token) | `POST /replication/sync/export`, `/ack`, `/partner/begin`, `/partner/complete` | — | — | — |
| Cargo export/import | `POST /replication/cargo/export`, `/import/begin`, `/import/complete`, `GET/PUT /replication/cargo/stream/:id` | — | `replication_progress` | replicationDsapCargo.js |
| Upsert to master | `POST /replication/cargo/upsert/begin`, `/send`, `/complete` | — | `replication_maintenance`, `replication_progress` | DSAP Cargo panel |
| Remote gallery assets | `GET /replication/assets/:kind/:key` | — | — | assetUrlResolver.js |
| Shared gallery merge | — | `request_gallery` + `galleryShowSharedRemote` | — | `#galleryToggleGroup` context menu, `galleryShowSharedRemote` localStorage |
| Master unreachable banner | — | `request_gallery` → `replicationWarning` | — | replicationGalleryBanner.js |
| Wiki/autocomplete delegation | `GET /replication/delegation/bridge-config` | `authenticate_replication`, `replication_delegate`, `replication_delegation_status` | — | masterWsBridge.js |
| Blocks mode warning | `GET /replication/cargo/blocks-warning`, `GET /replication/sync/blocks-warning` | — | — | Confirmation dialog in DSAP |

CLI scripts (no UI): `scripts/replication-separate.js`, `replication-bootstrap.js`, `replication-export-cargo.js`, `replication-import-cargo.js`.

Operational guide: [README-CHILD.md](../../README-CHILD.md).

---

## Android / notifications

| Feature | REST | WS | Push | Client-only |
|---------|------|-----|------|-------------|
| Background credit notification | `GET /android/background-notification` | — | — | AndroidBackgroundRefresh bridge |
| Native notifications | — | — | — | AndroidNotification bridge |

---

## Counts summary

| Category | Count |
|----------|-------|
| Documented REST route groups | ~25 explicit + static |
| WS request types (client → server) | **277** |
| WS server push types (common) | **~50** |
| Auth flows | **3** (PIN session, Bearer loginKey, dev key — dev middleware exists but is **not mounted** on any route; see [authentication.md](./authentication.md#development-auth)) |

---

## Handler source index

| Domain | Server module |
|--------|---------------|
| Generation | `modules/ws/handlers/generationImpl.js` |
| Gallery | `modules/ws/handlers/120-galleryHandler.js` |
| Workspace | `modules/ws/handlers/90-workspaceHandler.js` |
| References | `modules/referencesWebSocketHandlers.js` |
| VFS | `modules/vfsWebSocketHandlers.js` |
| All packets | `modules/ws/handlers/*.js` + registry |
| Replication | `modules/replication/routes/*.js`, `200-replicationHandler.js` |
