# Handoff: XM Radio — Recently Played queue + graceful recorder restart (Nov 22 2026)

Both pieces of work in this session are **committed and pushed** to `origin/main`. Yozora issue **#1020** carries the
notes (comments 20770, 20771, 20773, 20775).

## Objective

1. Original request: add the recently aired show to the phone's XM Radio Recently Played rows, give each row a context
   menu with exactly **Play** and **Record**, make Record one click (no prompt), and stack recordings in a queue ordered
   by buffer expiry (soonest first), then order added. Phone UI only — desktop XM Radio has no Recently Played list.
2. Follow-up request (verbatim intent):
   > "can you allow it to be restarted by captureing the singnals so that it can stop recording after the current
   > segment and store the next segment for the recorder allowing it to continue recording right where it left off.
   > its recoring queue shoudl survive aswell."

## Final behaviour

### Recently Played / queue
- `schedule().played` songs are annotated server-side with the show (`s`), show start/duration (`sa`, `sd`) and art key
  (`ik`) from liveUpdate episodes. Phone rows show `show · artist`.
- Tap-and-hold (or right-click) a row → menu with exactly **Play** and **Record**. Play jumps to the song's start;
  Record is one tap, no confirmation, and records that exact cut from the stream's five-hour buffer.
- Record **stacks** instead of starting on the spot. Order: `expiresAt` ascending (= song start + 5 h), then `addedAt`.
  The queue lives in the recorder's state file, so it survives a Dreamscape or recorder restart with no page open.
  Entries are removed when started; a channel already recording waits; a freed slot (`stop()`) triggers `pumpQueue()`.
- Recordings tab shows a **Queued** section with per-item Cancel and Clear all; the phone feed carries `queue[]`.
- New packets: `xmradio_rec_range`, `xmradio_queue_remove`, `xmradio_queue_clear`.

### Graceful signal handoff
- On SIGINT/SIGTERM the recorder stops pulling new segments, lets the segment already on the wire finish **and write to
  disk**, then stores the exact next segment in each active recording's meta (`resumeAt` = last written `pdt`,
  `resumeSeq` = next seq). Active recordings **and the queue** stay in the state file.
- The new process resumes each recording at that stored point — no half segment, no gap, no repeat. A hard stop (no
  stored point) still falls back to the last segment on disk, as before.
- `pump.stop()` is async and awaits the in-flight fetch; the service awaits the drain with a 7 s fallback under pm2's
  8 s `kill_timeout`. No new recording or queue item can start during the handoff.

## Commits / where the code lives

Local `main` has three commits whose content was cherry-picked onto clean worktrees at `origin/main` (the shared tree
is far ahead/behind and dirty, so pushing was done from worktrees). **Authoritative remote tip: `e11de428d`.**

| Local commit | Pushed as | What |
| --- | --- | --- |
| `fec4ff4c8` | `7da44f052` | Recently Played show names, row menu, range recording + queue, packets, docs, tests |
| `49e7ef9d1` | `04bc3494d` | graceful signal handoff (drain, stored next segment, queue survival) |
| `add1120c6` | `e11de428d` | log line only: say "at the stored segment" only when a handoff stored one |

### Files touched
- `modules/xmRadio.js` — show metadata on `schedule().played`; phone feed carries `items.queue`.
- `modules/xmRadioRecorder.js` — `recordRange`, queue (`queueSorted`/`queuePublic`/`queueRemove`/`queueClear`,
  `startRange`, `pumpQueue`), `shutdown()`, `resumeAt`/`resumeSeq` store + consume, `shuttingDown` guards.
- `modules/xmRadioPump.js` — `ticking` tracking; async `stop()` waits for the in-flight segment.
- `modules/xmRadioRecorderClient.js`, `services/xmradio-recorder/server.js`,
  `modules/ws/handlers/318-xmRadioHandler.js` — RPC/socket ops and the signal handler.
- `public/scripts/comp/wmXmRadio.js` — show on rows, hold menu, Record/queue actions, Queued UI.
- `docs/client-api/ws/xmradio.md` — packets, `deck.queue`, phone feed, hold-menu.
- Tests: `scripts/test-xmradio.js`, `scripts/test-xmradio-range.js`, `scripts/test-xmradio-shutdown.js`,
  `scripts/test-xmradio-pump-stop.js`.

## Verification done

- `node --check` on every touched file: OK.
- `node scripts/check-perf-rules.js`: OK (1465 files).
- `node scripts/test-xmradio.js`, `test-xmradio-range.js`, `test-xmradio-shutdown.js`,
  `test-xmradio-pump-stop.js`, `test-xmradio-media-session.js`: all OK.
- `node scripts/check-ui-standard.js`: no new XM Radio issues (five rises are in other sessions' files).
- **Live, with user approval:** `pm2 restart xmradio-recorder` twice. First loaded the new code; second exercised the
  handoff. Logs:
  ```
  [xmradio-recorder] SIGINT: finishing the current segment; recordings and queue hand over to the next start
  [xmradio-recorder] handoff: {"recordings":1,"queue":0}
  [xmRadio rec] 8dca3cd1b4a6114feecf8fac: resumed (song, 19 s to catch up, at the stored segment)
  ```
  The in-flight recording `8dca3cd1b4a6114feecf8fac` kept its id; `segs.ndjson` grew 542 → 543 (the segment on the wire
  landed); `resumeAt`/`resumeSeq` were stored for the handoff and consumed on resume; `deck` still reports the one
  recording. The old immediate-exit log (`SIGINT: saving; ...`) appears only for the restart that still ran old code.
- Agent lock `.agent-claude-xmrecent` created and removed; no lock left behind.

## Caveats / follow-ups

- The running recorder is now on `e11de428d` (pm2 `xmradio-recorder`, pid shown in `pm2 describe`). Any further code
  change to `modules/xmRadioRecorder.js` or `modules/xmRadioPump.js` needs another restart to take effect.
- Queue survival in the handoff is covered by `test-xmradio-shutdown.js`; the live queue was empty during the restart,
  so nothing was queued in production. The handoff log reports `queue` count either way.
- Native Android part (#1021 — Monitor/Cancel inside DSApp without opening Melaton) is still unapproved and untouched.
- `node scripts/check-app-scope.js` exits 1 for pre-existing `page-global` rises elsewhere, including
  `wmXmRadio.js:894 window.wmXmRadio`; none are from this feature's edits.
- Shared tree is still dirty/ahead 64/behind 122 with other agents' files and stale locks
  (`.agent-claude-dex1005`, `.agent-claude-wm732`, `.agent-claude-xm989`) — left alone. Only the explicit files above
  were staged. The untracked `scripts/test-xmradio-media-session.js` belongs to another session.
- No phone/DeX visual check was done in this session.

## Quick re-check checklist

1. Phone Recently Played: each row shows `show · artist`; hold (or right-click) a row → exactly Play and Record.
2. Tap Record: one tap, no prompt; the song appears under Recordings → Queued with a Cancel and Clear all.
3. Queue several songs, including one near its five-hour expiry: soonest expiry records first, ties by order added.
4. While a recording runs, `pm2 restart xmradio-recorder`: log shows the `finishing the current segment` handoff line,
   the recording id is unchanged, and the resume log ends with `at the stored segment`.
5. `.cache/xmradio-recorder.json` still lists the active recordings and `queue`; `resumeAt`/`resumeSeq` are gone after
   resume (consumed).
6. `node scripts/test-xmradio-shutdown.js` and `node scripts/test-xmradio-pump-stop.js` pass.
