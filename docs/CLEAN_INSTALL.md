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
must print `compiled=` greater than 0. That warms `.cache/runtime-assets` so the Melaton
installer is not waiting on first-request CSS/JS minification. `scripts/setup.sh` does the same
at the end of the baremetal path, the docker host path (when `node_modules` is already there),
the image-build path, and the container `--runtime` entry. The Dockerfile also runs it after
`COPY` so an image without a cache volume is warm. A bind-mounted `.cache` (see
`docker-compose.yml`) is empty on a fresh host; the container entry runs precompile again
before `web_server.js`.

Shipped assets a fresh clone must already contain (these used to live only on the host):

| Path | Role |
|------|------|
| `public/images/login_array.jpg` | Neutral 1024x1024 login tile. `/.login.jpg` serves `.cache/login_array.jpg` once the gallery rebuilds a sheet |
| `public/data/nai-quickstart-v5.json` | Quick Start catalog |
| `public/sounds/planet/innerlight.opus` | Planet switcher bed |
| `public/scripts/comp/blockContainer.js` | Login blocks. The preload URL is `/scripts/comp/blockContainer.js` |

The install manifest (`OPTIONS /`, `buildServiceWorkerCacheManifest`) lists static files the
service worker precaches.
Device splash and screenshot images under `public/static_images/` stay out: each client only
needs one size. Any row whose file is not on disk is omitted. The service worker gives each
install fetch 20s and treats HTTP 404 as absent: that file is not retried, and the installer
remembers it so the next boot does not open Setup for it again.

`/protected/` and `/private/` rows are marked `auth: true`. They stay in the manifest so the
list is complete, and the service worker does not precache or serve them. A logged-out request
still hits the server and gets 403. A request for a missing static file (for example
`/scripts/blockContainer.js`) is HTTP 404.

Vista sound WAVs live in `public/sounds/vista` (served at `/sounds/vista/<name>.wav`). The 15
allowlisted WAVs are committed, so a fresh clone has them; other WAVs copied there stay ignored.
The whitelisted files (`modules/desktopSoundsStatic.js` ALLOWED_FILES) that are on disk are in the
install manifest and the install pack. `/protected/fflate.js` is served from the vendored
`public/scripts/vendor/fflate.js` (fflate 0.8.3, MIT), not from node_modules.

### Runtime data outside the repo

Data the app writes at runtime is kept out of the git tree, so merges, checkouts and cleans
cannot overwrite it (`modules/runtimeDataPaths.js`):

| Data | Default | Override |
| --- | --- | --- |
| Data root | `~/dreamscape-data` | `DREAMSCAPE_DATA_DIR` env, or `"dataDir"` in config.json |
| Apocrypha issue + archive | `<data root>/apocrypha` (`current.json`, `archive/`) | `APOCRYPHA_DATA_DIR` env, or `"apocrypha": { "dataDir": ... }` |

A fresh install needs no seed: with no `current.json` the Apocrypha page renders empty until the
first publish. On boot, if the legacy `data/apocrypha` exists and the new dir does not, it is
copied once; the legacy copy is never deleted.

**Upgrading an existing tree:** `data/apocrypha/current.json` is no longer tracked, so pulling
this change deletes it from the working tree. Copy it first:
`mkdir -p ~/dreamscape-data && cp -a data/apocrypha ~/dreamscape-data/apocrypha` (skip if that
dir already exists), then pull.

Everything else written at runtime (`/data/*`, `/images/`, `.cache/` including the SQLite
databases, `logs/`, `tmp/`) is already gitignored.

### Wiki and tag seeds

These are referenced by tag import / lookup and are too large (or are the inputs to a database
that is too large) to commit. They are hosted at
<https://yozora.bluesteel.737.jp.net/seeds/dreamscape/>, and `scripts/fetch-seeds.sh` downloads
them from there. Override `SEED_BASE_URL` when the files live somewhere else:

```bash
bash scripts/fetch-seeds.sh
SEED_BASE_URL=https://example.invalid/dreamscape-seeds bash scripts/fetch-seeds.sh
```

The script first downloads
[`SHA256SUMS`](https://yozora.bluesteel.737.jp.net/seeds/dreamscape/SHA256SUMS) from the same
folder and checks every file against it. A mismatch stops the script and leaves the old file in
place. The hosted databases are refreshed from production, so the checksums are not repeated
here; `SHA256SUMS` is the source of truth.

| File | Saved to |
|------|----------|
| `tag_wiki.db` | `.cache/tag_wiki.db` |
| `tag_search.db` | `.cache/tag_search.db` |
| `nax_tags.db` | `.cache/nax_tags.db` |
| `danbooru_tagwiki.json` | `danbooru_tagwiki.json` |
| `e621_wiki_fixed.json` | `e621_wiki_fixed.json` |
| `danbooru_tag_groups_hierarchy.json` | `danbooru_tag_groups_hierarchy.json` |
| `nax_tags.json` | `nax_tags.json` |

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
