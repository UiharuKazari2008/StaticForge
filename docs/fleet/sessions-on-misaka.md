# Fleet sessions on Fat Misaka

Fleet can run a Claude Code session on Fat Misaka (the rack host) instead of on Dreamscape, so what an agent runs (builds, tests, browsers,
a server of its own) loads Misaka and not the live server. Measured on Dreamscape (8 cores, 13 GB): 11 `claude` processes cost 1.1 GB and 7 % CPU;
the load is what the agents start. So the session does not only run there: it works there, in its own replica.

Setting: `fleet.sessionHost` (`dreamscape` default until proven, `misaka`). A session or work item can also name `host: 'misaka' | 'dreamscape'`
(`claude_dispatch`, `fleet_work_update`, `coord_request_work`, `launcher.start`). `auto` / unset = the setting. Misaka is used only for StaticForge work
in the default folder with the Claude engine (replicas hold StaticForge; another engine runs through the Director bridge on Dreamscape; a resumed session
stays where its transcript is) and only when Rack Manager can reach the host; an `auto` request that cannot use Misaka starts on Dreamscape with the reason in its
message, an explicit `misaka` fails with the reason. The Supervisor's default flips to `misaka` by setting `fleet.sessionHost` (the lead decides after the proof).

## What runs where

| | Dreamscape | Fat Misaka |
|---|---|---|
| Fleet (work queue, Supervisor reviews, notices, usage, accounts, Remote Control servers) | all of it | nothing |
| agent-coord store, memory, task lists, device leases | the SQLite DB and sockets (one truth) | none: the session reaches them over ssh |
| Claude CLI process of the session, its tmux, its bash tools | no (Dreamscape sessions only) | user `agents`, tmux socket `dreamscape-claude-carry` (same name, own host), session `rc-<id8>` |
| Working folder | the live tree `/home/kanmi/staticforge` | its own replica worktree `/srv/rack/replicas/fleet-<id8>/src` (branch `work/fleet-<id8>`) and replica server |
| Yozora push | plain `git push` from the live tree | `git push origin HEAD:main` from the worktree, credential fetched over the back-channel per use |
| Transcript | `~/.claude/projects/` | written there, mirrored to `~/.claude/projects/<proj>/<id>.jsonl` on Dreamscape (pushed, see Visibility) |
| Token refresh | the only place a refresh token exists | access token only |

## Launch (`modules/misakaSessions.js`, called by `claudeSessionLauncher.launch` for host `misaka`)

1. **Lease + wake:** `rack` op `lease` `{server:'misaka', purpose:'Fleet session <id8>', minutes:1440, wait:true}`: powers the host on when it is off (iLO, ~3 min)
   and keeps idle shutdown away. Renewed (same id) at 20 h while the session lives. Released by `end()`.
2. **Host:** the agent account answers over ssh, runs the same Claude Code version as Dreamscape (`claude --version` here; copied with rsync when it differs),
   and has `~/fleet/misaka-watch.js` (shipped from `scripts/fleet/`).
3. **Replica:** the `replicas` role `create {name:'fleet-<id8>', mode:'worktree', ref:<ref of the newest image>, seed:<newest seed>}`. Using an existing image's ref is deliberate:
   `create` builds an image for the ref it is given (12 minutes when that commit has none) and worktree mode only needs the image for `node_modules` and the container.
   Then the worktree is handed to `agents` (`chown -R` through `rack exec` as root; rackd's own git calls use `safe.directory=*`) and moved to `origin/main`
   (`git fetch origin main && git checkout -B work/<name> origin/main`). Do not use the role's `pull` on these.
4. **Login and config:** `accounts/<account id>/config/` under the agent's home: `.credentials.json` (access token only, see below), `.claude.json` (onboarding, oauthAccount,
   folder trust), `settings.json` (bypass mode, the AskUserQuestion hook through the gate). Per session `fleet/sessions/<id>/`: `env.sh`, `mcp.json`, `run.sh`, `watch.sh`.
