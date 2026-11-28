# Fleet work items (the Supervisor's queue)

The contract of a work item in `modules/agentSupervisor.js` (table `supervisor_work` in the agent-coord DB).
Fleet's Work Queue, Yozora's `claude_dispatch`, agent-coord's `coord_request_work`, Plaud and pulled `fleet`
issues all create items the same way (`enqueue`). #1191 added Remote Control as a choice and several issues in one run.

## Fields (the row as `rowWork` sends it to Fleet)

| field | meaning |
| --- | --- |
| `id`, `title`, `source` (`fleet`, `plaud`, `director`, `agent`, `yozora`), `state` | `held` (Waiting), `queued`, `starting`, `running`, `waiting` (gaps sent back), `done`, `failed`, `cancelled` |
| `prompt` (cut at 2000 for lists; `workPrompt(id)` is whole), `cwd`, `account`, `model`, `effort`, `engine`, `topology`, `stages` | what to run and how |
| `startNow` | start past the slot limit and past `autoStart` off |
| `remoteControl` | the session starts in Remote Control (default **false**) |
| `issue` | `{repo, number, url}` of the PRIMARY issue (null when none yet): unchanged, everything that read it keeps working |
| `issues` | `[{repo, number, url, title?, primary}]`, primary first, then the others; `[]` when there is none. One entry for a normal item |
| `joinedInto` | the id of the item this one was merged into (the item is `cancelled`), else null |

Columns behind them: `issue_repo / issue_number / issue_id` (primary), `issue_refs` (JSON `[{repo, number, id, title}]`,
the OTHER issues, the primary is not repeated), `remote_control INTEGER NOT NULL DEFAULT 0`, `joined_into INTEGER`;
`supervisor_reviews.issues` (JSON `[{ref, done, left}]`). All added with the additive `ALTER TABLE` pattern.

## Remote Control (optional, default off)

`claudeSessionLauncher.start({ remoteControl })` adds `--remote-control <title>` only for `remoteControl === true`.
Without it the session runs in its Fleet terminal (tmux `rc-<id8>`): it is in Fleet's live list with
`remoteControl: false`, can be steered from Fleet (tmux send-keys), but is not in claude.ai/code and cannot be taken over
from the phone. `start` answers `{ state: 'running', link: '', message: 'Running (no Remote Control)' }` as soon as Claude
Code's prompt shows (footer hints / input box, or its session record); the folder-trust prompt is still accepted and
`/remote-control` is never typed. `resume` and `takeover` (bringing an existing session back) always use Remote Control.
Running sessions are never switched.

Where it is set: Fleet's New Session wizard (`claude_desk_session` `start`: `remoteControl`), the Work Queue
(`claude_desk_supervisor` `enqueue` / `work_update` / `work_merge`: `remoteControl`), `claude_dispatch` and `fleet_work_update`
(`remoteControl`), `updateWork({ remoteControl })`. `pumpWork` passes the item's value to the launcher.

## Several issues, one run

- `enqueue({ issues })`: an array of refs (`owner/repo#N`, a Yozora issue URL, `#N` for the default repo, or
  `{repo, number, id}`), or one string with several refs separated by spaces / commas; `issue` (one ref) still works.
  Deduped; the first is the primary. The item stays ONE item; each issue is linked in the background (the `fleet`
  label; title and id come back). One ref behaves as it always did. `updateWork({ issues })` replaces them (an empty
  list drops the others and keeps the primary).
- The brief the session gets (built in `pumpWork`) names every issue (ref, URL, title, body excerpt of ~1500 characters,
  fetched at start when not stored, 15 s best effort) and says the run covers them together, that it comments its progress
  on each, and that it closes only issues whose own ask is done and says what is left on the others. One issue: the text
  is the one it always was.
- Yozora comments (`syncIssue`): the lifecycle comments and the tracked time go on the primary; each other issue gets a
  start comment ("part of the Fleet run on <primary>, covering #a, #b ...") and an end comment; status labels follow on all.
- The Supervisor's turn review of a session whose item has several issues also asks for
  `"issues":[{"ref":"owner/repo#N","done":true|false,"left":"what is still open"}]` (parsed and kept in the review row).
  When the item ends:
  - `done` (verdict ok): every issue the last review marks done is closed (an issue it does not name counts as done, since
    ok means nothing missed); an issue marked not done gets a comment with what is left and stays open.
  - `failed`: nothing is closed; each issue gets a comment with what is left (from the last review).
  - an issue is never closed because the run ended; cancelling a several-issue item closes none of them.
- Pulling (`pullIssues`): an open `fleet` issue carried in `issue_refs` of an item that is not cancelled (or that was joined
  into another) does not become its own item. An item whose PRIMARY closes on Yozora ends as before; one of the others
  closing does not end it. An item created from the issue side stays one issue, one item.

