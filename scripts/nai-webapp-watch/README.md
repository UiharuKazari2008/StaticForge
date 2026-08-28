# NovelAI web-app watch

Cheap daily monitoring of **public** NovelAI surfaces plus an optional Chrome dump when hashes change.

## What this watches (no auth)

| Source | Signal |
|--------|--------|
| `https://novelai.net/` | Sorted `/_next/static/chunks/*.js` path list (`chunkPathsSha256`) + count |
| `https://novelai.net/updateReload.json` | Body sha256 |
| `https://novelai.net/tokenizer/compressed/qwen35_tokenizer.def?v=2&static=true` | ETag (body not hashed — large) |
| V5 journal announcement | Body sha256 |
| Usage limits blog post | Status code only when Cloudflare returns 403 without stable ETag |

**Never polled:** generate APIs, JWT, recaptcha, authenticated cookies.

Committed baseline: [`.cursor/nai-webapp-watch/state.json`](../../.cursor/nai-webapp-watch/state.json)

## Cheap hash poll

```bash
node scripts/nai-webapp-watch/poll-hashes.js
node scripts/nai-webapp-watch/poll-hashes.js --json
node scripts/nai-webapp-watch/poll-hashes.js --write   # refresh committed baseline
```

Exit `0` = unchanged vs baseline. Exit `2` = something changed.

## Full dump (only when poll reports change)

[ResourcesSaverExt](https://github.com/up209d/ResourcesSaverExt) (`unpacked2x`) with StaticForge automation overlay, driven over **CDP** — no Playwright, no bundled Chromium.

**Prefer Chrome for Testing**, not branded `google-chrome-stable`. Branded 151.0.7922.169 **ignores `--load-extension`** (dry-check `background_page` is Hangouts; dump times out). Chrome for Testing **152.0.7977.64** honors `--load-extension` and loads ResourcesSaverExt (`oamocmhnmfbafhblidnbibinconkgked` on the Frost dump host).

`DUMP_HEADLESS=1` + `--headless=new` **works** when Chrome honors `--load-extension` (CFT). Classic `--headless` still cannot load extensions. xvfb headed (`dump-novelai-webapp.sh` with no `DUMP_HEADLESS`) is the fallback if CFT is missing. Containers need `DUMP_CHROME_NO_SANDBOX=1`.

### One-time dump-host setup

```bash
# From StaticForge repo root (any checkout path)
sudo apt install xvfb unzip curl      # xvfb = headed fallback; unzip/curl = CFT download
./scripts/nai-webapp-watch/setup-dump-deps.sh --chrome-for-testing
# clones pinned ResourcesSaverExt into gitignored tools/ResourcesSaverExt/
# applies scripts/nai-webapp-watch/extension-automation/ overlay
# downloads CFT (pinned major 152) into gitignored .cache/chrome-for-testing/
# prints CHROME_BIN=...
```

Optional: `export CHROME_BIN=/path/from/helper` (dump auto-prefers `.cache/chrome-for-testing` over branded Chrome). Override extension path with `RESOURCES_SAVER_EXT_PATH=/abs/path/to/unpacked2x`.

CFT pin: `DUMP_CFT_MAJOR=152` (default), or `DUMP_CFT_VERSION=152.0.7977.64`. Cache dir: `DUMP_CFT_DIR`. Do not commit the browser binary.

Dry-check (launches Chrome + extension + CDP, no navigation; fails if Hangouts loaded instead of ResourcesSaverExt):

```bash
DUMP_HEADLESS=1 DUMP_CHROME_NO_SANDBOX=1 ./scripts/nai-webapp-watch/dump-novelai-webapp.sh --dry-check
```

### Run dump (headless CFT)

```bash
DUMP_HEADLESS=1 DUMP_CHROME_NO_SANDBOX=1 ./scripts/nai-webapp-watch/dump-novelai-webapp.sh
# optional: CHROME_BIN=/path/to/chrome-for-testing/chrome
```

### Fallback: xvfb headed

If CFT is missing, omit `DUMP_HEADLESS` and use system Chrome under Xvfb:

```bash
./scripts/nai-webapp-watch/dump-novelai-webapp.sh
```

Branded Chrome 151 will still ignore `--load-extension` even under xvfb. Use CFT.

## Daily `/loop 1d` (local Cursor)

Use the [loop skill](../../../.cursor/skills/novelai-webapp-review/SKILL.md) or run the wrapper directly:

```bash
./scripts/nai-webapp-watch/daily-tick.sh
```

### Arm a local monitored loop

Per [loop skill](https://cursor.com/docs/agent/loop) — fixed 1-day interval:

```bash
while true; do
  sleep 86400
  echo 'AGENT_LOOP_TICK_nai-webapp-watch {"prompt":"Run ./scripts/nai-webapp-watch/daily-tick.sh from the StaticForge repo root. If exit 2, run dump-novelai-webapp.sh then diff API contracts per novelai-webapp-review skill. Never commit tmp/ or secrets."}'
done
```

Run `./scripts/nai-webapp-watch/daily-tick.sh` once immediately after arming.

Stop: kill the background shell loop PID.

### Cloud agent alternative

If running as a Cloud Agent with subscription timers, subscribe `loop-nai-webapp-watch` with `delaySeconds: 86400` and the same prompt. Unsubscribe to stop.

## After a dump — contract diff checklist

See [`.cursor/skills/novelai-webapp-review/SKILL.md`](../../.cursor/skills/novelai-webapp-review/SKILL.md).

Focus on API contracts only (`PE(` caps, model slugs, `params_version`, UC/`Nb()` map, tokenizer `?v=`, `fur dataset` / `background dataset`, Max Enhance, usage math). Do not port NovelAI UI.

## Files

| Path | Role |
|------|------|
| `poll-hashes.js` | Cheap public-endpoint poll |
| `daily-tick.sh` | Operator + `/loop` entry |
| `dump-novelai-webapp.{js,sh}` | CDP dump (CFT headless preferred; xvfb headed fallback; no Playwright) |
| `.cursor/nai-webapp-watch/state.json` | Committed hash baseline |
| `setup-dump-deps.sh` | Fetch extension into `tools/` + optional `--chrome-for-testing` |
| `install-chrome-for-testing.sh` | Download CFT into `.cache/chrome-for-testing/` and print `CHROME_BIN` |
| `extension-automation/` | Checked-in overlay (postMessage bridge) |
| `tools/ResourcesSaverExt/` | Local (gitignored) extension tree after setup |
| `.cache/chrome-for-testing/` | Local (gitignored) Chrome for Testing binary |
