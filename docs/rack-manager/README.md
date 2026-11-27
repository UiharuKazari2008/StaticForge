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
| the server | `require('./rackManager')` (modules/rackManager.js) |

```
 MMC console ──WS rack_*──┐
 Fleet (MCP) ──rack.sock──┤ modules/rackManager.js ──HTTP──> ilo-console (127.0.0.1:8790, ~/ilo-console): Console, Hardware, Power
                          │      (Dreamscape server)  └─ssh -L tunnel─> rackd on the host (127.0.0.1:8791): Roles
```

## Pieces

| piece | where | what |
|---|---|---|
| ilo-console | `~/ilo-console` on Dreamscape (README there) | Java-free iLO 2/3 console, health, power, telemetry, virtual media, logs. HTTP `127.0.0.1:8790`, WS `/ws/<server>` |
| rackd | `tools/rack/rackd/` (deployed to `/opt/rackd` on each host) | the host agent: one Node process (no npm dependencies), runs as root under systemd `rackd.service`, listens on **127.0.0.1:8791 only**, bearer token |
| deploy | `scripts/rack/deploy-rackd.sh <server>` | rsync + systemd unit + token; idempotent |
| server module | `modules/rackManager.js` | server list, ssh tunnels to rackd, rackd/ilo clients, event fan-out, audit log, `rack.sock` |
| WS packets | `modules/ws/handlers/322-rackManagerHandler.js`, `docs/client-api/ws/rackManager.md` | admin full sign-in only (same guard as the Administrator Terminal) |
| HTTP routes | registered by rackManager.js | `/rack/:server/...` binary things: screenshots, the iLO console and terminal WebSockets |
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
| `GET /v1/files/:kind/:name` | binary files rackd made (`shots/` PNG screenshots, `exports/`); `Cache-Control: private, max-age=31536000, immutable` (names are unique) |
| `GET /v1/:role` | the role's state (below) |
| `POST /v1/:role/:action` | body = params; answers the result, or `{job}` for long work |
| `GET /v1/terminal/ws?cols&rows&cmd=` | WebSocket: an interactive pty (text frames in/out; `{"t":"resize",cols,rows}` JSON text frames start with `\u0000`) |

Events (`kind`): `state` (a thing changed: `{id, state}`), `added`, `removed`, `job` (job started/progress/
ended), `log` (a followed journal line), `metrics` (every 10 s while anyone listens: cpu %, mem, load, net,
disk io). Events are pushed, never polled for.

### Roles and actions

Role ids: `vms`, `android`, `sandboxes`, `terminal`, `storage`, `networking`, `services`, `logs`, `updates`, `containers`, `builds`.

**vms** — libvirt (`qemu:///system`, `virsh`).
`GET`: `{ vms:[{name, uuid, state, vcpus, memMB, autostart, persistent, disks:[{target,source,sizeB}], nics:[{mac,network,ip}], vnc, tags:{purpose,branch} }], networks:[], pools:[], templates:[] }`.
Actions: `start|shutdown|reboot|destroy|suspend|resume {name}`, `create {name, vcpus, memMB, diskGB, iso?, osVariant?, network?}` (job),
`clone {source, name}` (job, virt-clone), `delete {name, storage:true|false}`, `set {name, vcpus?, memMB?, autostart?}`,
`snapshots {name}`, `snapshot {name, snap, op: create|revert|delete}`, `screenshot {name}` -> `{file}` (virsh screenshot -> PNG),
`dsclone {name, branch?, from?}` (job: clones the template VM (`from`, default the VM tagged `template=dreamscape`), boots it, checks the branch out over ssh, tags it `purpose=ds-clone`).