5. **tmux:** `fleetwatch-<id8>` (the watcher) and `rc-<id8>` (the session; `run.sh` = clean CLAUDE* env, `env.sh`, `claude --session-id ... --mcp-config mcp.json --strict-mcp-config ...; sleep 3600`,
   the same wrapper shape as on Dreamscape). The launcher's `watch()` runs unchanged over ssh (trust dialog, Remote Control nudge, ready check).
6. **Registration:** `coordNote` upserts the agent `claude-<id8>` with `host: 'fat-misaka'`, `cwd` = the replica, `repo: 'staticforge'`; the session's own agent-coord server (below) refreshes it.
7. A failed start leaves nothing: `end()` runs with what exists (replica deleted, lease released, tmux killed).

The brief gets a Misaka note in front: where it is, that the live-tree rules change (below), how to keep its replica.

## Accounts and tokens (the risky part)

How the CLI works (read from `claudeAccountRuntime.js`, `claudeUsage.js`, measured here): `.credentials.json` holds `claudeAiOauth {accessToken, refreshToken, expiresAt (~8 h), refreshTokenExpiresAt, ...}`.
The **refresh token rotates**: a refresh on one host makes the other host's copy useless. Dreamscape already guards this on one host ("an account is held once": a running CLI owns the rotation,
`claudeUsage` refreshes only idle accounts, the CLI's newer login is copied back to the linked login).

Decision: **the refresh token never leaves Dreamscape; Misaka gets the access token only.** `loginOf()` takes the fresher of the account's linked login and its config dir's login, removes
`refreshToken` and `refreshTokenExpiresAt`, and `install()` writes that file (mode 600, over ssh stdin, never printed, never logged) into `~agents/accounts/<id>/config/`. Measured: Claude Code 2.1.332 on Misaka
with such a file answered a haiku prompt (`pong`), so a refresh-less login works. Rejected alternatives: copying the full login (two holders of one rotating refresh token: the first refresh on either host kills the other,
and a Dreamscape idle-refresh by `claudeUsage` while a Misaka session runs is exactly that); a separate `/login` per account on Misaka (a second login is a second device grant per account that Yukimi would have to do interactively, and it
would count as another Remote Control machine); `CLAUDE_CODE_OAUTH_TOKEN` (a long-lived token is a second credential type and lacks the scopes Remote Control needs).
Renewal: a per-account timer (`accessTimer`, unref'd, runs only while a Misaka session exists on the account) re-reads the fresher login on Dreamscape (which Dreamscape's own CLI / `claudeUsage` keep refreshed) and pushes it
when less than an hour of the access token is left. Assumption not yet proven for a whole 8 h token life: that the CLI re-reads `.credentials.json` when it changes (it does on a 401); if one session outlives its token
the session shows "Login expired", the Supervisor's existing login failover (`loginMove`) moves or restarts it, and `end()` removes the credential file when the last session of an account ends (nothing is left standing on Misaka).
Who may read it there: user `agents` only (home mode 700, file 600); `rack`, `hvadmin` (sudo) can. The login is as exposed as any Misaka root.

## Back-channel (Misaka to Dreamscape): one forced-command key

Sessions need agent-coord (SQLite DB and sockets on Dreamscape), Yozora MCP and a git credential, all of which live on Dreamscape. A stdio MCP server is just a process whose stdin/stdout
are the session's, so it runs on Dreamscape over ssh: `ssh <gate> mcp-agent-coord AGENT_COORD_ID=... ` in the session's `mcp.json`.

