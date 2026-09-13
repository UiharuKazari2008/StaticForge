# Local host: pack, sync, and Docker

Run Dreamscape on a workstation (or second Linux box) without cutting the live PM2 host over to containers. This host stays bare metal / PM2; Docker is optional on any checkout.

## Pack (one-shot / sneakernet)

Offline USB or a single archive drop:

```bash
# On the source (stop the server first — SQLite consistency)
pnpm pack-server -- --full -o ./dreamscape-transfer
# or: bash scripts/pack-server-transfer.sh --full -o ./dreamscape-transfer

# On the destination
pnpm unpack-server -- -i ./dreamscape-transfer.tar.zst -d /path/to/dreamscape --force --verify
```

`--data-only` (default) packs images, cache, logs, configs. `--full` also packs application source under `dreamscape-transfer/app/`. See `scripts/pack-server-transfer.sh`.

## Sync (ongoing push / pull)

Directional rsync over SSH. **Not** bidirectional auto-merge. Newer file wins (`rsync --update`). Same payload as pack `--full` (source + configs + images + `.cache` + logs + `securePrompts`).

```bash
cp scripts/dreamscape-sync.env.example dreamscape-sync.env
# edit: DREAMSCAPE_REMOTE=user@host:/abs/path/to/staticforge

# From the workstation, pull the server tree down
pnpm sync:pull
# or: bash scripts/dreamscape-sync.sh pull

# Upsert local changes back to the server
pnpm sync:push

bash scripts/dreamscape-sync.sh pull --dry-run
bash scripts/dreamscape-sync.sh push --force   # override running-server check
bash scripts/dreamscape-sync.sh pull --delete  # also remove dest files missing on source
```

Env resolution order: `DREAMSCAPE_REMOTE` in the environment, then `./dreamscape-sync.env`, then `~/.config/dreamscape/sync.env`.

Always excluded: `node_modules`, `.git`, transfer archives, `.agent-*`, `graphify-out`, `.cache/chrome-for-testing`, `dreamscape-sync.env`.

**SQLite safety:** the script refuses if `web_server.js` is running on this host or (via SSH) on the remote, unless `--force`. Stop PM2 / the container before a real sync when you care about DB consistency.

Requires Linux, WSL, or macOS with `rsync` and `ssh`. Not Windows-native.

This is **filesystem** sync. In-app replication cargo (`POST /replication/cargo/upsert`) is a different system (two live instances).

## Docker (optional run path)

[`docker-compose.yml`](../docker-compose.yml) bind-mounts host data and configs so rsync/pack still see them. App code is baked into the image (`COPY` in the Dockerfile).

```bash
# First time on a box: create missing config files on the host, install Docker, start
sudo bash scripts/setup.sh --mode docker
# or install only: sudo bash scripts/setup.sh --mode docker --no-run
# then: docker compose up --build

docker compose ps
docker compose logs -f
docker compose down
```

After a sync that changes source: `docker compose up --build`. Data dirs stay on the host.

[`docker-compose.test.yml`](../docker-compose.test.yml) remains for scratch/CI (named volumes, no host secrets):

```bash
pnpm docker:test
# or: docker compose -f docker-compose.test.yml up --build
```

Container entrypoint runs `scripts/setup.sh --runtime` (dirs + missing configs only), then `node web_server.js`.

### Do not cut over the live PM2 host

Do **not** treat `docker compose up` on the production Dreamscape host as a migration away from PM2. Compose is for workstations (and optional side boxes). This server stays on `ecosystem.config.js` / PM2 until a separate cutover ticket.

## Quick map

