# Weight Rack (emphasis groups) — current status

**Scope:** client Normalize tool only.  
**Primary UI:** `public/scripts/comp/emphasisGroupsToolManager.js`  
**Math / distribution:** `public/scripts/comp/emphasisWeightMath.js`, `public/scripts/comp/emphasisSubgroup.js`  
**Invariants:** `.cursor/rules/emphasis-weight-rack-invariants.mdc`

## What remains

Weight Rack edits prompt emphasis groups (`N::…`) via normalize / delta / distribution modes. Forge persists `emphasis_normalization` (shares, range, scope, mode flags). Generation still stores/replays that metadata; it does **not** expand subgroups or run a segment index.

Related editor scripts (overlay, parse, editing) live next to the tool:

- `emphasisParse.js`, `emphasisHighlight.js`, `emphasisEditing.js`, `emphasisSelection.js`
- `emphasisSyntaxToggles.js`, `emphasisTokenModal.js`, `emphasisWeightMath.js`, `emphasisSubgroup.js`

## Removed (do not resurrect)

| Area | Former pieces |
|------|----------------|
| Client expand / chips / warnings | Subgroup UI in Weight Rack, `emphasisGroupsWarningsBtn` |
| Client WS segmentation | `segment_emphasis_groups`, highlight meta gradients from server ratios |
| Server segment store | `emphasisSegmentStore.js`, `emphasisWeightManagement.js`, `emphasisPenaltiesConfig.js` |
| Tray / admin packets | `emphasisSegmentTray.js`, `235-emphasisSegmentHandler.js`, warm/resync/rebuild/penalties WS |
| Legacy monolith | `public/scripts/comp/emphasisManager.js` |

## Generation order

1. Dynamic / locked text replacements → `processedPrompt`
2. `sanitizeAndNormalizeText` (`modules/emphasisPromptSyntax.js`)

## Open polish (optional)

- [ ] Scrub leftover forge keys `emphasis_weight_management` / `emphasis_weight_management_applied` from old images on load if desired
- [ ] Align any design notes that still linked here from historical checklists
