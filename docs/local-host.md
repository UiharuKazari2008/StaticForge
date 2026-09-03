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
