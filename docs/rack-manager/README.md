# Rack Manager

Rack Manager is the MMC console (Administrative Tools > Rack Manager, `rackmgr.msc`) for the rack servers:
their iLO (console, hardware, power) and their **roles**, the work Dreamscape moves onto them. Fat Misaka
(DL580 G7, a lot of RAM and disk) is the host for clone Dreamscape servers, Android emulators, browser
sandboxes, update tests, Android app builds and other compiling, with RAM disks to speed builds up.

Every role is usable three ways, all over the same server code:

| who | how |
|---|---|
| people | the MMC console (`public/scripts/comp/mmcRackManager.js`) over WS packets `rack_*` (admins, full sign-in) |
| Fleet agents | agent-coord MCP tools `rack_status`, `rack_role`, `rack_exec`, `rack_job` (modules/agentCoord/mcpServer.js -> unix socket `rack.sock` beside the coordination DB) |
| the server | `require('./rackManager')` (modules/rackManager/index.js) |

```
 MMC console ──WS rack_*──┐
 Fleet (MCP) ──rack.sock──┤ modules/rackManager/ (Dreamscape server) ──ssh -L tunnel──> rackd on the host (127.0.0.1:8791): Roles
                          │        │ unix socket ilo.sock
                          │        └──> iLO service (child process, modules/rackManager/ilo/): Console, Hardware, Power
                          │               ├ telemetry poller (iLO 3 every 5 s) -> .cache/rack-manager/ilo/
                          │               └ LAN listener 192.168.100.250:8790: /iso/<name> and read-only health|history|power for the rack hosts
                          └ a lean supervisor child (modules/rackManager/supervisor.js) owns the ssh tunnels and the iLO service
```

## Pieces