**android** — Android SDK at `/opt/android-sdk` (cmdline-tools, emulator, platform-tools), AVDs in `/var/lib/rackd/avd`, run as user `rack`.
`GET`: `{ sdk:{path, emulator, platformTools}, kvm:bool, avds:[{name, api, abi, device, ramMB, diskB, running, serial, consolePort, adbPort, boot:'off'|'booting'|'ready', pid}], images:[{package, installed}], devices:[{serial, state, model}] }`.
Actions: `create {name, image, device?, ramMB?, diskGB?}`, `start {name, headless:true, wipe?, gpu?, ramdisk?}` (ramdisk: the AVD's writable files live on a RAM disk while it runs),
`stop|wipe|delete {name}`, `screenshot {name}` -> `{file}`, `install {name, apk (host path) | url}` (job), `shell {name, cmd}` -> `{code, out}`,
`sdk {packages:[...]}` (job: sdkmanager install), `adb {args:[...]}` -> `{code, out}`.

**sandboxes** — browser environments for testing: Chromium (system `chromium` or the Playwright build) with `--remote-debugging-port`, own profile dir.
`GET`: `{ browser:{path, version}, sandboxes:[{id, name, state, pid, cdpPort, profile, ramdisk, url, viewport:{w,h,dpr,mobile}, createdAt}] }`.
Actions: `create {name, url?, viewport?, ramdisk:true, headless:true}`, `start|stop|delete {id}`, `navigate {id, url}`, `screenshot {id}` -> `{file}` (CDP Page.captureScreenshot),
`cdp {id}` -> `{port, wsPath}` (Dreamscape forwards the port and answers a local `ws://127.0.0.1:<p>/...` for Fleet agents), `eval {id, expression}` -> `{value}`.

**terminal** — commands and persistent shells.
`GET`: `{ tmux:[{name, created, attached, windows, cmd}], ptys:[{id, pid, startedAt}] }`.
Actions: `exec {cmd, cwd?, timeoutS?:60, user?:'rack'|'root'}` -> `{code, stdout, stderr, ms}` (output capped 1 MB),
`tmux-new {name, cmd?, cwd?}`, `tmux-send {name, keys, enter?:true}`, `tmux-capture {name, lines?:200}` -> `{text}`, `tmux-kill {name}`, `pty-kill {id}`.

**storage** — disks, filesystems, RAM disks.
`GET`: `{ disks: lsblk tree [{name, size, type, model, mountpoint, fstype, children}], filesystems:[{mount, fstype, sizeB, usedB, availB}], arrays:[...], ramdisks:[{name, kind:'tmpfs'|'zram', sizeB, usedB, mount, owner, backing?, syncMin?, persist}], memory:{totalB, availB, ramdiskB} }`.
Actions: `ramdisk-create {name, sizeGB, kind?:'tmpfs', owner?:'rack', backing?, syncMin?, persist?:true}` (mount under `/mnt/ram/<name>`; `backing`: restored from that dir at create and rsynced back every `syncMin` and at delete/shutdown),
`ramdisk-resize {name, sizeGB}`, `ramdisk-sync {name}`, `ramdisk-delete {name, sync?:true}`, `du {path, depth?:1}`. Persisted ramdisks are recreated when rackd starts. RAM disks may not take more than total RAM minus 32 GB.
LVM (the `GET` adds `vgs:[{name, sizeB, freeB, pvs}]`, `lvs:[{vg, name, sizeB, mount?, fstype?, usedBy?}]`): `lv-create {vg, name, sizeGB, fs?:'ext4'|'xfs'|null, mount?}` (adds an fstab line when mounted), `lv-resize {vg, name, sizeGB}` (grow only, with the fs), `lv-delete {vg, name, confirm:true}` (refused while mounted or used by a VM).

Fat Misaka (measured Nov 27 2026): 80 threads (4x Xeon E7-4860, Westmere-EX: VT-x, **no AVX**), 503 GB RAM, Debian 13, kernel 6.12,
SSD VG `misaka-vg` (476 GB, 373 GB free; libvirt pool `ssd`), HDD VG `vmdata` (4.55 TB free; pool `hdd`), ISO pool `/var/lib/libvirt/images/iso`,
bridge `br0` (192.168.100.42, libvirt network `br0`), libvirtd + virt-install/virt-clone installed, Node 20 (Debian), tmux, rsync, smartmontools.
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
Presets shipped with rackd (`tools/rack/rackd/pipelines/*.json` + their Dockerfiles): `dsapp` (DSApp-Kotlin `./gradlew assembleDebug`, JDK + Android SDK in the image; replaces building on Ruiko),
`alchemy-chromium` (DreamScape/Alchemy-Chromium patches on Chromium: depot_tools, `gclient sync`, `apply.py`, `autoninja`, package; source on its own 400 GB LV; replaces Sequenzia Core as the Chromium build host),
`staticforge-tests` (repo checkout + `npm ci` + the repo's test scripts). Git access to Yozora: a read token in `/etc/rackd/git-credentials` (mode 600, copied by the deploy script from Dreamscape's `~/.secrets/yozora-claude.token`, never printed).

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
| `rack_ilo {server, what: health|power|history|logs|memory|media|settings|users, params?}` | `{data}` (proxied from ilo-console) |
| `rack_ilo_action {server, action: power|powercap|powersaver|media, params}` | `{result}`; power `{op: 'press'|'hold'|'reset'|'cold'}` |
| `rack_subscribe {server}` / `rack_unsubscribe {server}` | pushes `rack_event {server, role, kind, id, data}` to that socket while subscribed (and on socket close it ends) |
| `rack_job {server, id, cancel?}` | `{job}` |

### HTTP (admin full sign-in, same check as the WS guard)

| path | what |
|---|---|
| `GET /rack/:server/ilo/screenshot.png` | the iLO console framebuffer (ilo-console) |
| `WS /rack/:server/ilo/ws` | the live iLO console, proxied byte-for-byte to `ws://127.0.0.1:8790/ws/<ilo>` (protocol in ~/ilo-console/README.md) |
| `GET /rack/:server/files/:kind/:name` | rackd's files (screenshots) |
| `WS /rack/:server/terminal/ws?cols&rows` | rackd's interactive pty |

### Fleet tools (agent-coord)

| tool | does |
|---|---|
| `rack_status {server?}` | servers, iLO power, rackd state, roles summary, running jobs |
| `rack_role {server, role, action?, params?}` | no action: the role's state; with action: runs it (as the WS packet) |
| `rack_exec {server, cmd, cwd?, timeout_s?, user?}` | `terminal/exec` shorthand |
| `rack_job {server, id?, cancel?}` | jobs list / one job's log / cancel |

Host power (`rack_ilo_action power`) and destroy/delete actions from Fleet need `confirm: true` in params.
Every write (any client, any agent) is appended to `.cache/rack-manager/audit.jsonl`
`{t, who, via: 'ws'|'fleet', server, role, action, params (secrets dropped), ok, error?}`.
