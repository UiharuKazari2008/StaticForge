# Rack Manager: replicas role

Dreamscape replica servers on Fat Misaka, so an agent develops against its own server instead of restarting the live one
(Yukimi, Nov 27 2026). Several run at once. A replica is a container of the repo's own `Dockerfile` image, so the container build,
`scripts/setup.sh`, `scripts/install-linux.sh` and `docs/CLEAN_INSTALL.md` stay true because they are used every day.
Contract and API: the `replicas` section of `docs/rack-manager/README.md`. Code: `rackd/roles/replicas.js` (+ `roles/replicas/nginx.conf.tmpl`),
`modules/replicaMode.js`, `scripts/rack/seed-replica.sh`, `scripts/rack/push-proof-ref.sh`.

## Host layout

`/srv/rack/replicas` = LV `rackreplicas` (500 GB, **xfs reflink=1**, VG `vmdata`; the role creates it when missing).

| path | what |
|---|---|
| `mirror.git` | bare mirror of StaticForge (heads and tags; `refs/proof/*` survives the prune: work-in-progress trees for test builds) |
| `seeds/<id>/` | data snapshots of the live server; `.seed.json` meta; `.secret/novelai.json` only when taken with `--keys` |
| `<name>/replica.json` | the replica's record |
| `<name>/data/` | its own data dir, `cp -a --reflink=always` of a seed (copy-on-write: a replica costs only what it changes) |
| `<name>/src/` | worktree mode: `git clone --shared` of the mirror, branch `replica/<name>`, owned by `rack` (the agent edits here over `rack_exec`) |
| `/etc/rackd/ca/` | rack CA (`ca.key` mode 600, `ca.crt`), `certs/<name>.{key,crt}`, optional `client-ca.crt` (Dreamscape's client CA, public part only) |
| `/etc/nginx/rack-replicas.d/<name>.conf` | the replica's HTTPS vhost |

Container `dsrep-<name>`: image `dreamscape:<sha12>` (labels `ds.ref`, `ds.commit`, `ds.builtAt`), `DREAMSCAPE_REPLICA=1`,
`DREAMSCAPE_REPLICA_ALLOW=<list>`, `--memory 8g --cpus 8` by default, `--restart unless-stopped`, port `9301..9399` -> 9220. Data dirs
(`.cache images logs .previews securePrompts data dsdata`) and the config files (`config.json secure.config.json prompt.config.json
director.config.json characters.json nax_generation_config.json`) are bind-mounted from `<name>/data`. Worktree mode mounts `src` over `/app`
and a named volume `dsrep-nm-<name>` (filled from the image) over `/app/node_modules`: a lockfile change needs the replica created again
(`pull` says so).

Configs: `secure.config.json` is **new** (random `loginKey`, `devLoginKey`, PINs, `sessionSecret`, path UUIDs); the live login secrets never
leave Dreamscape. NovelAI keys only with `keys:'copy'` (needs a seed taken with `--keys`). `config.json` comes from the seed with `approvedIps` emptied (the live LAN auto-login ranges), `mailGateway`/`xi` disabled, `port` 9220 and `public_hostname` `<name>.<rackDomain>`.
`action login {name}` returns the replica's own sign-in secrets to the agent that owns it.

## Seeds: filesystem snapshot, not the replication system

Decision: a seed is a filesystem snapshot (`scripts/rack/seed-replica.sh`), not a replication import. Why:
- Replication (`modules/replicationSync.js`, `replicationChangelog.js`, Computer Management > Replication) is a master/child changelog
  merge with tokens, a peer port and write-back to the primary. A replica must be unable to write into the primary; connecting one as a child
  is the opposite of that. Its live conversation also needs the primary running and shares mail/phone/credential state by design.
- A snapshot is one rsync (28 s, below), consistent for SQLite (`sqlite3 .backup`), and `cp --reflink` makes N replicas out of it for free;
  replication would transfer and apply per replica.
- Replication stays available inside a replica if wanted (`allow:['replication']`), pointed at another replica, never the primary.

Taken by `bash scripts/rack/seed-replica.sh [--id ID] [--images N] [--keys]` on Dreamscape (read-only on the live tree; staging in
`/var/tmp`, rsync over `ssh fat-misaka`, atomic rename on the host). Contents: `.cache/` `tag_search.db nax_tags.db tag_wiki.db characters.db
generation_quips.db emphasis_segment_index.db` (via `.backup`), `workspace.json workspace-desktop.json favorites.json customWords.json`;
`config.json prompt.config.json director.config.json characters.json nax_generation_config.json`; the newest N pictures (default 25).
Left out: `secure.config.json`, `.cache/secrets`, `application_auth.db`, account tokens, Claude account dirs, `activesync.db` (phones),
`dovecote.db mailaccounts.db textmessaging.db chat.db knowledge_memory.db` (private), `director.db telemetry.db`, `metadata.db` and
`reference_metadata.db` (follow the gallery; rebuilt), `upload traces checkpoints userFiles nax_images wiki_files` and the rest of `images/`.
Seeds stay on the host, never in git. `seed-take` of the role answers `{needsDreamscape:true, dest}` because rackd cannot reach Dreamscape;
modules/rackManager runs the script (hook below).

## Replica mode: the gates

`modules/replicaMode.js`: `isReplica()` (env `DREAMSCAPE_REPLICA=1`), `allow(feature)` / `off(feature)` (env `DREAMSCAPE_REPLICA_ALLOW=a,b`).
Unset: nothing changes (always allowed). Each gate is one line:

| what | gate (file:line) | feature to allow |
|---|---|---|
| Supervisor, Fleet dispatch, usage audit, maintenance, Claude account runtimes, carry tmux server (Yozora writes ride on the Supervisor) | `modules/ws/handlers/314-claudeDeskHandler.js:1200` | `supervisor` |
| Claude account hosts / remote fleet | `modules/ws/handlers/313-claudeAccountsHandler.js:187` | `supervisor` |
| Fleet contractors | `modules/ws/handlers/317-fleetContractorsHandler.js:118` | `supervisor` |
| agent-coord reload socket (`server_reload_module`) | `modules/bootstrap/initSteps.js:358` | `agentcoord` |
| Director computer, Xi, Director CLI self-updates | `web_server.js:5245`, `:5268`, `:5338` | `director` |
| host `~/.config/cursor` sync | `web_server.js:4992` | (never) |
| Claude usage probe | `web_server.js:5237` | `claude` |
| Phone delivery: Android app update push (ActiveSync pushes, APK staging, notices) | `web_server.js:2528` | (never) |
| Android builds routes | `web_server.js:2534` | `androidbuilds` |
| Rack Manager / iLO (routes, supervisor child, socket upgrade) | `web_server.js:2536`, `:5043` | (never) |
| Mail accounts (IMAP sync / send) | `modules/ws/handlers/305-mailAccountsHandler.js:26` | `mail` |
| Mail gateway | `modules/bootstrap/initSteps.js:127` | `mail` |
| BlueBubbles / RCS / phone messaging | `modules/ws/handlers/304-textMessagingHandler.js:45`, `:47` | `messaging` |
| Reminders and weather-daily notices to phones | `modules/ws/handlers/294-notificationInboxHandler.js:61`, `:67` | `notifications` |
| Weather alert monitor, car API scheduler (Lapis / Bluelink) | `modules/ws/handlers/291-weatherHandler.js:231`, `293-lapisHandler.js:79` | `weather`, `lapis` |
| SiriusXM recorder | `modules/ws/handlers/318-xmRadioHandler.js:147` | `xmradio` |
| NovelAI key health checks | `modules/bootstrap/initSteps.js:58` | `novelai` |
| Scheduled paid jobs (generation quips auto-update) | `modules/globalResources.js:1220` | `novelai` |
| RunPod watcher | `modules/bootstrap/initSteps.js:295` | `runpod` |
| Docubase git sync | `modules/bootstrap/initSteps.js:304` | `docubase` |
| Replication: the config reads as standalone, the peer port (9221) is not opened | `modules/replicationService.js:74`, `modules/replicationPeerServer.js:271` | `replication` |

Not gated (nothing runs on its own): Plaud (account link and fetch only on request, no timer), `deviceAdb` (on request; the image has no `adb` and
no phone is configured on a replica), Yozora writes outside the Supervisor (`fleetYozora` is only reached through it). Found by running a replica:
the Fleet memory mirror writes a local `~/fleet-memory` (inside the container only); with `HOME` redirected a run of the server with
`DREAMSCAPE_REPLICA=1` opened no outbound connection (`ss -tnp`) and no listener but its HTTP port and an internal helper.
`node scripts/test-replica-mode.js` covers the helper.

## HTTPS front (nginx), as production

How production is fronted (read from the repo; the production proxy config itself is not readable from here): nginx on Kuroko
(192.168.200.121) terminates TLS for `737.jp.net` and passes plain HTTP to Node on 9220 (`docs/client-certificates.md`: no mutual TLS at
the proxy, no certificate header is trusted); the server reads `X-Forwarded-For` (rightmost untrusted hop, `modules/clientAddress.js`, Kuroko is the only
trusted proxy), `X-Forwarded-Proto` (session cookie `secure` check, `proxy: true` in web_server.js; without it a PIN login leaves no cookie),
`X-Forwarded-Host` / `Host` (site gate cover page, `modules/siteGate.js`), WebSocket upgrades on `/ws`; Express accepts bodies up to 100 MB;
the proxy cuts any socket after about 60 s idle with nothing sent (Fleet memory #185), so the server's keep-alives (WebSocket ping,
SSE with `X-Accel-Buffering: no`) are what hold connections.

Per replica `roles/replicas/nginx.conf.tmpl` is rendered to `/etc/nginx/rack-replicas.d/<name>.conf`: `server_name <name>.<rackDomain>` on 443
and the same vhost on `<host ip>:<port+100>` (9401..9499, works without DNS); server certificate from the rack CA (SAN: the name and the host IP);
WebSocket upgrade map; `X-Forwarded-*`/`X-Real-IP`; `client_max_body_size 1g`; `proxy_read_timeout 60s`, `proxy_send_timeout 60s`;
a client certificate may be offered when `/etc/rackd/ca/client-ca.crt` exists (`optional_no_ca`) but is never passed on, as in production.
`rackDomain`: `/etc/rackd/replicas.json` `{ "rackDomain": "rack.lan" }` (default `rack.lan`; env `RACKD_REPLICA_DOMAIN`). Every create/delete runs
`nginx -t` and reloads only when it passes; a rejected vhost is removed again. The public CA certificate: files kind `ca`, name `ca.crt`
(`GET /v1/files/ca/ca.crt`, rackManager `/rack/misaka/files/ca/ca.crt`): import it into test browsers and emulators.
The replica sees the Docker gateway as its peer, not nginx's address, so `X-Forwarded-For` from nginx is not trusted by `clientAddress.js`
(fail closed: a replica never treats a client as local).

Install: the role's packages are `git rsync xfsprogs nginx openssl`; install disables the packaged default site (no port 80 listener).

## Container build audit

Stale before: base `node:20-bookworm` (live: Node 24.22 on Debian 13 trixie); `libhunspell-dev` (no spellchecker module exists any more);
missing runtime tools the server spawns (`ffmpeg`/`ffprobe`, `tmux`, `sqlite3`); `--frozen-lockfile` in the Dockerfile (the lockfile pins
`nekoai-js` to `file:../NekoAI-JS`, `configure-nekoai.js` switches it to the registry, so a frozen install can never pass); `setup.sh` and
`install-linux.sh` installed Node 20; `data/` and `dsdata` (the runtime data root) were not created or mounted; `.dockerignore` let a
checkout's `data/`, `backups/`, `core.*` and `docs/testing/evidence` into the build context. Updated: `Dockerfile`, `.dockerignore`,
`docker-compose.yml`, `scripts/setup.sh`, `scripts/install-linux.sh`, `docs/CLEAN_INSTALL.md`. Native modules built from source
(`pnpm.onlyBuiltDependencies`): better-sqlite3, sqlite3, canvas, sharp (against system libvips 8.16 with JPEG XL, #1134), node-pty, geo2city
(db rebuild). Ruby DText is pure Ruby (`polymodules/dtext_rb/lib`). No Python is needed by the server (the upscalers run on Ruiko).

Alignment with the build-environment plan (#1139, `docs/build-environment-plan.md`): replicas are the plan's "own worktree, own Test-Server on
its own port" made real; `worktree` mode is its per-agent checkout (`replica/<name>` branch, shared object store), and `image` mode with the
commit SHA in the image labels is its "one build from one SHA" (`ds.commit`). The replica's data is the plan's "data/images/config stay only
in the live tree", copied instead of shared.

## Verified build

Nov 27 2026, Fat Misaka (80 Westmere threads, no AVX), from the repo state of that day (`refs/proof/replicas` = `origin/main` + the working tree, pushed
with `scripts/rack/push-proof-ref.sh`; once these files are committed `image-build {ref:'main'}` builds the same):

| step | result |
|---|---|
| `docker build` (role `image-build`) | `dreamscape:800c430b5abe`, 3.75 GB, 12 min: apt 36 s, `setup.sh` pnpm install with the 5 native builds 43 s, runtime asset precompile **533 s** (1035 files compiled on this CPU; the same step takes 10 s warm on Dreamscape), export 19 s |
| build log tail | `[precompile-runtime-assets] compiled=1035 skipped=0 errors=0` / `naming to docker.io/library/dreamscape:800c430b5abe done` / `image dreamscape:800c430b5abe at 800c430b…` |
| the bind-mounted `.cache` hides the baked assets, so the first replica compiled them again for 10 minutes | the role now keeps the image's `runtime-assets` once (`_rt/<sha12>`) and reflinks them into each replica: create to HTTP 200 in 12 s (7 s boot) |
| seed `seed-proof` | 937 MB (981,540,241 B) in 28 s from Dreamscape, 25 pictures; replica data dir `cp --reflink`: LV usage 12 GB with image, seed, mirror and one replica |
| two replicas | `replica-wt` (worktree, `https://192.168.100.42:9402/`) and `replica-demo` (image, `https://replica-demo.rack.lan/` / `https://192.168.100.42:9401/`); stop -> nginx answers 502 -> delete removed container, volume, vhost, certificate and the record |
| HTTPS | `curl -k` and Playwright (`ignoreHTTPSErrors`) get the "Dreamscape - Login" page; verified against the rack CA (`ssl_verify=0`); sign-in with the replica's own login key reaches `/launch` ("Melaton is loading files"); a wrong key is 403 |
| gates | the container opens no outbound connection (`nsenter -n ss`), listens on 9220 only (no peer port 9221), the log has no Supervisor / Director / Fleet / Rack Manager lines, the seed has no phones, mail or secrets |
| WebSocket through nginx (`proxy_read_timeout 60s`) | stayed open for 135 s with 5 application messages, **only because the server's own protocol pings at 34 s, 79 s and 124 s** (`modules/wsSocketHeartbeat.js`) kept the socket from idling; the longest silence between frames was 45 s, so the margin to the 60 s cut is 15 s. A client that sends nothing and a server tick that slips by 15 s would be cut: a real finding for the keep-alive design |

Evidence: `/tmp/claude-1000/-home-kanmi-staticforge/2381ca56-dc3c-5327-919d-624c1c42a2f5/scratchpad/replicas/` (`shots/replica-demo-login.png`, `shots/replica-demo-signed-in.png`,
`ws-keepalive.out`, `build-log-tail.txt`, `replica-demo-start.log`, `seed.out`).

Known limits: the host crashed (DMAR / hpsa) under a few GB of writes until `intel_iommu=off`; the image replicas have no `.git` (`fatal: not a git repository` once at boot);
`docker stop` of a replica ends with exit 137 (the server does not finish its graceful shutdown inside Docker's 10 s).
