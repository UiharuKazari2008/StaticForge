# Clean install (Linux) and the clean-install CI test

## Install

On Debian/Ubuntu (tested on a fresh **ubuntu:24.04**), from a clone of the repo:

```bash
git clone https://yozora.bluesteel.737.jp.net/DreamScape/StaticForge.git dreamscape
cd dreamscape
sudo bash scripts/install-linux.sh                 # deps, Node 20, pnpm, node_modules, config
sudo bash scripts/install-linux.sh --with-service  # + pm2 (ecosystem.config.js) and pm2 startup on systemd hosts
node web_server.js                                  # or let pm2 run it
```

The script is non-interactive and idempotent: re-running skips apt/Node/pnpm when present and
never overwrites `config.json` / `secure.config.json` (it only adds a missing `sessionSecret`).
A new `config.json` gets a random `loginKey` and PINs — change them, then add a NovelAI key in
`secure.config.json` (`novelai.keys[].apiKey`).

What it installs that the README never mentioned:

| Need | Why |
|------|-----|
| Node.js **20+** (NodeSource) | README assumed node exists; the pnpm installer does not provide it |
| pnpm **10.33.0** via corepack | pinned by `packageManager`; `get.pnpm.io` now installs pnpm 12 |
| `build-essential python3 python-is-python3 pkg-config` | node-gyp builds (sqlite3 4.x has no prebuilt for node 20, spellchecker) |
| `libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev` | `canvas` |
| `libhunspell-dev` | `spellchecker` (fails to build without it) |
| `libsqlite3-dev` | sqlite native builds |
| `ruby` | DText parser (`modules/globalResources.js`, polymodules) |
| `git zstd` | update engine / replication bundles (`tar` + `zstd`) |
| `nekoai-js` from npm | `package.json` points at `file:../NekoAI-JS`; `scripts/configure-nekoai.js` switches it |
| `secure.config.json.sessionSecret` | `web_server.js` throws at boot without it |

Optional, not installed (only needed for the `grimoire-browser` pm2 app): `chromium` and the npm
package `puppeteer-core`, which is not declared in `package.json`.

## CI test

- `scripts/ci/clean-install-test.sh` — runs the installer, boots `web_server.js`, smoke-checks
  `GET /` and `GET /app`, then re-runs the installer to prove idempotency. No secrets.
  It refuses to run on the production host.
- `.gitea/workflows/clean-install.yml` — nightly (07:37 UTC) and `workflow_dispatch`, on a runner
  labelled **`clean-install`** inside `ubuntu:24.04`. No systemd, so `--with-service` is not
  covered there.

**Never run either on the production server.** The prod runner (`seq-dreamscape`) must not carry
the `clean-install` label.

Local run on any box with podman/docker:

```bash
podman run --rm -v "$PWD":/src:ro ubuntu:24.04 \
  bash -c 'cp -a /src /app && rm -rf /app/.git && cd /app && bash scripts/ci/clean-install-test.sh'
```

### Fallback runner: snapshot VM

Approved fallback: a Sala-provided VM restored to its base-install snapshot before every run,
registered with the `clean-install` label. It also lets us test `--with-service` with real systemd
(`pm2 startup`). Restore → run job → discard; never reuse a dirty VM.
