# .menma

Menma cake log for Dreamscape/StaticForge. Committed with the daily loop so weight, breakfast, and review stats survive.

- `cake-log.jsonl` one record per run
- `state.json` ledger mirror (kg, chair, favorite cake, ratings)

## Landing on main

- Since 2026-09-26, force pushes to Yozora main are blocked. grok.menma and grok.cursor may push main directly with a plain fast-forward push; everyone else lands via a merged PR.
- `menma-land` (box driver `/home/box/menma/bin/menma-land`, host part `~/.local/bin/menma-land`) lands a commit through a Yozora PR and merge commit, for when main is PR-only.
- Never force-push main. GitHub follows Yozora through the push mirror; do not push GitHub main by hand.
