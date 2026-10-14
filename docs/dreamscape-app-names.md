# Dreamscape application names

User-facing applet and tool names follow a **Dreamscape** style: short, tangible objects or evocative roles—not generic OS labels (`File Explorer`, `Config Editor`, `Event Viewer`).

`launchId` values stay stable for shortcuts, Run aliases, and VFS routing. Only display names change.

## Adopted names

| launchId | Display name | Role |
|----------|--------------|------|
| `explore-gallery` | **Agora** | NovelAI Explore community image gallery |
| `explorer` | **Cartograph** | VFS browser (workspaces, files, notes, trash) |
| `config-editor` | **Runes** | Registry-style server config editor |
| `event-viewer` | **Periscope** | Admin log tail, vitals, WebSocket telemetry |

### Run search aliases (non-exhaustive)

- **Agora:** `agora`, `explore`, `explore gallery`, `image gallery`, `community gallery`
- **Cartograph:** `explorer`, `files`, `file explorer`, `cartograph`, `vfs`
- **Runes:** `config`, `settings`, `settings editor`, `runes`
- **Periscope:** `log`, `logs`, `console`, `periscope`, `event viewer`, `events`, …

## Dreamscape 2026 R7 package

Workspaces, DreamStudio and the tools around them ship as one software package, **Dreamscape 2026 R7** (Yukimi, 2026-10-13/14; Yozora #468). The package name is the version the splash screens, About boxes and the Welcome screen branding carry; the apps keep short names in their captions.

| launchId | Package name | Where the version shows |
|----------|--------------|-------------------------|
| `studio` | **DreamStudio** (caption "DreamStudio 2026 R7", `fullName` DreamStudio 2026 R7) | splash "DreamStudio / 2026 R7" |
| `workspace` | **Workspaces** (caption "Workspaces - Images", `fullName` Dreamscape Workspaces) | splash "Dreamscape Workspaces / 2026 R7" (`#workspaceSplash`, `appSplash.js`) |
| `spellbook` | Spellcaster | |
| `reference` | Reference | (splash planned, #496) |
| `bracket-generation` | Phasewalker | |
| `character-db` | Characters | |
| `expanders` | Expanders | |
| `presets` | Spellbook | |

Start menu: All Programs lists these in a **Dreamscape 2026 R7** folder (`START_MENU_PACKAGE_APPS` in `modalUtils.js`, next to Accessories) and not at the top level or in Accessories; pinned and most-used rows are unaffected. The Welcome screen (Use Vista Logon) carries "Dreamscape 2026 R7" at the bottom, the version in the light weight (`scripts/build-vista-logon-branding.sh`).

## Already on-brand (no rename planned)

| launchId / surface | Display name |
|--------------------|--------------|
| `studio` | Studio (`fullName`: DreamStudio 2026 R7) |
| `spellbook` | Spellcaster |
| `encyclopedia` | Grimoire |
| `alchemy` | Alchemy (Grimoire's remote browser, opens Home) |
| `naxt` | Atelier |
| `notebook` | Notion |
| `bracket-generation` | Phasewalker |
| `presets` | Spellbook (preset manager, Toolbox) |
| `expanders` | Expanders |
| `keychain` | Keychain |
| `solar-system` | Solar System |
| `memories` | Memories |
| `security-center` | Security Center |
| `dynamic-quips` | Dynamic Quips |
| `desktop-settings` | Personalize (modal title) |
| `zanzou` | **Zanzou** (Afterimage / similar-image keep-scrap, Control Panel) |
| `dovecote` | Dovecote (internal mail client) |
| `media-player` | Media Player (Windows Media Player 11 analogue; replaced the Music and Video windows, #454) |

## Reserved for later

Do not use these for the apps above or minor utilities—they are held for higher-impact features.

| Name | Intended use (rough) |
|------|----------------------|
| **Sigils** | Powerful inscribed symbols—director rules, generation macros, or another “castable” system feature |
| **Chronicle** | Narrative/historical record surface (was candidate for log viewer before Periscope) |
| **Scope** | Live signal instrument (alternate log/telemetry name) |
| **Wayfinder** | Alternate navigation metaphor (candidate for VFS before Cartograph) |
| **Reliquary** | Vault for treasured assets (references, styles, or curated collections) |
| **Seismograph** | Event/wave instrument (heavy telemetry UI) |
| **Ledger** | Audit trail / commit history surface |
| **Oracle** | Prophecy / SI guidance (director-adjacent) |
| **Prism** | Signal decomposition / pipeline inspector |

## Rename candidates (not scheduled)

These still read generic next to the adopted set. Revisit when touching those surfaces.

| Current | launchId / location | Notes |
|---------|---------------------|--------|
| **Workspaces** | `workspace` | Gallery window, renamed from Workspace with the 2026 R7 package (#468); could still align with the planet metaphor |
| **Reference** | `reference` | Cache/vibe manager; *Reliquary* or *Swatchbook* reserved/alternate |
| **Favorites** | `favorites` | Plain; low priority |
| **Chat** / **Chat Persona** | `chat`, `chat-persona` | Functional; rename only if chat gets a stronger fantasy identity |
| **Import** | `import` | Short and clear; OK as utility verb |
| **Task Manager** | `websocketRequestsModal` | Legacy WS request window; Periscope sidebar supersedes most use |
| **Spellbook** vs **Spellcaster** | `presets` vs `spellbook` | Two different apps; naming overlap confuses Run search |

## Where display names are defined

- Start menu / app menu: `public/scripts/comp/modalUtils.js` (`startMenuLaunchables`, `buildToolsSubmenuItems`)
- Run aliases: `public/scripts/comp/runCommandIndex.js` (`RUN_APP_ALIAS_GROUPS`)
- Modal titles: `public/app.html` + respective `*Applet.js`
- VFS system shortcuts: `modules/vfsSystemProvider.js` (`SYSTEM_SHORTCUTS`)
