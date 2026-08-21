# Emphasis Group ID Syntax (Weight Rack compiled form)

**Status:** backend-first. Invisible wire form; client toolbar chip + Apply→ids still phased.

## Goal

While Weight Rack owns a prompt (or any field that has managed groups), numeric weights leave the prompt. Groups become **fully invisible** id delimiters so caret/edits cannot corrupt weights and the prompt looks unmarked. Weights live in forge / request metadata. The **server** is the only path allowed to turn ids back into NovelAI `N::…::` before calling NAI. Highlighting / toolbar chips are the client visual cues.

## Wire form

```
<OPEN_MAGIC><id_bits>  text contents  <CLOSE_MAGIC><id_bits>
```

- **No surrounding colons** in **hidden** mode — delimiters are invisible format characters only.
- **Visible** mode (editor): `1.2:<OPEN_MAGIC><bits>:text:<CLOSE_MAGIC><bits>:` — weight digits editable; ZWSP still between colons. Server expand absorbs the leading `N` into the open span and prefers forge `groupsById` when present.
- Classic unmanaged remains: `1.35::text::` / auto-terminating `1.35::text`
- **Legacy colon wrap** (`:MAGIC+bits:` without leading weight) is still accepted by the scanner.
- **Brace/bracket groups stay classic** in v1 (`{…}`, `[…]` unchanged).
- Close delimiter carries the **same id** as open so adjacent groups cannot mis-pair.

### Alphabet / capacity

| Piece | Code points | Role |
|-------|-------------|------|
| Shared prefix | U+2060 WORD JOINER | Marks a managed barrier |
| Open mark | U+2063 INVISIBLE SEPARATOR | After WJ → open |
| Close mark | U+2064 INVISIBLE PLUS | After WJ → close |
| Id bits | U+200B ZWSP = 0, U+200C ZWNJ = 1 | Binary id |

- Id width: **8 bits (256 slots)**. Weight Rack realistically uses ≤64; extras absorb retirement without early recycle.
- Recycle policy: **do not reuse an id until free pool is empty**, then cycle oldest retired. Client owns allocation; server only resolves what forge maps.

Clipboard copy (client, later) may expand to a longer portable token + track id in a temp global clipboard table; that is **not** the in-prompt encoding.

## Source of truth

| Concern | Location |
|---------|----------|
| Id ↔ weight / share / lock | `forge_data.emphasis_normalization[field].groupsById` (and request body mirror) |
| Min / max / mode flags | Existing `emphasis_normalization` field state |
| Prompt text | Invisible id delimiters only when managed |

If id delimiters appear but forge entry is missing → expand fails closed: strip managed magics, leave bare text, log warning (do **not** invent weights).

## Always-managed rule

If **any** managed id delimiter is present in a prompt field, that field is treated as managed: classic `N::` leftovers in the same field must be **imported** (client) or rejected/stripped (server expand path expects ids already resolved client-side; server expands ids from forge, then classic normalize runs).

Unmanaged ZWSP / format chars (Cf) that are **not** part of a valid open/close magic+id sequence are **stripped** — never accepted as user text.

## Generation pipeline (server)

Order relative to existing flow:

1. Dynamic / locked replacements → `processedPrompt` (may still contain ids).
2. **Early expand** (`expandEmphasisGroupIds`): ids + forge weights → classic `N::…::`.
3. **Strip unmanaged invisibles**.
4. Existing `sanitizeAndNormalizeText` / `normalizeEmphasisPromptSyntax`.
5. **Late assert**: no managed magic remains; if found, strip + log (never send magics to NAI).

Token counting / UC splitters / `stripEmphasisSyntax` must understand **both** forms (or run after expand). Client token helpers should strip managed delimiters the same way they ignore numeric emphasis markers once codecs exist client-side.

## Dev / test harness

- Console: `debugConvertManualPromptsToManagedEmphasis()` — classic `N::` in the manual editor → invisible ids + forge `groupsById` (dual-write textarea.id + semantic keys). Then Generate to verify server expand.
- Client mirror: `public/scripts/comp/emphasisGroupIdCodec.js` (keep in sync with `modules/emphasisGroupIdSyntax.js`).
- Node smoke: `node scripts/test-emphasis-group-id-syntax.js`

## Client phases

**In progress / next**

- Prompt toolbar chip: icon outside group; 1dp weight or `%` inside; click → direct emphasis toolbar
- Dev convert harness (above)

**Still deferred**

- Weight Rack Apply → convert classic → ids, write forge map
- Apply context menu **Compile** → ids → classic, clear forge, close tool
- Prompt context menu **Copy Normalised Text**
- Internal drag id-preserving move
- Global “converted mode” flag safety

**Done (client clipboard)**

- Copy / Cut expand managed selection → classic `N::…::` (+ bag prune on cut)
- Paste settle → `importUnmanagedEmphasisGroupsForTextarea` (main ↔ character)
- Drag between prompt fields → classic expand + sibling-bag weight migrate/remap on drop

## Touch points to verify before client convert

| Area | Status / note |
|------|------|
| `modules/imageGeneration.js` sanitize / buildOptions | **Wired** — expand before classic normalize; field hints for weight coalesce |
| `modules/emphasisPromptSyntax.js` | OK — runs **after** expand only |
| `modules/emphasisGroupIdSyntax.js` | **Done** — invisible codec + legacy colon accept + prepare + strip |
| `stripEmphasisSyntax` | **Updated** — strips managed delims first |
| Text replacements / pipeline stages | Replacements run **before** sanitize; ids survive until expand (intended) |
| Client `presetTokenCount.js` / T5 | **Deferred** — strip delimiters once client has codec mirror |
| `pngMetadata` forge keys | Already persists `emphasis_normalization`; `groupsById` nested when client writes it |
| Grok / AI validators | Downstream of expand for gen; workstation prompt edit still classic until client convert |
| Phase walker / stage prompts | Same sanitize path on final buildOptions; stage drafts may hold ids until then |
| Request text expanders / DSAP | Same — expand only at NAI-bound sanitize |

## Related

- Weight Rack status: `docs/design/emphasis-weight-management-todo.md`
- Client invariants: `.cursor/rules/emphasis-weight-rack-invariants.mdc`