* Key: `agents`'s `~/.ssh/dreamscape_gate_ed25519` on Misaka (no passphrase; mode 600, user `agents` only); host key of Dreamscape pinned in `~/.ssh/known_hosts_dreamscape` (`StrictHostKeyChecking=yes`).
* Dreamscape `~kanmi/.ssh/authorized_keys`:
  `from="192.168.100.42",restrict,command="/usr/bin/node /home/kanmi/staticforge/scripts/fleet/misaka-gate.js" ssh-ed25519 ... misaka-agents-gate`.
  `restrict` = no pty, no forwarding, no agent, no X11, no user rc; `from` = Misaka's address only; the forced command ignores what the client asked for except as input to a grammar:
  verbs `mcp-agent-coord`, `mcp-yozora`, `git-credential`, `ask-hook`, `ingest <session id>`, `ping`; arguments `KEY=VALUE` from an allow-list of ten `AGENT_COORD_*` keys (values `[A-Za-z0-9._:/@+=,-]`, 300 chars);
  no shell is ever involved (`spawn` with an argv). Everything else is refused (exit 126) and logged (verb and reason, never values) in `~/.local/state/dreamscape-agents/misaka-gate.log`.
* Tokens: the Yozora token never leaves Dreamscape. `mcp-yozora` runs `scripts/gitea-mcp.sh` there; `git-credential ident=fleet|claude` answers git's helper protocol (stdin `host=` must be `yozora.bluesteel.737.jp.net`,
  else refused) from the token file at that moment, so nothing is stored on Misaka. Identity `fleet` = `director.yozora` (the Fleet rule); `claude` only when a launch asks for it (the proof run).
* The other direction: Dreamscape reaches `agents@Misaka` with `~/.ssh/misaka_agents_ed25519` (`authorized_keys` there: `from="192.168.100.250",no-agent-forwarding,no-port-forwarding,no-X11-forwarding`),
  one multiplexed connection (`ControlPersist=120`), host key pinned on first use in `<state>/misaka_known_hosts`. That account is a plain shell user (not in docker, kvm, libvirt, sudo groups); it is the same trust domain
  as the sessions it runs: any session there can speak as another session of its own host (the id is a parameter), which is the same as any Dreamscape session reading `coord.db`.
* Not wired on purpose: the `dreamscape` MCP server (Studio, mail, memories, NovelAI): its key is the live server's and lets a session reach private data; development sessions test against their replica, which has its own.
  Adding it is one more gate verb (stdio to HTTP bridge) if Yukimi wants it.
* Cost of the compromise of `agents` on Misaka: it can run the verbs above as any session and get a Yozora token through `git-credential` (push rights for `director.yozora` / `claude` on the repos those tokens cover).
  It cannot get a shell on Dreamscape, read other files, or touch the Fold. Rotate by replacing the key pair.