| piece | where | what |
|---|---|---|
| iLO service | `modules/rackManager/ilo/` (a script copy of `~/ilo-console`: `lib/*.js` are byte copies, `server.js` has targeted edits; README of the original: Old-TLS requirements stay as they are) | Java-free iLO 2/3 console, health, power, telemetry, virtual media, logs. A child process of the supervisor (video decode is CPU heavy, never in the server's event loop). HTTP + WS `/ws/<ilo>` on the unix socket `.cache/rack-manager/ilo.sock` (env `RACK_ILO_SOCK`); data in `.cache/rack-manager/ilo/` (env `DATA_DIR`: telemetry, boots-*.json, boottrace); `PASSFILE` `~/.config/ilo/dream_admin.pass`, `ISO_DIR` `~/iso`. Extra route `POST /api/<ilo>/powerop {op:0-3}` (press, hold, cold, reset) for rackManager. LAN listener (env `RACK_ILO_LAN_BIND`, default `192.168.100.250:8790`, bound only when the address exists here; EADDRINUSE logged once, retried every 60 s): answers only `GET|HEAD /iso/<name>` (the iLOs' virtual media) and `GET /api/<ilo>/health|history|power` from 192.168.100.40-43 (the hosts' login-status timers); everything else 404 (`modules/rackManager/ilo/lan.js`). The standalone `~/ilo-console` server is retired at cutover |
| rackd | `services/rackd/` (deployed to `/opt/rackd` on each host) | the host agent: one Node process (no npm dependencies), runs as root under systemd `rackd.service`, listens on **127.0.0.1:8791 only**, bearer token |
| deploy | `scripts/rack/deploy-rackd.sh <server>` | rsync + systemd unit + token; idempotent |
| server module | `modules/rackManager/index.js` (+ `supervisor.js`, `ilo/`) | server list, ssh tunnels to rackd, rackd/ilo clients, event fan-out, audit log, `rack.sock`, the iLO service child. A forked lean supervisor (spawnHelper cannot hold long-lived children) spawns the ssh tunnels and the iLO service, restarts them with backoff 2 s .. 60 s |
| WS packets | `modules/ws/handlers/322-rackManagerHandler.js`, `docs/client-api/ws/rackManager.md` | admin full sign-in only (same guard as the Administrator Terminal) |
| HTTP routes | registered by rackManager/index.js (`mount`, `attachUpgrade`; wired next to `androidBuilds` in web_server.js) | `/rack/:server/...` binary things: screenshots, the iLO console and terminal WebSockets |
| console | `public/scripts/comp/mmcRackManager.js`, `public/css/mmc-rackmgr.css` | the MMC snap-in |

## Servers

`.cache/rack-manager/servers.json` (created with these defaults when missing):

```json
[
  { "name": "misaka", "label": "Fat Misaka", "model": "ProLiant DL580 G7", "ilo": "misaka",
    "host": "192.168.100.42", "ssh": "fat-misaka", "rackdPort": 8791, "tokenFile": "~/.secrets/rackd-misaka.token" },
  { "name": "asuka", "label": "Chubby Asuka", "model": "ProLiant DL380 G5", "ilo": "asuka",
    "host": "192.168.100.40", "ssh": "chubby-asuka", "rackdPort": 8791, "tokenFile": "~/.secrets/rackd-asuka.token" }
]
```

`ssh fat-misaka` = `hvadmin@192.168.100.42`, key `~/.ssh/rack_ed25519` (in `~/.ssh/config`). rackManager keeps
one supervised `ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:<local>:127.0.0.1:8791 <ssh>` per server
(spawned with modules/spawnHelper.js, restarted with backoff 2 s .. 60 s, only while the host answers).
Extra forwards (a sandbox's CDP port, an emulator's adb port) are added on demand the same way and closed
when unused for 10 min.

## rackd HTTP API (v1)

All requests carry `Authorization: Bearer <token>` (token file `/etc/rackd/token` on the host, mode 600; the
same value in Dreamscape's `tokenFile`). JSON in and out. Errors: `{ "error": "text", "code": "CODE" }` with
4xx/5xx. Long work returns `{ "job": { id, ... } }` at once (HTTP 202).

| method + path | what |
|---|---|
| `GET /v1/info` | `{ host, os, kernel, uptimeS, cpus:{count,model,threads}, memory:{totalB,availB}, load:[1,5,15], rackd:{version,startedAt}, roles:{ <role>:{ installed, ready, summary, missing:[pkgs] } } }` |
| `GET /v1/events` | Server-Sent Events, one stream: `event: rack` / `data: {role, kind, id?, data}`; a `: ping` comment every 25 s |
| `GET /v1/jobs` / `GET /v1/jobs/:id?tail=200` / `POST /v1/jobs/:id/cancel` | jobs `{id, role, title, state: running|done|failed|cancelled, startedAt, endedAt, exitCode, log (tail)}`; kept 7 days in `/var/lib/rackd/jobs/` |
| `POST /v1/roles/:role/install` | job: installs the role's packages (the Add Roles Wizard) |
| `GET /v1/files/:kind/:name` | binary files rackd made (`shots/` PNG screenshots, `exports/`, `artifacts/` = `<runId>__<file>` of a build run); `Cache-Control: private, max-age=31536000, immutable` (names are unique) |
| `GET /v1/:role` | the role's state (below) |
| `POST /v1/:role/:action` | body = params; answers the result, or `{job}` for long work |
| `GET /v1/metrics/history?range=3h\|6h\|24h\|7d&points=360` | `{from, to, step, samples:[{t, cpu, memUsedB, memTotalB, diskRBps, diskWBps, netRxBps, netTxBps, load1, vms, avds, sandboxes, containers, replicas, builds, jobs}]}`: rackd samples every 30 s while it runs (`/proc` plus counts it keeps from its own events; ring of 24 h in memory, `/var/lib/rackd/metrics/YYYY-MM-DD.jsonl` kept 7 days); buckets average, counts take the max; `step` is the bucket width in ms |
| `GET /v1/idle` | `{ idle, idleSince, busy:[{kind, id, why}] }` (see Power on demand); an SSE `host`/`idle` event follows every change |
| `POST /v1/host/shutdown {reason, dryRun?}` | job: graceful stop (sandboxes, emulators, containers, VMs, RAM disk sync, final record `/var/lib/rackd/last-shutdown.json`), then `systemctl poweroff`; `dryRun:true` logs the plan and stops nothing |
| `GET /v1/terminal/ws?cols&rows&cmd=&user=` | WebSocket: an interactive pty (text frames in/out; `{"t":"resize",cols,rows}` JSON text frames start with `\u0000`) |

Events (`kind`): `state` (a thing changed: `{id, state}`), `added`, `removed`, `job` (job started/progress/
ended), `log` (a followed journal line), `metrics` (every 10 s while anyone listens: `{cpu, mem:{totalB,usedB,availB}, load, net:{rxBps,txBps}, disk:{rBps,wBps}}`). Events are pushed, never polled for.

### Roles and actions

rackd guards the host: `services` refuses stop/restart/disable/mask of ssh, NetworkManager, libvirtd*, cockpit*, kiosk, rackd, dbus and the like (`PROTECTED`);
`networking` refuses to move the host's interfaces into a bridge, to delete the host bridge or to stop the libvirt network on it; `storage` refuses `lv-delete` of mounted/open/VM-used volumes.
Bridges made by `bridge-create` are runtime only (not written to the host's network configuration). Unit files, scripts and env files of `services define` live in `/var/lib/rackd/services`.

Role ids: `vms`, `android`, `sandboxes`, `terminal`, `storage`, `networking`, `services`, `logs`, `updates`, `containers`, `builds`, `replicas`.

**vms** — libvirt (`qemu:///system`, `virsh`).
`GET`: `{ vms:[{name, uuid, state, vcpus, memMB, autostart, persistent, disks:[{target,source,sizeB}], nics:[{mac,network,ip}], vnc, tags:{purpose,branch} }], networks:[], pools:[], templates:[] }`.
Actions: `start|shutdown|reboot|destroy|suspend|resume {name}`, `create {name, vcpus, memMB, diskGB, iso?, osVariant?, network?}` (job),
`clone {source, name}` (job, virt-clone), `delete {name, storage:true|false}`, `set {name, vcpus?, memMB?, autostart?}`,
`snapshots {name}`, `snapshot {name, snap, op: create|revert|delete}`, `screenshot {name}` -> `{file}` (virsh screenshot -> PNG),
`tag {name, tags:{purpose?,branch?,template?,disposable?}}` (null/'' removes one), `pool` (create, optional: `ssd` when diskGB <= 100 else `hdd`),
`dsclone {name, branch?, from?}` (job: clones the template VM (`from`, default the VM tagged `template=dreamscape`), boots it, checks the branch out over ssh, tags it `purpose=ds-clone`).

**android** — Android SDK at `/opt/android-sdk` (cmdline-tools, emulator, platform-tools), AVDs in `/var/lib/rackd/avd`, run as user `rack`.
`GET`: `{ sdk:{path, emulator, platformTools}, kvm:bool, avds:[{name, api, abi, device, ramMB, diskB, running, serial, consolePort, adbPort, boot:'off'|'booting'|'ready', pid}], images:[{package, installed}], devices:[{serial, state, model}] }`.
Actions: `create {name, image, device?, ramMB?, diskGB?, emulator?}` (answers `{name}`, or `{job}` when the image has to be downloaded first; `emulator` = `sdk` or an archived build installed with `emulator-build {build}` (job) under `/opt/android-emulators/<build>`), `start {name, headless:true, wipe?, gpu?, ramdisk?}` (ramdisk: the AVD's writable files live on a RAM disk while it runs),
`stop|wipe|delete {name}`, `screenshot {name}` -> `{file}`, `install {name, apk (host path) | url}` (job), `shell {name, cmd}` -> `{code, out}`,
`sdk {packages:[...]}` (job: sdkmanager install), `adb {args:[...]}` -> `{code, out}`.

**sandboxes** — browser environments for testing: Chromium (system `chromium` or the Playwright build) with `--remote-debugging-port`, own profile dir.
`GET`: `{ browser:{path, version}, sandboxes:[{id, name, state, pid, cdpPort, profile, ramdisk, url, viewport:{w,h,dpr,mobile}, createdAt}] }`.
Actions: `create {name, url?, viewport?, ramdisk:true, headless:true}`, `start|stop|delete {id}`, `navigate {id, url}`, `screenshot {id}` -> `{file}` (CDP Page.captureScreenshot),
`cdp {id}` -> `{port, wsPath, pagePath}` (Dreamscape forwards the port and answers a local `ws://127.0.0.1:<p>/...` for Fleet agents), `eval {id, expression}` -> `{value}`.

**terminal** — commands and persistent shells.
`GET`: `{ tmux:[{name, created, attached, windows, cmd}], ptys:[{id, pid, startedAt}] }`.
Actions: `exec {cmd, cwd?, timeoutS?:60, user?:'rack'|'root'}` -> `{code, stdout, stderr, ms}` (output capped 1 MB),
`tmux-new {name, cmd?, cwd?}`, `tmux-send {name, keys (literal text), keyNames?:['C-c','Up',...], enter?:true}`, `tmux-capture {name, lines?:200}` -> `{text}`, `tmux-kill {name}`, `pty-kill {id}`.

**storage** — disks, filesystems, RAM disks.
`GET`: `{ disks: lsblk tree [{name, size, type, model, mountpoint, fstype, children}], filesystems:[{mount, fstype, sizeB, usedB, availB}], arrays:[...], ramdisks:[{name, kind:'tmpfs'|'zram', sizeB, usedB, mount, owner, backing?, syncMin?, persist}], memory:{totalB, availB, ramdiskB} }`.
Actions: `ramdisk-create {name, sizeGB, kind?:'tmpfs', owner?:'rack', backing?, syncMin?, persist?:true}` (mount under `/mnt/ram/<name>`; `backing`: restored from that dir at create and rsynced back every `syncMin` and at delete/shutdown),
`ramdisk-resize {name, sizeGB}`, `ramdisk-sync {name}`, `ramdisk-delete {name, sync?:true}`, `du {path, depth?:1}`. Persisted ramdisks are recreated when rackd starts. RAM disks may not take more than total RAM minus 32 GB.
LVM (the `GET` adds `vgs:[{name, sizeB, freeB, pvs}]`, `lvs:[{vg, name, sizeB, mount?, fstype?, usedBy?}]`): `lv-create {vg, name, sizeGB, fs?:'ext4'|'xfs'|null, mount?}` (adds an fstab line when mounted), `lv-resize {vg, name, sizeGB}` (grow only, with the fs), `lv-delete {vg, name, confirm:true}` (refused while mounted or used by a VM).

Fat Misaka (measured Nov 27 2026): 80 threads (4x Xeon E7-4860, Westmere-EX: VT-x, **no AVX**), 503 GB RAM, Debian 13, kernel 6.12,
SSD VG `misaka-vg` (476 GB, 373 GB free; libvirt pool `ssd`), HDD VG `vmdata` (4.55 TB free; pool `hdd`), ISO pool `/var/lib/libvirt/images/iso`,
bridge `br0` (192.168.100.42, libvirt network `br0`), libvirtd + virt-install/virt-clone installed, Node 20 (Debian), tmux, rsync, smartmontools.
Fixed (Nov 27 2026): with the kernel's default `intel_iommu` the host crashed under a few GB of disk writes (hpsa vs the HP RMRR regions); the kernel command line now has `intel_iommu=off` (details in android-no-avx.md).
User `hvadmin` (sudo, libvirt, kvm) is the ssh login; rackd runs as root, user-level work (emulators, browsers, builds) as `rack` (created by deploy).

**networking**.
`GET`: `{ interfaces:[{name, state, mac, mtu, addrs:[], rxB, txB, speed}], routes:[], bridges:[], listening:[{proto, addr, port, process}], libvirt:[{name, active, bridge, subnet}] }`.
Actions: `ping {host, count?:4}`, `bridge-create {name, ports?:[]}` / `bridge-delete {name}`, `libvirt-net {name, op: start|stop|autostart}`.

**services** — systemd.
`GET`: `{ services:[{unit, load, active, sub, description, enabled}], rack:[{name, unit, cmd, user, cwd}] }`.
Actions: `start|stop|restart|reload|enable|disable|mask|unmask {unit}`, `status {unit}` -> `{props, log:[lines]}`,
`define {name, cmd, cwd?, user?:'rack', env?, restart?:'on-failure'}` (writes `rack-<name>.service`), `undefine {name}`.

**logs** — journald.
`GET` (query string): `?unit=&priority=0-7&since=&until=&grep=&lines=200&boot=` -> `{ entries:[{t, unit, priority, pid, message}], boots:[{id, first, last}] }`.
Actions: `follow {unit?, priority?}` -> `{followId}` (lines arrive as `log` events), `unfollow {followId}`, `dmesg {lines?}`.

**updates** — apt (and rackd itself).
`GET`: `{ lastCheck, upgradable:[{package, from, to, security}], rebootRequired, held:[], history:[{start, end, command, upgraded:[]}] }`.
Actions: `check` (job: apt-get update), `upgrade {packages?:[]}` (job: apt-get -y upgrade / install --only-upgrade), `hold|unhold {package}`, `autoremove` (job).

**containers** — Docker (docker.io from Debian, data root on an LV in `vmdata`, `/srv/rack/docker`).
`GET`: `{ engine:{version, dataRoot, running}, containers:[{id, name, image, state, status, ports, cpus, memB, labels, createdAt}], images:[{id, tags, sizeB, createdAt}], volumes:[{name, sizeB, usedBy}], networks:[] }`.
Actions: `start|stop|restart|kill|remove {id}`, `logs {id, lines?}` -> `{text}`, `exec {id, cmd}` -> `{code, out}`, `pull {image}` (job), `build {tag, context (host path), dockerfile?}` (job),
`run {name, image, cmd?, env?, mounts?, cpus?, memGB?, ports?, labels?}`, `image-remove {id}`, `volume-remove {name}`, `prune {what: images|containers|volumes|builder, confirm:true}` (job).

**builds** — clean, isolated, tracked builds: every run is a fresh container (role `containers`) on a persistent source checkout, with caches kept apart from the tree and the run's whole record kept.
Layout: `/srv/rack/builds/<pipeline>/src` (git checkout, `git fetch` + `git clean -ffdx` + checkout of the asked ref before each run), `/srv/rack/builds/<pipeline>/cache` (gradle / ccache / siso / npm caches, optionally on a RAM disk), `/srv/rack/artifacts/<runId>/` (what the pipeline's `artifacts` globs pick up, served as files kind `artifacts`), `/var/lib/rackd/builds/runs/<runId>.json` (pipeline, ref, commit, started/ended, state, exit, who asked, artifact list, log file).
`GET`: `{ pipelines:[{id, name, repo, ref, image, cpus, memGB, cacheRamdisk, lastRun}], runs:[{id, pipeline, ref, commit, state, startedAt, endedAt, exitCode, by, artifacts:[{name, sizeB}]}] (newest 100) }`.
Actions: `pipeline-define {id, name, repo, ref, image | dockerfile, script, env?, cpus?, memGB?, cacheRamdisk?:GB, artifacts:[globs], timeoutMin?}`, `pipeline-delete {id}`,
`run {pipeline, ref?, by?}` (job; the job id is the run id), `cancel {run}`, `run-get {run, tail?}` -> run record + log tail, `artifact-remove {run}`.
Presets shipped with rackd (`services/rackd/pipelines/*.json` + their Dockerfiles): `dsapp` (DSApp-Kotlin `./gradlew assembleDebug`, JDK + Android SDK in the image; replaces building on Ruiko),
`alchemy-chromium` (DreamScape/Alchemy-Chromium patches on Chromium: depot_tools, `gclient sync`, `apply.py`, `autoninja`, package; source on its own 400 GB LV; replaces Sequenzia Core as the Chromium build host),
`staticforge-tests` (repo checkout + `npm ci` + the repo's test scripts). Git access to Yozora: a read token in `/etc/rackd/git-credentials` (mode 600, copied by the deploy script from Dreamscape's `~/.secrets/yozora-claude.token`, never printed).

**replicas** — Dreamscape replica servers for development: a separate server per agent / task, so work no longer restarts the live
Dreamscape. Several run at once. Each replica is a container built from the repo's own `Dockerfile` (that is the point: the image build,
`scripts/setup.sh` / `scripts/install-linux.sh` and `docs/CLEAN_INSTALL.md` stay true because they are used every day).
`GET`: `{ images:[{tag, ref, commit, builtAt, sizeB}], seeds:[{id, takenAt, sizeB, from, timeS, keys}], replicas:[{name, owner, purpose, ref, commit, mode:'image'|'worktree', state, port, tlsPort, url, urlDirect, httpDirect, seed, dataB, createdAt, startedAt, health:{ok,status,ms}, allow, memGB, cpus, image}] }`.
Actions: `image-build {ref}` (job: build `dreamscape:<sha>` from that ref with the repo Dockerfile), `seed-take {from?:'dreamscape'}` (job: a data snapshot of the live server for replicas, see below),
`create {name, ref?:'main', owner?, purpose?, mode?:'worktree', seed?:<seed id>|'empty', port?, keys?:'copy', allow?:['novelai',...], memGB?:8, cpus?:8}` (job), `start|stop|restart {name}`, `logs {name, lines?}`, `exec {name, cmd}`,
`pull {name, ref?}` (worktree mode: fetch + checkout + restart), `login {name}` -> `{loginKey, loginPin, readOnlyPin, url, urlDirect}` (the replica's own sign-in secrets), `delete {name, confirm:true}`.
`seed-take` answers `{needsDreamscape:true}`: modules/rackManager runs `scripts/rack/seed-replica.sh` on Dreamscape (rsync over `ssh fat-misaka`). Full contract, seed contents, gates and the HTTPS front: **docs/rack-manager/replicas.md**.
Mode `worktree`: the replica's source is a git checkout at `/srv/rack/replicas/<name>/src` bind-mounted into the container (an agent edits there, over `rack_exec` / the terminal, and pushes its branch); `image`: the code baked in the image at `ref`.
Data: each replica has its own data dir (`.cache`, `images`, configs) cloned copy-on-write from a seed (xfs reflink on the replicas LV), so a replica can never write the live data. Configs get the replica's own login key and session secret.
**Replica mode (`DREAMSCAPE_REPLICA=1` in the container)**: the server does nothing that reaches the outside world on its own: no Supervisor / Fleet dispatch, no agent-coord sockets, no phone delivery (ActiveSync pushes, APK installs, notifications to real devices), no mail sync or send, no Yozora writes, no Android builds, no Rack Manager / iLO, no scheduled jobs that spend money (NovelAI paid calls need an explicit per-replica allow), no replication into the primary. Each such module checks one helper (`modules/replicaMode.js`).
Reached the way production is: nginx on the host terminates TLS per replica (`https://<name>.rack.lan/`, or without DNS `https://192.168.100.42:<port+100>/`, 9401..9499), certificates from the rack CA (`/etc/rackd/ca`, public `ca.crt` as files kind `ca`), `proxy_read_timeout 60s` like Kuroko. The container's own HTTP port (9301..9399) answers health probes; sign-in needs the HTTPS front (the session cookie is `secure`). For Dreamscape-side agents, through a forward rackManager opens on demand.

## Power on demand (the host is off unless there is work)

Fat Misaka is not meant to run all the time. Rack Manager powers it on when work needs it and shuts it down after hours with no work.

- **Power on:** through the iLO (the integrated iLO service: press the power button). Triggers: a Fleet `rack_power {server, action:'on', wait?:true}`,
  a `rack_lease` taken while it is off, any `rack_role` / `rack_exec` / WS `rack_action` with `wake: true`, the console's Power On, or a scheduled
  pipeline/replica start. Without `wake`, a role call on a host that is off answers `{ refused: true, code: 'HOST_OFF', power: 'off' }` at once (no waiting, no retry loop).
  States: `off` -> `powering-on` (POST, ~165 s on Misaka; the boot-progress bar from the iLO's POST codes) -> `booting` (OS) -> `up` (rackd answers through the tunnel) / `shutting-down` / `off`.
  `wait: true` waits for `up` (at most 10 min) and answers the boot timings.
- **Leases** keep the host awake: `rack_lease {server, purpose, minutes (default 60, max 1440), id? (renew)}` / `rack_lease_release {id}`. A lease is taken
  automatically by every running job, build run, replica, VM, AVD, sandbox and attached terminal (rackd reports them) and by the console while a page of that server is open.
- **Idle shutdown:** rackd answers `GET /v1/idle` -> `{ idle: bool, idleSince, busy:[{kind, id, why}] }` (busy: running jobs/builds, running VMs/AVDs/sandboxes/replicas,
  ptys, tmux sessions with output in the last 30 min, logged-in ssh users, load average over 2.0). Dreamscape shuts the host down when rackd has been idle AND
  no lease is open for `idleShutdownMin` (default 180, per server in servers.json `power: { auto: true, idleShutdownMin, wakeOnDemand: true }`).
  It checks when rackd's `idle` event changes and when a lease ends, not on a timer loop (one timer set for the deadline).
- **Shutdown** is graceful: `POST /v1/host/shutdown {reason}` on rackd: stop sandboxes and emulators, `virsh shutdown` VMs (wait up to 3 min, then destroy
  only the ones tagged `disposable`), stop replicas, sync RAM disks that have a backing dir, then `systemctl poweroff`. If rackd is down, the iLO's momentary
  press (ACPI) is used; never "press and hold" automatically. Every power change is in the audit log with who/why.
- Fleet tools: `rack_power {server, action: 'on'|'off'|'status', wait?, reason}` (off needs `confirm: true` and refuses while leases are open unless `force: true`),
  `rack_lease`, `rack_lease_release`. Status includes state, since, leases, idle info and the time left before the idle shutdown.
- While the host is off, Dreamscape holds no tunnel and no SSE connection to it (no reconnect loop against a powered-off machine); the iLO telemetry keeps running.

## Android without AVX

Fat Misaka's Westmere CPUs have SSE4.2/POPCNT (x86-64-v2) but no AVX. The Android lane (docs/testing/emulator-lane.md: Fold-shaped
API 37 and A53-shaped API 36 `google_apis x86_64` images, Shizuku, adb) must run here. Order of attempts, first that boots the lane's images wins:
1. the current SDK emulator; 2. older emulator builds from Google's archive with the same images; 3. the emulator rebuilt from AOSP source
without AVX code paths (a `builds` pipeline); 4. Cuttlefish (AOSP's virtual device on standard KVM/crosvm) with matching `aosp_cf_x86_64` images;
5. Android-x86 / a custom AOSP x86_64 build under libvirt. The android role hides which backend runs an AVD (`backend` field in its record).

## Dreamscape side

### WS packets (docs/client-api/ws/rackManager.md)

| packet | answer |
|---|---|
| `rack_list {}` | `rack_list_response {servers:[{name,label,model,ilo:{connected,power},rackd:{state:'up'|'down'|'not-deployed'|'connecting', error?, info?}}]}` |
| `rack_get {server, role}` | `{role, data}` (role = one of the roles, or `info`, `jobs`) |
| `rack_action {server, role, action, params}` | `{result}` or `{job}` |
| `rack_ilo {server, what: health|power|history|logs|memory|media|settings|users, params?}` | `{data}` (proxied from the iLO service) |
| `rack_ilo_action {server, action: power|powercap|powersaver|media, params}` | `{result}`; power `{op: 'press'|'hold'|'reset'|'cold'}` |
| `rack_subscribe {server}` / `rack_unsubscribe {server}` | pushes `rack_event` (the packet's `data` is `{server, role, kind, id, data}`; `role:'rackd', kind:'state'` reports the tunnel) to that socket while subscribed (and on socket close it ends) |
| `rack_job {server, id?, cancel?, tail?}` | `{job}` (or `{jobs}` without id) |
| `rack_power {server, action: 'on'\|'off'\|'status', reason?, force?}` | the status `{state, since, post?, leases:[{id,purpose,who,since,ends}], idle:{idle,idleSince,busy}, deadline, settings}`; `off` is refused `LEASES_OPEN` while leases or busy items are open unless `force` |
| `rack_power_settings {server, settings:{auto?, idleShutdownMin?, wakeOnDemand?}}` | `{settings, power}`; written to servers.json `power` |
| `wake: true` on `rack_get` / `rack_action` / `rack_job` | powers the host on and waits (at most 10 min); without it a host that is off answers `{success:false, refused:true, code:'HOST_OFF', power:'off'}` (`HOST_BOOTING` while powering-on/booting, `HOST_SHUTTING_DOWN`) |

### HTTP (admin full sign-in, same check as the WS guard)

| path | what |
|---|---|
| `GET /rack/:server/ilo/screenshot.png` | the iLO console framebuffer (iLO service) |
| `WS /rack/:server/ilo/ws` | the live iLO console, proxied byte-for-byte to the iLO service's `/ws/<ilo>` on `ilo.sock` (protocol in ~/ilo-console/README.md) |
| `GET /rack/:server/files/:kind/:name`, `.../files/artifacts/<runId>/<name>` | rackd's files (screenshots, exports, build artifacts); streamed, `Range` passed through, never buffered |
| `WS /rack/:server/terminal/ws?cols&rows` | rackd's interactive pty |

### Fleet tools (agent-coord)

| tool | does |
|---|---|
| `rack_status {server?}` | servers, iLO power, host power state, rackd state, roles summary, running jobs, running build runs |
| `rack_role {server, role, action?, params?}` | no action: the role's state; with action: runs it (as the WS packet) |
| `rack_exec {server, cmd, cwd?, timeout_s?, user?}` | `terminal/exec` shorthand |
| `rack_job {server, id?, cancel?}` | jobs list / one job's log / cancel |
| `rack_power {server, action, wait?, reason?, confirm?, force?}` | power on demand: `status`, `on` (iLO press), `off` (rackd graceful shutdown; `confirm: true`; refused while leases are open unless `force`) |
| `rack_lease {server, purpose, minutes?, id?, wait?}` / `rack_lease_release {id}` | keep the host awake; a lease taken while it is off powers it on |
| `wake: true` on `rack_role` / `rack_exec` / `rack_job` | power the host on and wait; otherwise a host that is off answers `{refused:true, code:'HOST_OFF', power:'off'}` as a result |

Host power (`rack_ilo_action power`), vms destroy/delete, storage lv-delete and ramdisk-delete with `sync:false`, android delete, containers remove/prune/image-remove/volume-remove and builds pipeline-delete/artifact-remove from Fleet need `confirm: true` in params (the server answers `CONFIRM_REQUIRED`).
Fleet `rack_role` with `role:'ilo'` reads (`params.what`) or acts (power, powercap, powersaver, media) on the iLO. `rack.sock` also has `op:'follow'` (a held line-JSON stream of events; a subscriber like a WS client).
Every write (any client, any agent) is appended to `.cache/rack-manager/audit.jsonl`
`{t, who, via: 'ws'|'fleet', server, role, action, params (secrets dropped), ok, error?}`.

### Power on demand, as implemented (modules/rackManager/index.js)

- **State** per server: `unknown` (the iLO service has not reported yet: role calls are not gated) | `off` | `powering-on` | `booting` | `up` | `shutting-down`.
  The iLO service pushes `GET /api/power-events` (SSE on `ilo.sock`: `{server, on, t}` when telemetry sees the host power change, and `{server, post:{code,pct,stage,elapsed,eta,done}}`
  from the console session it keeps open through a power-on, `powerop {watch:true}`). `off` -> `powering-on` on the press (or an `on` event); POST `done` (or 120 s without POST codes, iLO 2)
  -> `booting`, which starts the ssh tunnel; rackd answering `/v1/info` -> `up` (no token file: `up` with rackd not-deployed). `on:false` from any state -> `off`: the tunnel supervisor entry,
  extra forwards and the SSE stream of that server are stopped and nothing reconnects until the next power-on.
- **Push:** `rack_event` `{role:'power', kind:'state', data:{state, since, post?:{stage,pct,eta,code}}}` on every change and every new POST percentage.
- **Leases:** `.cache/rack-manager/leases.json` (explicit leases only; a page's `console` lease is tied to its socket: `rack_subscribe` takes it, `rack_unsubscribe` / socket close release it). Busy items from rackd's idle
  state count like leases (`busy` in the status) and block `off` without `force`.
- **Idle shutdown:** while a host is `up` and `power.auto` is on, one internal subscriber keeps rackd's `/v1/events` stream open for the `idle` events (`{idle, idleSince, busy}`; a `GET /v1/idle` at power-up and
  when an event carries no body). The ONE deadline timer per server is `max(idleSince, last lease end, open lease expiry) + idleShutdownMin`; no timer while busy or while a page holds the console lease.
  Recomputed on idle events, lease take / renew / release and settings changes; at the deadline `/v1/idle` is asked once more, then `POST /v1/host/shutdown {reason}`. If rackd is unreachable (tunnel not up): the iLO
  momentary press only (`powerop` 0); never hold / cold boot automatically. Audit lines for power: `{role:'power', action:'on'|'off'|'settings', who, via:'ws'|'fleet'|'wake'|'auto', params:{reason, force?, how:'rackd'|'ilo-press'}}`; leases: `role:'lease'`.
