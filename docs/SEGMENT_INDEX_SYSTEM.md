# Segment Index System Documentation

## Overview

This document explains the **segment_index** system that replaced direct `select_text` usage by the AI in the dynamic generation system. This architectural change prevents the AI from "guessing" text selections and ensures all replacements reference valid prompt segments.

## Problem Statement

### Original Issue

The AI was generating `select_text` values that:
- Did not exist verbatim in the original prompts
- Were syntactically incorrect
- Sometimes omitted `replace_text` for `replace` actions
- Failed validation frequently, causing retries and wasted tokens

### Root Cause

Even with strong instructions in the system prompt, the probabilistic nature of LLMs allowed the AI to "invent" text strings instead of using exact substrings from the prompts. The AI could not reliably match text verbatim from complex prompts.

## Solution Architecture

### Core Concept

**The AI never sees or uses `select_text` directly.** Instead:
1. The AI provides `segment_index` (0-based index into comma-separated segments)
2. The server hydrates `segment_index` → `select_text` before any processing
3. The rest of the system uses `select_text` as before

### Segmentation Logic

Prompts are split by commas (respecting `::weight::content::` emphasis groups):

```
"2::deep shadows, expert lighting::, cityscape background"
```

Becomes:
- `segment[0]`: `"2::deep shadows, expert lighting::"` (weight: 2, innerItems: ["deep shadows", "expert lighting"])
- `segment[1]`: `"cityscape background"` (weight: null)

### Segment Index Format

1. **Integer** (e.g., `0`, `1`, `2`): Targets entire segment
2. **String** (e.g., `"0.1"`): Targets inner item within an emphasis group (segment 0, inner item 1)
3. **Array** (e.g., `[0, 1, 2]`): 
   - **For REPLACE**: Must be continuous (e.g., `[0, 1, 2]` ✅, `[0, 2, 5]` ❌)
   - **For DELETE**: Can be non-continuous (e.g., `[0, 2, 5]` ✅)

## Files Modified

### 1. `/modules/promptSegments.js` (NEW FILE)

**Purpose**: Parses prompt strings into structured segments.

**Key Function**:
```javascript
function parsePromptSegments(text)
```

**Returns**: Array of segment objects:
```javascript
[
  {
    text: "2::deep shadows, expert lighting::",
    weight: 2,
    innerItems: ["deep shadows", "expert lighting"]
  },
  {
    text: "cityscape background",
    weight: null,
    innerItems: []
  }
]
```

### 2. `/modules/aiServices/grokService.js`

#### Changes Made:

**A. Tool Schema (`validateTextReplacement`)**:
- ✅ Added `segment_index` property (integer, string, or array)
- ✅ Removed `select_text` from schema (AI never sees it)
- ✅ Removed `fallback_select_text` (deprecated, completely removed)
- ✅ Updated `alternative_text` description to remove `select_text` references

**B. `handleValidateTextReplacement` Function**:
- ✅ Added `parsePromptSegments` import
- ✅ Added `hydrateFromSegments` helper function
- ✅ Added `validateSegmentIndex` function (checks for missing indices, continuity for REPLACE arrays)
- ✅ Hydration happens BEFORE `buildPromptWithReplacements` and validation
- ✅ `segment_index` is kept in replacement objects (for error messages only)

**C. `validateTextReplacements` Function**:
- ✅ Handles `select_text` as array (after hydration)
- ✅ Iterates through array for validation checks

**D. `buildFailureMessage` Function**:
- ✅ Updated to reference `segment_index` in error messages
- ✅ Renamed `MISSING_SELECT_TEXT` → `MISSING_SEGMENT_INDEX`

#### Key Code Snippet (Hydration):

```javascript
const hydrateFromSegments = (replacements, segments) => {
    if (!Array.isArray(replacements) || !Array.isArray(segments)) return;
    replacements.forEach(rep => {
        const idx = rep.segment_index;
        if (idx === null || idx === undefined) return;

        const indexToText = (index) => {
            // Handle "X.Y" format for inner items
            if (typeof index === 'string' && index.includes('.')) {
                const [segIdx, innerIdx] = index.split('.').map(Number);
                if (segments[segIdx]?.innerItems?.[innerIdx]) {
                    return segments[segIdx].innerItems[innerIdx];
                }
                return null;
            }
            // Handle integer or string integer
            const segIdx = typeof index === 'string' ? parseInt(index, 10) : index;
            if (segments[segIdx]) {
                return segments[segIdx].text;
            }
            return null;
        };

        // Handle array of indices
        if (Array.isArray(idx)) {
            const segmentTexts = idx.map(indexToText).filter(text => text !== null);
            if (segmentTexts.length > 0) {
                rep.select_text = segmentTexts; // Array of select_text values
            }
        } else {
            // Handle single index
            const segmentText = indexToText(idx);
            if (segmentText) {
                rep.select_text = segmentText;
            }
        }
    });
};
```

