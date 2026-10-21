# Prompt list fold guard

Shared module: `public/scripts/comp/promptListFold.js` (client + `modules/imageGeneration.js`).

Do not land early-return stubs in `foldPromptList`, `mergeUc`, or `maskAgeReadText`, or restore pass-through age policy in director/NAX templates.

Before merge, confirm `promptListFold.js` still runs fold logic (no `Age-term rewriting removed` stub block).
