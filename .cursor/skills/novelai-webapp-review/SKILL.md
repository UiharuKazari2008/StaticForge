---
name: novelai-webapp-review
description: >
  Monitor NovelAI public web-app assets with a cheap daily hash poll and headed Chrome dump
  when contracts change. Use for batch2-webapp-watch, /loop 1d ticks, comparing dumps to
  Dreamscape/NekoAI-JS contracts, and post-deploy API drift review. Never auth generate or
  commit JWT/recaptcha/tmp captures.
---

# NovelAI web-app review

Track official NovelAI **public** frontend/API contract drift without recaptcha, generate calls, or secrets in git.

## Scope

**In scope (public, unauthenticated):**

- `https://novelai.net/` chunk path list + HTML
- `https://novelai.net/updateReload.json`
- `https://novelai.net/tokenizer/compressed/qwen35_tokenizer.def?v=2&static=true` (ETag)
- [V5 journal announcement](https://journal.novelai.net/image-generation-novelai-diffusion-v5-is-here-c2df7c6b8d2d/)
- [Usage limits blog](https://blog.novelai.net/subscription-updates-usage-limits-2025-88a208d5d9c5)

**Out of scope:**

- `generate-image`, `generate-image-stream`, suggest-tags with Bearer tokens
- recaptcha, JWT, cookies, HAR auth headers
- Committing `tmp/`, zips, or Chrome profiles

## Daily operator flow

1. **Cheap poll** (always):

```bash
cd /home/kanmi/staticforge
./scripts/nai-webapp-watch/daily-tick.sh
```

Or JSON for agents:

```bash
node scripts/nai-webapp-watch/poll-hashes.js --json
```

2. **If exit code 2** (hashes changed) → **headed dump**:

```bash
./scripts/nai-webapp-watch/dump-novelai-webapp.sh
```

3. **Diff contracts** in the new zip under `tmp/nai-webapp-dumps/` (gitignored).

4. **Update baseline** after intentional upstream sync:

```bash
node scripts/nai-webapp-watch/poll-hashes.js --write
```

## `/loop 1d` (local Cursor)

Arm once (see [loop skill](file:///home/kanmi/.cursor/skills-cursor/loop/SKILL.md)):

```bash
while true; do
  sleep 86400
  echo 'AGENT_LOOP_TICK_nai-webapp-watch {"prompt":"In /home/kanmi/staticforge run ./scripts/nai-webapp-watch/daily-tick.sh. Exit 2 → dump-novelai-webapp.sh then contract diff per novelai-webapp-review skill. Never commit tmp/ secrets."}'
done
```

Run `daily-tick.sh` immediately after arming. Stop by killing the loop shell.

Cloud agents: use subscription timer `loop-nai-webapp-watch`, `delaySeconds: 86400`, same prompt.

## Contract diff checklist (API only)

Search the dump JS bundles — do **not** copy NovelAI UI into Dreamscape.

| Signal | Where to look | Dreamscape touchpoints |
|--------|---------------|------------------------|
| Model slugs | `nai-diffusion-5-*` strings | NekoAI-JS, `model-features.json`, manual model maps |
| `params_version` | generate payload assembly | NekoAI-JS metadata defaults |
| `PE(model)` caps | `hasFurryMode`, `transparency`, `maxEnhance`, vibe flags | `model-features.json`, UI gates |
| UC / quality map | `Nb()` numeric presets | promptConfig quality/UC tables |
| Dataset prefixes | `fur dataset`, `background dataset`, absence of `anime dataset` on V5 | `imageGeneration.js`, promptConfig gates |
| Tokenizer | `qwen35_tokenizer.def?v=` | V5 tokenizer loader (fflate `.def`) |
| Tag suggest | `animev5` / `furryv5` query types | suggest-tags client |
| Usage battery | `usage.percent`, `timeUntilNextPercent` | credits tray / usage tool window |
| Max Enhance | `upscaled_enhance` | enhance pipeline |

Reference captures (local only, **do not commit**): `tmp/v5Gen.txt`, `tmp/v5Search.txt`, `tmp/novelai.net (1).zip`.

## ResourcesSaverExt dump method

- Vendored: `tools/ResourcesSaverExt/unpacked2x/`
- Patch docs: `tools/ResourcesSaverExt/README.md`
- Headed Chrome + `xvfb-run` — not `--headless` (DevTools extensions need headed)
- Automation message: `RESOURCES_SAVER_AUTOMATION_SAVE`

## Agent rules

1. Run `poll-hashes.js` before expensive dump work.
2. Never paste JWT/recaptcha from user captures into repo files.
3. Exclude `tmp/` from commits; dumps stay local.
4. Match **API contracts** only — Dreamscape UI stays ours.
5. After contract changes land in StaticForge/NekoAI-JS, refresh `state.json` with `--write`.

## Related docs

- Operator README: `scripts/nai-webapp-watch/README.md`
- Baseline: `.cursor/nai-webapp-watch/state.json`
- NovelAI docs import (separate batch): `scripts/README-novelai-docs.md`