### 3. `/modules/dynamicGenerationSchema.js`

#### Changes Made:

**Zod Schema for Dynamic Generation Response**:
- ✅ Replaced all `select_text` properties with `segment_index`
- ✅ `segment_index` uses `z.union([z.number(), z.string(), z.array(...)])`
- ✅ Updated descriptions to explain continuity rules for REPLACE vs DELETE arrays
- ✅ Marked `fallback_select_text` as `z.never().optional()` (deprecated)

### 4. `/modules/dynamicGenerationHandlers.js`

#### Changes Made:

**A. Stage 1 User Message**:
- ✅ Creativity mode rule updated: "use only `segment_index` values from segment lists"
- ✅ Removed `select_text` references

**B. Stage 1 Retry (Correction Mode)**:
- ✅ Updated to show `segment_index` from failed replacements
- ✅ Maps `failedReplacements` back to `segment_index` using `candidateData.text_replacements`
- ✅ Shows: `segment_index \`0\`` or `segment_index \`[0, 1, 2]\``

**C. Stage 2 Retry (Correction Mode)**:
- ✅ Updated to show `segment_index` from previous attempt
- ✅ Uses `previousPhase2Data` and `previousValidationResults` tracking
- ✅ Shows `segment_index` instead of hydrated `select_text`

**D. Locked Replacements Display**:
- ✅ Shows `segment_index` if present (new format)
- ✅ Falls back to `select_text` for backwards compatibility

**E. Segment Display**:
- ✅ Added segment lists after each prompt (Base Prompt, Negative Prompt, Character Prompts)
- ✅ Shows 0-based indices, emphasis weights, and X.Y inner item indices
- ✅ Format:
  ```
  **Base Prompt Segments (for segment_index):**
  0: [2x] 2::deep shadows, expert lighting::
    0.0: deep shadows
    0.1: expert lighting
  1: cityscape background
  ```

**F. Internal Functions**:
- ✅ `applyDynamicReplacements` handles `select_text` as array (after hydration)
- ✅ All server-side processing uses hydrated `select_text` (transparent to AI)

### 5. `/modules/systemMessageBuilder.js`

#### Changes Made:

**A. Core Task Overview**:
- ✅ Updated to explain `segment_index` usage (integer, "X.Y", arrays)
- ✅ Removed all `select_text` references

**B. Actions Table**:
- ✅ Shows `segment_index` as required for REPLACE/DELETE
- ✅ Added "Segment Index Format" section explaining continuity rules

**C. Required Fields Reference**:
- ✅ Replaced `select_text` with `segment_index` descriptions
- ✅ Explains array usage and continuity rules

**D. Emphasis Groups Guide**:
- ✅ Updated to use `segment_index` for targeting groups and inner items

**E. Replacement Planning**:
- ✅ Updated checklist and examples to use `segment_index`

**F. Validation Checklists**:
- ✅ Updated all checklists to reference `segment_index`

**G. Feedback Section**:
- ✅ Shows `segment_index` if available (new format)
- ✅ Falls back to `select_text` for backwards compatibility

**H. Memory Section**:
- ✅ Clarified that `segment_index` must come from segment lists, not memories

**I. Locked Replacements**:
- ✅ Updated to reference `segment_index` for adapting locked replacements

### 6. `/modules/websocketHandlers.js`

**No changes required** - This file only passes data through. The hydration happens in `grokService.js` before any processing.

## System Flow

### Complete Call Stack

```
1. AI receives user message with segment lists
   ↓
2. AI calls validateTextReplacement with segment_index values
   ↓
3. handleValidateTextReplacement:
   a. Validates segment_index (missing, continuity for REPLACE)
   b. Parses prompts into segments (parsePromptSegments)
   c. Hydrates segment_index → select_text (hydrateFromSegments)
   ↓
4. buildPromptWithReplacements (uses hydrated select_text)
   ↓
5. validateTextReplacements (validates hydrated select_text)
   ↓
6. applyDynamicReplacements (uses hydrated select_text)
   ↓
7. Return results to AI (with segment_index preserved for errors)
```

### Error Flow