## An issue the hook already carded (#1276)

`pullIssues` is the issue hook: every open `fleet` issue with no item becomes a Waiting item (`source` yozora, `sourceRef`
`issue:<repo>#<n>`). When a dispatch (`claude_dispatch`) or the New Session wizard then names that same issue, `enqueue`
does not make a second item for it. The lookup covers the hook's items only (source yozora with an `issue:` sourceRef, not
a part, not joined, not a planned run) whose PRIMARY issue is one of the named ones; items of any other source, parts
(`parentId`), `source: 'yozora'` callers and `separate: true` behave as before, and so does a hook item that is done, failed or
cancelled (a new item is made).

- **Not started** (held or queued, no session, its start not in flight): the hook's item is ADOPTED. Same id, same
  `createdAt`; every field is the caller's, as a new item would have had it (title when one is given, else the item's own;
  brief, folder, account, model, effort, engine, source, `sourceRef`, shape, Remote Control, host, git identity, Start Now,
  and Waiting or queued with its usual message). The Supervisor's maintenance check is cleared (it was about the old brief).
  Its issues become exactly the named ones, the first named is the primary. The result carries `adopted: true` and
  `joined: [ids]`. The issue gets one comment: "Fleet item N took over the dispatched brief (the issue's waiting item was
  reused, no second item was made): <brief>".
- Several issues named, several carded: the item of the first named issue that has one is adopted; every other waiting
  hook item on a named issue ends as `cancelled` with `joinedInto` the adopted item (written straight to the row, as
  `mergeWork` does: no cancel comment, no close).
- Several issues named, one carded and waiting, another whose hook item already runs: the waiting item is adopted and
  carries every named issue EXCEPT the running one, which stays with its own item (one issue, one item). The result adds
  `running: [{ ref, work }]` and a `note` naming them.
- **Already started** (starting, running, waiting, input, or queued with its start in flight) and no waiting item to adopt:
  nothing is made or changed. The result is the running item with `existing: true` and a `note` ("Work item N already runs
  <repo>#<n>: no second item was made. Steer its session instead.").
- The other order (the dispatch first) needed nothing: the hook finds the item by its primary issue, or in the
  `issue_refs` of a several-issue item, and adds none.
- An empty or too long brief throws before anything is changed. The queue pass re-reads each item when its turn comes, so
  an item adopted or folded while the pass waits on another start runs with its new brief, or not at all.
- `mergeWork` and the Supervisor's own follow-up item (`handOffGaps`) pass `separate: true`.

## Queue as one run (`mergeWork(ids, opts)`, WS `work_merge`)

`{ ids: [workIds], title?, remoteControl?, startNow? }` -> `{ work, joined: [ids] }`. Every id must be `held`, `queued`,
`failed` or `cancelled` (not already joined, not a part of a split item), at least two (else "Pick two or more ...").
Creates ONE item: title `title` or `<first title> (+N more)`; prompt = "One run covering these Fleet requests together:" then
each request's title and brief; folder / account / model / effort / engine / topology / stages from the first; issues = the
union of theirs (the first request's primary stays primary); `remoteControl` as given (default off); `startNow` default
**true** (she picked them to run) - pass false to leave it Waiting; source `fleet`. The picked items become `cancelled`
with `joinedInto` set and the message "Joined into item N (one run)", written straight to the rows: no cancel comment and
no close on Yozora. Each of their issues gets one comment: "Joined Fleet item N: one run with #a, #b ...".

## Issue picker (WS `issues_open`)

`{ repo?, q? }` -> `{ repo, repos, issues: [{ repo, number, id, title, url, labels, item }] }`: the open issues of one watched
repo (default `DreamScape/StaticForge`; the watched set is the default, `agentSupervisor.yozoraRepos` and every repo an
item uses), newest first, at most 100, `q` filters by title, `item` is the id of the held / queued / running item that
already carries the issue (primary or other), else null. One request when asked, no polling.

## WS shapes (`claude_desk_supervisor`, `claude_desk_session`)

- `enqueue`: `{ title, prompt, cwd, account, model, effort, engine, topology, stages, issue?, issues?, remoteControl?, startNow? }` -> the status object (as before; naming an issue the hook already carded reuses its item, see above)
- `work_update`: `{ id, prompt?, remoteControl?, issues? }` -> the status object
- `work_merge`: `{ ids, title?, remoteControl?, startNow? }` -> `{ work, joined }` (the list follows through the status push)
- `issues_open`: `{ repo?, q? }` -> `{ repo, repos, issues }`
- `claude_desk_session` `start`: `remoteControl` (default false) -> `{ state: 'running' | 'connected' | 'failed', link, ... }`
- MCP: `claude_dispatch` and `fleet_work_update` take `remoteControl` (boolean) and `issues` (array of ref strings).