| Goal | Command |
|------|---------|
| USB / offline clone | `pnpm pack-server -- --full` → unpack on dest |
| Daily pull from server | `pnpm sync:pull` |
| Upsert workstation edits | `pnpm sync:push` |
| Run in Docker locally | `sudo bash scripts/setup.sh --mode docker` |
| Bare metal locally | `sudo bash scripts/setup.sh --mode baremetal` then `node web_server.js` |
| Host CI deploy (labels) | See [CI deploy](#ci-deploy-github--yozora) |

## CI deploy (GitHub + Yozora)

Self-hosted runners on the Dreamscape host merge a landed PR into the live tree, mirror the SHA to the other forge, then apply **opt-in** labels.

### Remotes

Live checkout remotes:

- `Public` → `https://github.com/UiharuKazari2008/StaticForge.git`
- `origin` → Yozora `UiharuKazari2008/StaticForge`

| Trigger | Pull into live `main` | Then push |
|---------|----------------------|-----------|
| GitHub PR merged to `main` | `Public/main` | `origin` (`main`) |
| Yozora PR merged to `main` | `origin/main` | `Public` (`main`) |

Workflows listen to `pull_request` closed+merged and `workflow_dispatch` only — **not** `push`, so mirroring does not recurse.

### Labels and Reason

Add labels on the PR (create on both forges if missing):

| Label | Effect |
|-------|--------|
| `deploy:restart-server` | PM2 restart Dreamscape. Merge alone never restarts. |
| `deploy:push-clients` | Recompile runtime assets + SW `service_worker_cache_update` |
| `deploy:restart-clients` | Loopback `POST /agent/broadcast` with `restart: true` |

**Reason** (client toast / restart dialog text): first PR-body line matching `Reason:`, `Toast:`, or `Deploy reason:`. Fallback: PR title. Plain text only (no `<` / `>`).

PR templates: [`.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md), [`.gitea/PULL_REQUEST_TEMPLATE.md`](../.gitea/PULL_REQUEST_TEMPLATE.md).

### Host script

```bash
# Dry-run (prints remotes/SHAs/flags; hands off on dirty/lock/ahead without merging)
TRIGGER_REMOTE=Public bash scripts/host-deploy.sh --dry-run

# Live (CI does this after a merged PR)
TRIGGER_REMOTE=Public \
  DEPLOY_LABELS='["deploy:restart-server","deploy:push-clients"]' \
  DEPLOY_PR_BODY='Reason: Ship SW cache fix' \
  bash scripts/host-deploy.sh
```

Always runs against `STATICFORGE_LIVE_ROOT` (default `/home/kanmi/staticforge`). Does **not** use Actions `checkout` into the live tree.

Broadcast auth: copy [`scripts/ci/staticforge-deploy.env.example`](../scripts/ci/staticforge-deploy.env.example) to `~/.secrets/staticforge-deploy.env` and set `STATICFORGE_APP_KEY` or `DEPLOY_DEV_LOGIN_KEY`.

Flag parser self-test:

```bash
node scripts/ci/parse-deploy-flags.js --self-test
```

### Blocked deploy → Cursor worker

If the job cannot proceed, it does **not** merge, restart, or push. It comments on the PR, files a Yozora issue (`type:infra`, `cursor-agent`, `status:ready`), and starts `agent persist` using `~/.secrets/cursor-agent.env`.

| Kind | Cause |
|------|--------|
| `dirty_tree` | Live `git status` not clean |
| `agent_lock` | A `.agent-*` other than `.agent-host-deploy` exists |
| `remote_ahead` / `local_ahead` / `merge_failed` | Remotes or live HEAD cannot cleanly take the trigger SHA |

Rules for the worker: no stash, no force-push to `main`, do not delete another agent's lock. After the tree is clear, re-run `scripts/host-deploy.sh` or leave a Done comment.

`flock` on `/tmp/staticforge-host-deploy.lock` serializes overlapping jobs.

### Install runners (one-time)

Tokens stay in `~/.secrets/` — never commit them.

```bash
# GitHub: paste registration token into ~/.secrets/github-runner.token
bash scripts/ci/install-github-runner.sh
# → ~/ci-runners/github + systemd --user github-actions-runner.service
# labels: linux,dreamscape

# Yozora: enable Actions on the repo, paste token into ~/.secrets/yozora-runner.token
bash scripts/ci/install-gitea-runner.sh
# → ~/ci-runners/gitea + systemd --user gitea-act-runner.service
```

Workflows: [`.github/workflows/host-deploy.yml`](../.github/workflows/host-deploy.yml), [`.gitea/workflows/host-deploy.yml`](../.gitea/workflows/host-deploy.yml) (`runs-on: [self-hosted, linux, dreamscape]`).

Do **not** register runners or merge a live deploy until registration tokens are minted and a dry-run SHA is confirmed.
