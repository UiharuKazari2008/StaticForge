# Segment index and Tendai hydration

## Intent

Dynamic generation does not ask an AI response to invent `select_text` strings. The model returns a compact **Tanei** payload that references prompt text by `segment_index`; the server hydrates that payload into **Tendai** replacements with exact `select_text` values before validation and application.

This protects generation from common selector failures:

- guessed text that is not present in the prompt;
- selectors that cross protected prompt regions;
- append anchors that target a segment after another replacement has changed it;
- stale retry messages that point at hydrated text instead of the original index contract.

## Source of truth

| Concern | File | Notes |
|---------|------|-------|
| Segment parsing and hydration | `modules/promptSegments.js` | `parsePromptSegments`, `resolveSelectTextFromSegments`, and `hydrateTextReplacements` are the authoritative implementation. |
| Dynamic response schema | `modules/dynamicGenerationSchema.js` | Normalizes `segment_index` values and defines the response shape for prompt, UC, and character prompt replacements. |
| Grok validation tool | `modules/aiServices/grokService.js` | `validateTextReplacement` prechecks required indices, hydrates Tanei to Tendai, builds a preview, and returns retry details. |
| Replacement application | `modules/dynamicGenerationHandlers.js` | `applyDynamicReplacements` consumes hydrated Tendai replacements and applies delete/replace work before append work. |
| Generation runtime | `modules/imageGeneration.js` | Applies cached dynamic replacements to base prompt, negative prompt, and character prompts before the request is sent. |
| WebSocket preview | `modules/ws/handlers/generationImpl.js` | `apply_tendai_preview` applies a Tendai preview; `resolve_text_replacements` runs stored text-replacement presets. |

## Runtime flow

1. Dynamic generation prepares the prompt text.
   - `processDynamicGenerationCore` expands managed emphasis group ids through `modules/emphasisGroupIdSyntax.js` before prompt text is sent to the AI or parsed for segment hydration.
   - Base prompt, negative prompt, and each character prompt/UC field are handled separately.
2. The AI returns text replacements with `segment_index` values.
   - The public contract is numeric: integers for whole segments, decimals for inner items, arrays for multi-segment operations, and `-1` for append-to-end.
   - `replace_text` is required for `replace` and `append`; it must be omitted or empty for `delete`.
3. `validateTextReplacement` checks the index shape before hydration.
   - Every action must provide `segment_index`; append-to-end should use `-1` explicitly.
   - Empty arrays fail.
   - `replace` arrays must be continuous by outer segment index, such as `[2, 3, 4]`.
4. `hydrateTextReplacements` parses the source prompts and resolves each index.
   - It writes exact `select_text` values back into the replacement objects.
   - It records hydration pressure metadata (`low`, `moderate`, `high`, `invalid`) and locked segment lists for diagnostics.
   - Same-segment appends can be re-anchored when a prior replace/delete changes the target segment.
5. Validation and preview run against the hydrated replacement object.
   - `grokService.validateTextReplacements` trusts successful Tendai hydration for replace/delete text existence checks, then applies safety checks such as protected `artist:` tags, nested emphasis groups, replacement text requirements, and text-boundary category rules.
6. Runtime generation applies the hydrated result.
   - `applyDynamicReplacements` phases delete/replace work before append work, merges appends that target the same final text, then applies append-to-end items.
   - The final prompt is produced in `imageGeneration.js` before the generation body is submitted.

## Parser contract

`parsePromptSegments(text)` returns an array of segment objects:

```js
{
  text: '1.4::deep shadows:: 1.2::rim light::',
  start: 0,
  end: 36,
  weight: 1.4,
  innerItems: ['1.4::deep shadows::', '1.2::rim light::'],
  innerItemPositions: [{ start: 0, end: 19 }, { start: 20, end: 36 }],
  separatorAfter: ', '
}
```

Rules verified against `modules/promptSegments.js`:

- Top-level commas split segments.
- Commas inside a `weight::content::` group stay inside that segment.
- A weight prefix is `[-]digits[.digits]::`; detection is shared through `detectWeightGroupStartGeneric`.
- Adjacent emphasis groups without a top-level comma are one segment with multiple `innerItems`.
- `innerItems` are exact substrings of the segment. Emphasis group delimiters stay in the item text.
- `innerItems` is empty unless the segment contains two or more extracted items.
- `start`, `end`, and `innerItemPositions` are offsets in the original JavaScript string. Hydration verifies the substring at those offsets before using it.
- `separatorAfter` preserves the original separator text between consecutive segments, usually `, ` or `,`.

Example:

```js
const {
  parsePromptSegments,
  resolveSelectTextFromSegments
} = require('./modules/promptSegments');

const prompt = '1.4::deep shadows:: 1.2::rim light::, city skyline, rain';
const segments = parsePromptSegments(prompt);

resolveSelectTextFromSegments(1, segments, prompt).text;
// 'city skyline'

resolveSelectTextFromSegments(0.1, segments, prompt).text;
// '1.2::rim light::'

resolveSelectTextFromSegments([0, 1], segments, prompt).text;
// '1.4::deep shadows:: 1.2::rim light::, city skyline'
```

