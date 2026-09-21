# Studio model capability gates

Studio model selection is driven by a shared capability map rather than scattered
per-model checks. The goal is to keep the web chrome, restored metadata, and
server request path aligned when NovelAI adds or removes model features.

## Source of truth

| Layer | File | Role |
|-------|------|------|
| Capability data | `config/model-features.json` | Forge model keys (`v5`, `v4_5`, `v3`, etc.) with API slugs, tokenizers, limits, and booleans such as `varietyPlus` and `noiseScheduleUi` |
| Server loader | `modules/modelFeatures.js` | Boot-cached JSON loader plus helpers for API slug resolution and dataset aliases |
| App options WS | `modules/ws/handlers/160-quipsHandler.js` | Sends the map as `modelFeatures` in `get_app_options_response` |
| Client lookup | `public/scripts/comp/utilities.js` | `getForgeModelFeatures()` reads `optionsData.modelFeatures`; `updateV3ModelVisibility()` applies UI gates |
| Generation path | `modules/imageGeneration.js` | Enforces the same caps for vibe injection, API model slug resolution, dataset aliases, and Max Enhance |

The JSON is cached by the server after first load. Treat edits to
`config/model-features.json` as requiring a server restart unless you add an
explicit cache invalidation path.

## Capability fields used by Studio chrome

| Field | Current behavior |
|-------|------------------|
| `vibeTransfer: false` | Hides vibe transfer UI and skips server-side vibe text injection. Switching to the model clears loaded vibe references. |
| `preciseReference: false` | Hides the Director / precise reference section. Switching to the model clears the active precise reference. |
| `varietyPlus: false` | Hides every Variety+ button (`#varietyBtn`, `button.toggle_variety`, stage buttons ending `_varietyBtn`) and forces their state off. |
| `noiseScheduleUi: false` | Hides expansion/enhance noise scheduler chrome, omits noise scheduler options from manual and pipeline sampler dropdowns, hides sampler badges for non-default schedules, and resets a selected non-`karras` schedule back to `karras`. |
| `maxEnhance` + `maxEnhanceMinArea` / `maxEnhanceMaxArea` | Controls whether Max Enhance is offered and validated for source image area. Unknown image model metadata keeps the UI permissive, but server generation rejects unsupported requests. |
| `datasetAliases` | Remaps dataset include values before generation, e.g. V5 maps `"furry dataset"` to `"fur dataset"`. |

Only explicit `false` disables chrome. Missing model caps should not hide a
surface by accident; this keeps older or unknown metadata usable until the model
is resolved.

## Client update flow

1. `get_app_options` loads first and fills `optionsData.modelFeatures`.
2. `selectManualModel()` updates the model dropdown and always calls
   `updateV3ModelVisibility()`, including init/restore paths that pass
   `preventPropagation`.
3. `updateV3ModelVisibility()` handles legacy V3 UI hiding, then applies
   capability gates for vibe, precise reference, Variety+, and noise scheduler
   chrome.
4. Dynamic chrome must re-run the same helper after it is created. Current call
   sites include pipeline stage creation/re-render, pipeline restore, and the
   Enhance dialog setup.
5. Sampler dropdown renderers check `getForgeModelFeatures()?.noiseScheduleUi`
   before adding noise scheduler entries so hidden choices cannot be selected
   through newly created menus.

If you add another model-dependent control, prefer adding a capability flag to
`config/model-features.json` and extending `updateV3ModelVisibility()` (or a
small helper it owns) rather than adding one-off model string checks.

## Modify / cached metadata restore

Generated metadata contains both compiled fields and the editor inputs in
`forge_data`. `applyForgeEditorInputToMetadata()` in
`public/scripts/comp/manualModalManager.js` intentionally restores:

- `forge_data.input_prompt` -> Studio prompt
- `forge_data.input_uc` -> Studio UC
- `forge_data.input_prompt_negative` when the top-level field is empty
- `forge_data.dataset_config` when the top-level dataset config is missing
- `forge_data.allCharacters` when character prompts are not already remapped

This keeps **Modify Image** and preview-cache loads editable from the user's
original Studio inputs instead of the flattened compiled prompt that was sent to
NovelAI.

## Common pitfalls

- **Noise scheduler still visible on V5:** check that the element has
  `data-noise-schedule-ui` or is one of the known groups
  (`#expansionNoiseSchedulerGroup`, `#enhanceNoiseSchedulerGroup`), and that
  `updateV3ModelVisibility()` runs after the element is inserted.
- **Pipeline stage shows stale Variety+ state:** newly rendered stage buttons
  need the shared visibility helper after insertion; do not copy the gating
  logic into the stage renderer.
- **Dropdown can select hidden noise schedules:** hide the chrome and omit the
  dropdown entries. Manual and pipeline dropdowns already follow this pattern.
- **Metadata restore shows compiled prompt:** run
  `applyForgeEditorInputToMetadata()` before loading metadata into the manual
  form, then apply emphasis conversion.
- **Server accepts unsupported UI state:** verify the request path uses
  `modules/modelFeatures.js` helpers. Client hiding is convenience; server-side
  enforcement remains required.

## Verification

Focused regression tests:

```bash
node scripts/test-studio-model-cap-chrome.js
node scripts/test-forge-editor-input-hydrate.js
```

The first test checks V5 vs V4.5 chrome gates for Variety+ and noise scheduler
UI. The second checks that Modify / preview-cache restore uses `forge_data`
editor inputs without mutating the cached generation metadata.