agent-coord identification: `mcpServer.js` normally finds its session by walking the process tree to `~/.claude/sessions/<pid>.json`. Over ssh that tree is the gate's, so the launcher passes the identity in the
command (`AGENT_COORD_ID`, `_SESSION_ID`, `_CWD`, `_HOST`, `_REPO`, `_ROOT`, `_BRANCH`, `_TMUX`, `_ACCOUNT`, `_NAME_B64`). `host` becomes `fat-misaka`; the repo name is `staticforge`, so claims name paths in the same repo as agents
editing the live tree and conflict with them; claims lapse with the pid, which is the gate process: it ends when the ssh connection (the session) ends. A steering message to a Misaka agent is typed into its pane over ssh
(`typeIntoMisaka`). The busy lock file `.agent-<id>` is not planted (its root is not on Dreamscape; the replica is the session's own tree).

## Visibility: Fleet reads, steers, stops

* **Pushed, not polled:** the watcher `misaka-watch.js` (`fs.watch` on the session record and the transcript) pipes line JSON into `ssh <gate> ingest <id>` = `scripts/fleet/misaka-ingest.js` on Dreamscape (a small process of its own,
  not the server). It mirrors the transcript to `~/.claude/projects/<proj>/<id>.jsonl` (so `claudeTranscript`, titles, Supervisor reviews and `claude_session_read` read it like any local session) and writes
  `<state>/misaka-live/<id>.json` (record, alive, heartbeat every 20 s). A dropped stream restarts from offset 0 (idempotent). The ingest refuses sessions that the launcher did not register.
* `claudeSessions.liveSessions()` appends `misakaSessions.mirrorLive()` (alive and heard within 90 s; `host: 'fat-misaka'`, `pid: null`, `configDir` = the account's Dreamscape folder, so the account column works). The Fleet Sessions list has a Host column.
* `steer`, `interrupt`, `screen` (Show Screen text), `permissionPrompt` / `answerPermission` go through `paneFor()`, which for a Misaka session answers a tmux socket marker; `defaultRunner` turns `tmux --ssh-misaka ...` into the same tmux over ssh.
  `attachCommand` returns an `ssh -tt ... tmux attach` for Show Screen's live terminal.
* Not mirrored: a session's `subagents/` folder (the Supervisor sees no background agents of a Misaka session; it relies on the session's own turn state).

## Ending

`end(id)` (Fleet's Close = `claudeSessions.disconnect`, the Supervisor when the last work item of the session ended, a failed start, an account failover): kills `rc-<id8>` and `fleetwatch-<id8>`; commits and pushes unpushed or uncommitted work in the replica to
`wip/claude-<id8>` (the stopped-agent rule); releases the agent's claims and device leases and marks it gone; deletes the replica (unless `~/fleet/sessions/<id>/keep-replica` exists: the agent's way to ask to keep it);
releases the lease; removes the login file when no other session of that account is on Misaka; removes the session folder and the live mirror. The record stays with `ended`.

## Live-tree rules for a Misaka session

Hard rules of CLAUDE.md that exist because the tree is shared and live change their form, they do not go away: no stash tricks, claims before editing (agent-coord, same repo name), commit each turn, pushed to main on Yozora from the worktree
(`git pull --rebase origin main` first), the performance/notification checks before committing (`node scripts/check-perf-rules.js` runs in the worktree). There is no live tree to hold dirty: `agent-busy-lock` has no file, and there is **no Dreamscape restart or hot reload from Misaka**
(the brief says so: test in the replica, restart its replica server through `rack_role replicas restart`). `director-idle-before-restart` does not apply. Device rules are unchanged (`coord_device_request`; the A53 and emulators are on the lane; the Fold only for the final install step, and
install steps that need Dreamscape's adb are done by the Supervisor / lead after the push). Builds: `coord_build_request` still applies to anything that touches shared hardware or the live server.
Replica limits that matter: seed data only (no secrets, no phones, no mail), no Supervisor / Fleet / agent-coord sockets inside the replica (replica mode), HTTPS front per replica, and a changed `package.json` / `pnpm-lock.yaml` needs a new image (the worktree's `node_modules` is the image's).

## What stays on Dreamscape

Fleet itself (queue, Supervisor, reviews, notices, usage, accounts, Remote Control servers), agent-coord and memory, the live tree, the live server and its restarts, phones and their adb, Studio / mail / personal data,
the Director bridge and other engines, resumed sessions, work on any repository other than StaticForge (DSApp-Kotlin builds run on the rack through the `builds` role already), the Yozora token.

## Not done / follow-ups

* After a Dreamscape server restart the per-account access-token timer is not re-armed until the next Misaka launch; `end()` of a session still works (records are on disk), and a lease renewal only happens from that timer.
  A `rearm()` from the Supervisor's boot is the fix.
* The Fleet console shows the Host column in the Sessions list; the work item row, the Supervisor queue and the New Session dialog have no host chooser yet (the field exists: `host` on work items, `fleet_work_update`).
* `claudeSessions.js`, `claudeFleetSettings.js`, `claudeFleetMcp.js`, `314-claudeDeskHandler.js` are not hot-reloadable: the live server needs one restart before sessions run on Misaka through Fleet. Everything is inert until then
  (the launcher falls back to Dreamscape when the settings function is missing).
* Replica creation needs an existing image; refresh it with `image-build {ref:'main'}` (12 min) when `package.json` / the lockfile change, or before flipping the default.

## Proof runs

(One line per run, written by the proof session from inside its replica.)

- 2026-11-28 session d47001ea: ran on fat-misaka, folder /srv/rack/replicas/fleet-d47001ea/src, Claude Code 2.1.332 (Claude Code)
