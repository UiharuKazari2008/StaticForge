# Weight Rack (emphasis groups) — current status

**Scope:** client Normalize tool + managed id syntax (hidden / visible).  
**Primary UI:** `public/scripts/comp/emphasisGroupsToolManager.js`  
**Math / distribution:** `public/scripts/comp/emphasisWeightMath.js`, `public/scripts/comp/emphasisSubgroup.js`  
**Managed ids:** `docs/design/emphasis-group-id-syntax.md`, `modules/emphasisGroupIdSyntax.js`, `public/scripts/comp/emphasisGroupIdCodec.js`  
**Invariants:** `.cursor/rules/emphasis-weight-rack-invariants.mdc`

## What remains (active todos)

| Todo | Notes |
|------|--------|
| **Copy Normalised Text** | Prompt menu: expand + normalize separators for sharing. |
| **Shift-select across group borders** | Mostly fixed: Shift+Arrow/Home/End no longer jump/collapse at delimiters. Still verify mouse drag + merge-by-delete of close+next-open; pair with blur recovery. |
| **Passive input journal (blur recover)** | High-speed, low-cost passive keyboard/beforeinput journal per managed field while focused. On blur, classify actions (typed `::`, selection overwrite across delimiter, merge delete, start/end trim) and run recovery: reattach end/start markers, import classic leftovers, strip orphan ZW, rewrite visible mode. Do not block the input hot path. |
| **Visible-mode mangle recovery** | Unpaired close inside auto-term open span verified (`orphanIds: [22]` → `unkStripped 10→0`). Blur settle now removes unpaired closes + classic import. Still need: selection overwrite, start-marker repair, passive journal. |
| **Client script hot-reload** | Wanted: selective SW / runtime hot-swap for `public/scripts/comp/*` without full page reload (keep textarea state). Likely needs per-asset headers/metadata (`hotReload: true`), clearer component boundaries, and a reload channel that re-evaluates script tags or module graph safely. Until then, ship console pastes for pre-reload verification. |

## Clipboard / copy-paste (implemented)

| Topic | Behavior |
|-------|----------|
| **Copy** | Only when selection fully contains a group (or includes delimiters): expand to classic `N::…::`. Partial inner selections stay native. |
| **Cut** | Same gate; deletes exactly the selection (never promotes partial → whole group) |
| **Paste** | Take over only when clipboard has classic/managed emphasis; plain paste stays native |
| **Drag** | Same gate as copy; segment moves stay native. Weighted full-group drags expand + settle / sibling migrate |
| **Partial select** | Mid-group selection copies overlapping inner text only (no weight) |
| **Copy Normalised Text** | Still deferred (prompt-menu action) |

## Recently done

- Cross-field text drag (main ↔ character): expand on dragstart + migrate sibling `groupsById` on drop
- Clipboard copy/cut expand managed → classic `N::` + paste import into target field (main ↔ character)
- Managed end marker: Delete on/inside close removes it (auto-terminate); typed `::` adds or moves the close
- Direct emphasis writes managed groups in current visibility mode; digits remap into normalize band when enabled
- Alt+E select-to-group / edit (shortcut toast)
- Edit Emphasis percent UI + Suggested when forge normalize enabled (WR need not be open)
- Semitransparent outline floor on group highlights
- Weight Rack comma-split / neighbor-merge for managed cards
- Emphasis highlight paints managed + visible from `groupsById`
- Weight Rack Apply / gen flush write `groupsById` + visible rewrite
- Blur import of classic `N::` into current mode
- Show Syntax toggle + chip icon-row menu
- Caret jump past ZWSP + spaces when leaving groups
- Show Syntax global preference; Token Analysis uses same managed strip as token bar
- UC / inline-negative managed expand + caret guards

## Dump notes (2026-07-14)

- Intact hidden UC/neg: `unkRaw ≈ zw.total`, `unkStripped: 0` (strip works).
- `character_0_prompt` visible: first open unterminated (`closeLen: 0`), `unkStripped: 10` → orphan ZW left after block strip.
- `character_1_prompt` trailing open unterminated; innerPreview showed non-group junk at end — bisected delimiters.

## Syntax modes (editor)

| Mode | Wire form | Weights |
|------|-----------|---------|
| **hidden** (Show Syntax off) | `…<ZOPEN>tags<ZCLOSE>…` | forge `groupsById` only |
| **visible** (Show Syntax on) | `…1.2:<ZOPEN>:tags:<ZCLOSE>:…` | digits editable + forge map |

Classic `1.2::tags::` is **not** a client menu mode — on blur/paste settle it is imported into the current mode. Server still expands classic unmanaged fine for NAI.

Dial chip **context menu**: icon row (Edit / Split / Remove / Weight Rack); list (Show Syntax toggle, Remove All).

## Generation order

1. Dynamic / locked text replacements → `processedPrompt`
2. `sanitizeAndNormalizeText`: prepareEmphasisTextForNovelAI (id expand; visible weight prefix absorbed) → normalize separators → `normalizeEmphasisPromptSyntax`
