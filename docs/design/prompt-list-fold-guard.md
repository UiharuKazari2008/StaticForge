# Prompt list fold guard

Server-side prompt text correction lives in `public/scripts/comp/promptListFold.js` (`foldPromptList`, `mergeUc`, `maskAgeReadText`, `stripWeightedCanon`). The same module is required from `modules/imageGeneration.js` and the client bundle.

PR #604 disabled this path with early-return stubs. That revert is permanent policy: do not reintroduce pass-through stubs or `Age-term rewriting removed` comments.

Wren hard rule #1 in `modules/cursorDirector.js` and the danbooru NAX `promptTemplate` strings must stay aligned with this fold (young female/male in agent-authored text; server fold handles generate). Do not reintroduce PR #604 wording that tells agents to keep adult/mature phrasing verbatim.

Before merging changes to `promptListFold.js`, run:

```bash
npm run test:prompt-list-fold
```

The test scans the source for stub patterns and asserts fold, UC merge, and read masking still behave.
