# NovelAI web-app watch

Cheap daily monitoring of **public** NovelAI surfaces plus an optional headed Chrome dump when hashes change.

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

Headed Chrome + Xvfb + patched [ResourcesSaverExt](../../tools/ResourcesSaverExt/README.md).

Prerequisites:

```bash
# google-chrome-stable already on this box
sudo apt install xvfb            # if missing
pnpm add -D playwright           # once
```

Run:

```bash
chmod +x scripts/nai-webapp-watch/dump-novelai-webapp.sh
./scripts/nai-webapp-watch/dump-novelai-webapp.sh
```

Output: `tmp/nai-webapp-dumps/` (**gitignored** — same policy as `tmp/`).

Do **not** commit dumps, JWT captures, or recaptcha tokens from DevTools HARs.

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
  echo 'AGENT_LOOP_TICK_nai-webapp-watch {"prompt":"Run ./scripts/nai-webapp-watch/daily-tick.sh from /home/kanmi/staticforge. If exit 2, run dump-novelai-webapp.sh then diff API contracts per novelai-webapp-review skill. Never commit tmp/ or secrets."}'
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
| `dump-novelai-webapp.{js,sh}` | Headed Xvfb dump |
| `.cursor/nai-webapp-watch/state.json` | Committed hash baseline |
| `tools/ResourcesSaverExt/` | Vendored extension + automation patch |