## `segment_index` formats

| Shape | Meaning | Notes |
|-------|---------|-------|
| `3` | Whole segment 3 | Most reliable selector. |
| `3.1` | Inner item 1 within segment 3 | Decimals are parsed as one decimal digit by `parseSegmentIndex`; avoid multi-digit inner indices. |
| `[3, 4, 5]` | Multi-segment span | For `replace`, the outer segment indices must be continuous. |
| `-1` | Append to end | Only meaningful for `append`; no `select_text` is hydrated. |

Important constraints:

- JSON numbers cannot preserve `.0`. A public payload value of `3.0` reaches JavaScript as `3`, so it targets the whole segment, not inner item `0`. Use whole-segment selection when possible; if exact first-inner targeting is required, restructure the source prompt so the item is its own segment.
- The internal resolver still accepts legacy string forms like `'3.0'`, but the current public schema/tool contract is numeric and may normalize string input before hydration.
- `replace` with an array is one replacement over one continuous span. Use separate replacement entries when the changes are independent.
- `delete` arrays are not prechecked for continuity, but hydration resolves the text from the first valid selected offset through the last valid selected offset. If intervening segments must survive, use separate `delete` replacements instead of a non-contiguous array.
- `append` can target a segment index to anchor after that segment, or `-1` to append at the end of the prompt section.

## Safety and deconfliction behavior

Hydration handles selector consistency before `applyDynamicReplacements` changes text:

- Missing indices are invalid and counted in pressure metadata.
- Inner-item access locks the parent outer segment because the final edit still changes text inside that segment.
- If a replace/delete and an append target the same segment, hydration updates the append anchor to the replacement result because appends run after delete/replace work.
- Prefix-overlap replacements can be converted to appends with `anchor_text` metadata so the duplicated prefix is not repeated.
- `select_text_alarm` is set when offset verification fails or a fallback path reconstructs text.

The applicator then enforces prompt-level guardrails:

- text containing `artist:` is not modified;
- protected `!% ... %` blocks are not modified;
- only `Spelling` and `Text Overlay` replacement categories may edit after a `, Text:` boundary;
- `<br>` in `replace_text` is translated to newline before application;
- `segment_emphasis` wraps replacement text when provided, and selected emphasis can be preserved when no explicit value is set.

## Operational runbook

### When validation says a `segment_index` is missing

Check the raw Tanei payload first. Every replacement action needs `segment_index`; append-to-end should be explicit:

```json
{
  "action": "append",
  "segment_index": -1,
  "replace_text": "soft morning haze",
  "reason": "Add requested time-of-day detail",
  "reason_display": "Morning haze",
  "replacement_category": "Time of Day",
  "is_critical": true
}
```

### When hydration cannot resolve an index

1. Reproduce with `parsePromptSegments(prompt)` using the exact prompt text passed to validation.
2. Verify that managed emphasis ids were expanded if the prompt contains them.
3. Confirm that decimal indices target existing `innerItems`.
4. For character prompts, confirm the replacement path matches the character index and field (`prompt` or `uc`).

### When a multi-segment edit changes too much

Inspect whether the replacement used an array. Arrays hydrate to one text span from the first resolved offset to the last resolved offset. For non-contiguous edits, split the operation:

```json
{
  "prompt": [
    { "action": "delete", "segment_index": 2, "reason": "Remove rain", "reason_display": "No rain", "replacement_category": "Weather", "is_critical": true },
    { "action": "delete", "segment_index": 5, "reason": "Remove snow", "reason_display": "No snow", "replacement_category": "Weather", "is_critical": true }
  ]
}
```

### When an append lands in the wrong place

- Prefer anchoring to a whole segment index over an inner item unless the insertion is intentionally inside a compound emphasis segment.
- Check whether another replace/delete targets the same outer segment; hydration may re-anchor the append to the replacement result.
- If the append should go at the end of that prompt section, use `segment_index: -1`.

## Maintenance checklist

When editing this system, verify these paths together:

- `modules/promptSegments.js` parser output, offsets, and hydration alarms;
- `modules/dynamicGenerationSchema.js` accepted `segment_index` shapes;
- `modules/aiServices/grokService.js` validation failures and retry messages;
- `modules/dynamicGenerationHandlers.js` replacement phasing and guardrails;
- `modules/imageGeneration.js` cached replacement application for prompt, UC, and character prompts;
- `docs/client-api/ws/generation.md` if the WebSocket preview contract changes.

Focused checks:

```bash
node - <<'NODE'
const { parsePromptSegments, resolveSelectTextFromSegments } = require('./modules/promptSegments');
const prompt = '1.4::deep shadows:: 1.2::rim light::, city skyline, rain';
const segments = parsePromptSegments(prompt);
console.log(segments.map((s, i) => ({ i, text: s.text, innerItems: s.innerItems })));
console.log(resolveSelectTextFromSegments([0, 1], segments, prompt));
NODE
```

Run broader generation/auth checks only when code changes accompany the docs update.
