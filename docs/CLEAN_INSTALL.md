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

After dependencies, the installer runs `node scripts/precompile-runtime-assets.js`. A fresh tree
must print `compiled=` greater than 0. That warms `.cache/runtime-assets` so the MeletonFX
installer is not waiting on first-request CSS/JS minification. `scripts/setup.sh` does the same
at the end of the baremetal path, the docker host path (when `node_modules` is already there),
the image-build path, and the container `--runtime` entry. The Dockerfile also runs it after
`COPY` so an image without a cache volume is warm. A bind-mounted `.cache` (see
`docker-compose.yml`) is empty on a fresh host; the container entry runs precompile again
before `web_server.js`.

Shipped assets a fresh clone must already contain (these used to live only on the host):

| Path | Role |
|------|------|
| `media/cursors/vista/*.cur` and `*.ani` | Vista pointer scheme (`/cursors/vista/...`) |
| `public/images/login_array.jpg` | Neutral 1024x1024 login tile. `/.login.jpg` serves `.cache/login_array.jpg` once the gallery rebuilds a sheet |
| `public/data/nai-quickstart-v5.json` | Quick Start catalog |
| `public/sounds/planet/innerlight.opus` | Planet switcher bed |
| `public/scripts/comp/blockContainer.js` | Login blocks. The preload URL is `/scripts/comp/blockContainer.js` |

The install manifest (`OPTIONS /`, `buildServiceWorkerCacheManifest`) lists static files the
service worker precaches. That includes the committed Vista cursor pack (`/cursors/vista/...`,
from `media/cursors/vista`) and a Posy pack when those files are on disk in `media/cursors/posy`.
Device splash and screenshot images under `public/static_images/` stay out: each client only
needs one size. Any row whose file is not on disk is omitted. The service worker gives each
install fetch 20s and treats HTTP 404 as absent: that file is not retried, and the installer
remembers it so the next boot does not open Setup for it again.

`/protected/` and `/private/` rows are marked `auth: true`. They stay in the manifest so the
list is complete, and the service worker does not precache or serve them. A logged-out request
still hits the server and gets 403. A request for a missing static file (for example
`/scripts/blockContainer.js`) is HTTP 404.

Vista sound WAVs stay host-local in `media/Windows Vista Sounds` (Microsoft recordings, not in
git, not in the install manifest).

### Wiki and tag seeds

These are referenced by tag import / lookup and are too large (or are the inputs to a database
that is too large) to commit. `scripts/fetch-seeds.sh` downloads them. `SEED_BASE_URL`
defaults to the Yozora folder below (**PLACEHOLDER until Sala confirms**). Override it
with the environment variable when the files live somewhere else:

```bash
bash scripts/fetch-seeds.sh
# PLACEHOLDER until Sala confirms:
#   https://yozora.bluesteel.737.jp.net/seeds/dreamscape/
SEED_BASE_URL=https://example.invalid/dreamscape-seeds bash scripts/fetch-seeds.sh
```

Sizes and sha256 below are from the production host on 2026-10-14. Check them after download.

| File | Bytes | sha256 |
|------|------:|--------|
| `.cache/tag_wiki.db` | 849838080 | `9495dd4c5c70323d5ac516d4ab6513e68605e8ba649af5041f623739918817f0` |
| `.cache/tag_search.db` | 39579648 | `717c9fa583b136c5187cb8e0a4cb347c31dff11e2684ec46434d09a512fcb5e7` |
| `.cache/nax_tags.db` | 19353600 | `17511f6b15a3eac64b822df90e2b74654af830ba6d5f0ccbc710d700e0a47fb8` |
| `danbooru_tagwiki.json` | 143835679 | `094121c42a0555d7221403c3ca806851360a1c01358c4752e03cf3f4f45371d2` |
| `e621_wiki_fixed.json` | 55725469 | `d75f2598788c1a1031c14bdbc47c658f62f5d71f51a1442364ac2aa1a83e69e7` |
| `danbooru_tag_groups_hierarchy.json` | 3006656 | `71a35647bcb41d3aba9640f485abc341ffcc8c084af33ea5ff9b398e305276dc` |
| `nax_tags.json` | 8583492 | `14489b315bc1c6f28543de231c100f851111a136bca7c495f433448021781980` |

`scripts/import-nax-tags.js` builds `.cache/nax_tags.db` from `nax_tags.json`.
`scripts/create-tag-database.js` builds `.cache/tag_wiki.db` from the wiki JSON. Tag search
still works without these files; suggestions and wiki pages stay empty until the seeds exist.

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