```
1. Validation fails (e.g., segment_index 5 doesn't exist)
   ↓
2. buildFailureMessage includes segment_index in error
   ↓
3. Retry message shows: "segment_index `5` failed validation"
   ↓
4. AI sees segment_index (never sees select_text)
```

## Key Design Decisions

### 1. Why Keep `segment_index` in Replacement Objects?

- **Error Messages**: AI needs to know which `segment_index` failed
- **Debugging**: Server logs can trace from `segment_index` → `select_text`
- **Backwards Compatibility**: Old stored replacements might have both

### 2. Why Hydrate Before Everything Else?

- **Guarantee**: Ensures `select_text` always exists for validation
- **Isolation**: Rest of system never needs to know about `segment_index`
- **Performance**: Single conversion point, not scattered throughout

### 3. Why Continuity Rules for REPLACE Arrays?

- **Semantic Correctness**: Replacing `[0, 1, 2]` means "replace segments 0, 1, 2 with a single replacement"
- **Non-continuous arrays** (e.g., `[0, 2, 5]`) don't make sense for replacement (different segments can't be combined)
- **DELETE doesn't need continuity** - deleting multiple separate segments is valid

### 4. Why Show Segment Lists in User Messages?

- **Transparency**: AI can see exactly what indices are available
- **Accuracy**: No guessing which index maps to which text
- **Debugging**: AI can verify its `segment_index` choices

## Testing Checklist

When making edits to this system, verify:

- [ ] AI never sees `select_text` in tool schemas
- [ ] User messages show `segment_index` (not `select_text`)
- [ ] Error messages reference `segment_index`
- [ ] Hydration happens before validation
- [ ] Arrays work for both REPLACE (continuous) and DELETE (non-continuous)
- [ ] Inner items work with "X.Y" format
- [ ] Segment lists display correctly in user messages
- [ ] Retry messages show `segment_index` from failures
- [ ] Locked replacements show `segment_index` if present

## Future Maintenance

### Adding New Prompt Types

If adding new prompt types (e.g., `style_prompt`):

1. **Tool Schema**: Add `segment_index` property (same as prompt/uc)
2. **Zod Schema**: Add `segment_index` property (same format)
3. **Hydration**: Add hydration call in `handleValidateTextReplacement`
4. **Display**: Add segment list display in user message
5. **Validation**: Ensure validation handles the new type

### Modifying Segmentation Logic

If changing how prompts are split:

1. **Update `parsePromptSegments`** in `promptSegments.js`
2. **Test hydration** with various prompt formats
3. **Update segment display** in user messages
4. **Update system message** documentation if format changes

### Adding New Actions

If adding new replacement actions:

1. **Tool Schema**: Add to `action` enum
2. **Hydration**: Determine if `segment_index` is required (probably yes, except APPEND)
3. **Validation**: Add action-specific validation rules
4. **System Message**: Document action in Actions Table

## Common Issues & Solutions

### Issue: AI provides invalid `segment_index`

**Solution**: Validation in `validateSegmentIndex` catches this before hydration. Error message shows which `segment_index` failed.

### Issue: Hydration produces empty `select_text`

**Solution**: Check that `parsePromptSegments` is correctly splitting prompts. Verify index math for "X.Y" format.

### Issue: REPLACE array fails continuity check

**Solution**: Ensure AI knows REPLACE arrays must be continuous. Check system message documentation.

### Issue: Segment lists don't match actual segments

**Solution**: Verify `parsePromptSegments` matches the same logic used for hydration. They must use identical parsing.

## References

- **Segmentation Logic**: `/modules/promptSegments.js`
- **Tool Schema**: `/modules/aiServices/grokService.js` (line ~2360)
- **Zod Schema**: `/modules/dynamicGenerationSchema.js`
- **System Message**: `/modules/systemMessageBuilder.js`
- **User Messages**: `/modules/dynamicGenerationHandlers.js` (Stage 1: ~10189, Stage 2: ~11774)

## Migration Notes

### From Old System (select_text)

Old stored replacements with `select_text` are still supported:
- Locked replacements show `select_text` if `segment_index` not present
- Feedback entries show `select_text` if `segment_index` not present
- Server-side functions handle both (though only `segment_index` is used for new replacements)

### To New System (segment_index only)

All new replacements **must** use `segment_index`:
- Tool schema no longer accepts `select_text` from AI
- Zod schema validates `segment_index` only
- System message explains `segment_index` exclusively

---

**Last Updated**: 2024-12-19
**Version**: 1.0

