# Director mascot expression cues

Research for Wren, Kabuki, and Xi. The cue table in `modules/directorMascot.js` is updated from this pass. The Claude streaming change is a patch at the bottom and is not applied. Dreamscape was not restarted, so the running server still has the previous cues until someone restarts it.

Parent surface: Yozora #688. This write-up is #690.

## Method

Transcripts:

- Director: `~/.cache/dreamscape-director/index.json` plus `messages/dirc_*.json` (87 chats).
- Xi: `~/.cache/dreamscape-xi/index.json` (4 chats, messages inline) and `logs/*.ndjson` (the only stream with real clocks).
- Tool results live in `chats/<id>/payloads/<id>.json` (`args`, `result`, `name`). 11,195 payloads resolved, 0 missing, 0 skipped for size.

Persona: Kabuki is a chat whose `memoryStore` is `obliterated`, or whose engine is `custom:sloproxy` (`config.json` `obliteratedMemories: true`). Everyone else on Director is Wren. Xi is the four `dreamscape-xi` chats.

Engine, model, and effort come from the assistant message `model` object (`engine`, `id` / `run`, `effort`). If that object has no engine, the chat `lastEngine` is used. Older rows with neither are tagged `cursor (inferred)`: they predate the engine field and ran on cursor-agent.

Turn position is the assistant's place in the chat: start (first 20% or the only turn), end (last 20%), otherwise middle. `after_correction` is an extra tag when the user message that opened the turn matches a complaint or a redirect (wrong, missed, too wide, fix the, still off, and similar). Leading "yes" / "yep" was not treated as praise: those lines are usually "keep going".

Thinking text is split on a paragraph, sentence, or space near 200 characters. 98,202 windows.

Labels: a rubric, checked against 84 windows read by hand (`/tmp` batch, seed 688). The rubric was adjusted until those 84 agreed, including two second reads of "check whether" / "verify whether" as focused rather than thinking. Agreement on that set is 84/84. That means the stack was fit to those 84. It is not a second person labelling the other 436. The 520-row sample with a reason line each is `docs/research/director-mascot-cues-labels.jsonl`. Corpus base rates below are the same rubric on every window, text only (a tool error is not folded into that pass).

## Corpus

| | Wren | Kabuki | Xi |
| --- | ---: | ---: | ---: |
| Assistant turns | 1,110 | 194 | 40 |
| Thinking blocks | 6,165 | 883 | 1,055 |
| Thinking characters | 14,384,206 | 1,396,784 | 511,336 |
| Tool rows | 9,060 | 1,373 | 1,987 |
| Windows | 86,607 | 8,533 | 3,062 |

87 Director chats, 1,304 Director turns, 4 Xi chats. User turns that opened them: correction 98, loose praise 81, neither 1,165. The loose praise class is contaminated (a line that starts with "yes" or "yep" is usually an instruction). The eight praise lines read by hand were continuations, not "that print is good". Correction lines that were read were real redirects ("you missed how her body is attached", "wrong your taking my literal words"). Tool proposals below use her own next sentence, not that praise class.

Engines on the turns:

| Persona | Engine | Source | Turns |
| --- | --- | --- | ---: |
| Wren | cursor | inferred | 641 |
| Kabuki | custom:sloproxy | turn | 187 |
| Wren | tokenrouter | turn | 168 |
| Wren | custom:deepinfra | turn | 145 |
| Wren | cursor | turn | 103 |
| Wren | claude | turn | 47 |
| Xi | cursor | xi | 40 |
| Kabuki | custom:sloproxy | chat | 7 |
| Wren | cursor | chat | 5 |
| Wren | claude | chat | 1 |

Effort is mostly medium (Wren 538, Kabuki 186, Xi 40), then Wren high 268 and low 213. One Wren turn is `max`, four are `xhigh`.

Rubric base rate on every thinking window (text only):

| Expression | Wren | Kabuki | Xi |
| --- | ---: | ---: | ---: |
| focused | 0.664 | 0.641 | 0.876 |
| thinking | 0.259 | 0.280 | 0.093 |
| happy | 0.031 | 0.032 | 0.012 |
| surprised | 0.031 | 0.029 | 0.014 |
| frustrated | 0.012 | 0.016 | 0.004 |
| smug | 0.002 | 0.001 | 0 |
| neutral | 0.001 | 0.002 | 0 |
| sleepy | 0 | 0 | 0 |

Sleepy does not show up in working thinking. The client already falls back to sleepy after 3 minutes idle (`DIRECTOR_MASCOT_SLEEPY_MS`). Leave that as the idle face.

While she works, the default face is already focused. A focused window does not need an expression change. The visible beats are thinking, happy, surprised, frustrated, smug, plus an action (lean-in, tilt, nod) on the focused face.

## Lexicon

Isolated precision and recall are on the 84 hand-read windows. Support is small (thinking 26, focused 35, happy 10, frustrated 8, surprised 3, smug 1, neutral 1), so a precision of 1.0 on one or two hits is a hint, not a measurement. Frequency is hits per 1,000 windows in the full corpus.

Current rules, tested alone against those 84:

| Pattern | Intended | Precision | Recall | Hits | Wren /1k | Kabuki /1k | Xi /1k |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| perfect, great, nice, nailed, beautiful, love it/this, works, got it, exactly | happy | 0.67 | 0.20 | 3 | 23.5 | 24.6 | 32.3 |
| wrong, missed, mistake, broke, failed, lost the, doesn't match, not right | frustrated | 0.00 | 0.00 | 1 | 20.6 | 17.2 | 12.1 |
| wait, actually, oh no, hold on, hmm no | surprised | 0.09 | 0.33 | 11 | 118.1 | 105.8 | 70.5 |
| push, wider, bigger, more mass, thicker, crank | smug | 0.50 | 1.00 | 2 | 37.4 | 37.4 | 5.9 |
| hmm, let me think, maybe, i wonder, not sure, which one, should i | thinking | 0.81 | 0.50 | 16 | 183.6 | 160.9 | 24.5 |

`actually` is 95.7 / 1k of Wren windows and 85.3 / 1k of Kabuki. On the 84, 9 of 10 `actually` hits were not surprise ("she looks... actually similarly scaled?", "Actually, do we want"). `wait` inside "wait for the job" is the same problem. `bigger` / `wider` / `push` are usually her writing the prompt, not swagger (37 / 1k Wren and Kabuki). Those three current families put the wrong face up often.

Negation on the old happy pattern: 286 tail matches, 3 of them immediately after not / n't (1%). Rare, and still wrong when it happens (`not perfect` must not bounce). `not bad` is 5 Wren windows and 2 Kabuki windows and is happy. `not broken` / `not wrong` must not slump.

Patterns that replaced them. Same 84, still isolated (a later rule in the stack can steal the window; the stack itself matches the 84 by construction):

| Pattern | Expression | Action | Precision | Recall | Hits on 84 | Wren /1k | Kabuki /1k | Xi /1k | Notes |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| hmm | thinking | tilt | 0.88 | 0.27 | 8 | 133.1 | 72.0 | 0 | Xi never says hmm |
| maybe | thinking | tilt | 0.60 | 0.12 | 5 | 44.7 | 79.8 | 20.2 | Kabuki hedges more than Wren |
| not sure / I wonder / let me think / should I / hard to tell / wondering | thinking | tilt | 1.00 | 0.19 | 5 | 21.7 | 19.3 | 19.6 | The precise weighing bundle |
| Good, / Good. / Good! | happy | bounce | 1.00 | 0.30 | 3 | 22.8 | 25.8 | 8.2 | The useful happy beat. Negation-guarded |
| nailed / beautifully / end to end / clean read / good answer | happy | bounce | 1.00 | 0.40 | 4 | 0.5 | 0.9 | 0.7 | Rare and clean |
| not bad | happy | bounce |  |  | 0 | 0.1 | 0.2 | 0 | Kept so negation does not become silence |
| something's off | frustrated | slump | 1.00 | 0.13 | 1 | ~0 | 0.1 | 0 | One hand hit, real line |
| missed / wrong / failed / broken / doesn't match / not right | frustrated | slump | 0.00 | 0.00 | 1 | 18.3 | 13.6 | 11.8 | Alone, the one hand hit was a false "failed" / "wrong". Kept behind the negation guard and behind "Ah," / "click missed", which take the surprise cases |
| Ah, / oh no / hold on | surprised |  |  |  | 0 | 3.1 | 1.2 | 0 | Small, and it is the actual surprise wording |
| I realize | surprised |  | 1.00 | 0.33 | 1 | 0.6 | 0 | 11.1 | Xi's surprise channel |
| a bit bigger | smug | nod | 1.00 | 1.00 | 1 | 0 | 0.4 | 0 | Three Kabuki windows in the whole corpus. Xi is suppressed in code |
| let me check/look/read/apply/search/adjust/print | focused | lean-in | 0.50 | 0.06 | 4 | 22.2 | 26.3 | 13.4 | Action on the default face. Two of four hand hits were not focused |
| I'll check/look/apply/search/read | focused | lean-in | 1.00 | 0.03 | 1 | 2.4 | 0.2 | 18.0 | Xi's working phrase |

`actually`, bare `wait`, and `bigger` / `wider` / `push` are not in the new table.

Persona, from the counts rather than from a default mood:

- Wren says hmm (133 / 1k) and Good, (23 / 1k). Warm and thinking while she works. That is the current thinking rule's one good family, kept.
- Kabuki says maybe more (80 / 1k vs Wren 45) and "let's" more (50 windows per 1k vs Wren 9, from the filler pass). She is not smugger. Smug is 0.1% of her windows, same order as Wren. A default smug Kabuki would be a costume, not what these chats do. `a bit bigger` is the one size line that was swagger rather than a tag dump, and it is rare.
- Xi is focused (88% of windows). She says hmm zero times, I'll-check 18 / 1k, and I realize 11 / 1k. Sleepy while a turn is running does not appear.

The client gained a `satisfied` face on all three manifests while this was being written (Wren, Kabuki, Xi). The cue table still sends `happy` for Good, / nailed. Whether a landed print should be `satisfied` is a decision below.

## Tool and event cues

Current tool map, kept, with longer holds: look and session tools lean in (focused, 5s), apply / print / generate nod (smug, 6s), await / get_generation_job stay thinking for 8s so a short wait does not drop her to focused, search and request_form tilt (thinking), save / deliver nod (happy).

A tool error in the first 400 characters of the result (error, failed, refused, denied, timed out, rate limited) is frustrated shake, 6s, and it wins over praise in the same update.

Production was not seeing that result. `publicTraceRow` deletes `result` before `queueDirectorStream`, and the cue ran on the stripped copy. The signature is `name|result length`, so a result landing later did not even count as a new row. The unit test passed a result straight in, so it stayed green. `streamUpdate` and Xi `publish` now pass the private rows as `cueFrom` and delete that field before the broadcast. The client still does not receive the result body.

Strong words on the live thinking beat a focused, thinking, or smug tool cue in the same update. "She looked, and something's off" is frustrated, not the lean-in from `get_generated_image`. An error shake still wins over "Good,".

What the turns actually do, inside the turn (the next thinking or the reply after that tool):

| After | n | She affirms | She rejects |
| --- | ---: | ---: | ---: |
| show_chat_image, then the reply | 256 | 0.07 | 0.27 |
| await_generation_job, then the reply | 565 | 0.06 | 0.18 |
| get_generated_image, then thinking | 359 | 0.04 | 0.11 |
| await_generation_job, then thinking | 1,765 | 0.05 | 0.11 |
| Read, then the reply | 355 | 0.14 | 0.09 |
| apply_studio_changes, then thinking | 370 | 0.01 | 0.03 |

A print followed by her own "matches" / "nailed" / "Good," is happy, and the word rule already does that when the words are in the live tail. A `get_generated_image` or `show_chat_image` followed by "missed" / "wrong" / "something's off" is frustrated, and the same-update priority above is what makes the look tool stop covering it. The reply channel is still dark: word cues read live thinking only, and a lot of the reject is in the assistant reply (27% after `show_chat_image`). Scanning live assistant text is a follow-up, not in this diff, because the last 260 characters of a reply are often the next question rather than the verdict.

The tool name does not predict the next user message. The best correction rates were `count_prompt_tokens` 0.17 (n=48) and `search_wiki` 0.17 (n=24) against a base of about 0.07. That is too weak to hang a face on. Praise-after-tool was not used: the praise regex was matching "yes, continue".

## Pacing

Director message timestamps are not the turn clock. User timestamp to assistant timestamp has median 4.78s (p90 5.4s, max 211s) and does not grow with the trace. A turn with 305,019 thinking characters and 142 tools was 4.7s on that clock. Those stamps are written when the messages are saved.

The real clock is the four Xi ndjson logs (`timestamp_ms` on cursor-agent events): 371s, 178s, 236s, 911s. Thinking characters over that wall time are 31 to 40 per second, about 35 in the replay below. Tool time inside those logs is short (Shell median 0.72s, Read 0.04s, Grep 0.03s, Edit 0.21s, MCP 1.89s, n=246). A NovelAI wait is not in these logs. A second replay adds 20s for each generation tool as a sensitivity check, and that 20s is an assumption.

Current rules (600ms gap, 4s same-cue suppress, holds 1.8 to 2.6s), replayed on that clock. "Partial" means cursor, including inferred cursor and Xi: the live tail grows. "Block" means claude, tokenrouter, and the custom providers: one look at the last 260 characters when the thinking block finishes. The server only emits about every 250ms (`runAgentTurn`); the cue gap is what the face sees.

| Replay | Turns | Minutes | Cues / min, median | Gap p10 / p50 / p90 (s) | Visible hold, median (s) | Focused share | Flicker (gaps under 1.5s) |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| Xi logs, real clock, current rules | 4 | 28.3 | 2.11 | 4.0 / 12.5 / 51 | 1.8 | 0.98 | 0.008 |
| Director cursor, 35 chars/s | 787 | 1,736 | 5.48 | 1.1 / 4.0 / 29 | 2.2 | 0.88 | 0.16 |
| Wren cursor, known engine only | 108 | 110 | 8.94 | 0.8 / 4.0 / 15 | 2.2 | 0.83 | 0.29 |
| Director claude-family, whole block | 548 | 6,258 | 0.79 | 0.8 / 35.9 / 232 | 1.8 | 0.99 | 0.20 |
| Kabuki (all whole-block) | 193 | 674 | 1.66 | 0.8 / 23.0 / 79 | 1.8 | 0.97 | 0.20 |
| Same cursor replay, plus 20s gen waits | 787 | 2,110 | 4.34 | 2.1 / 6.3 / 29 | 2.2 | 0.89 | 0.07 |

Cursor partials already change often, and the fast end flickers: Wren's known cursor turns have a 0.8s 10th-percentile gap and the face is cut off at the 2.2s hold, so she flashes back to focused. Claude, tokenrouter, and SloProxy (all of Kabuki) sit on focused for a median 23 to 36 seconds, because the word rule only sees the last 260 characters of a finished block.

Of 8,103 thinking blocks, 2,255 match a current word rule in that tail (28%). 4,100 match somewhere in the block. 1,845 match only outside the tail: 45% of blocks that have a word hit hide it from the cue.

What the module does now, aimed at a visible change every 3 to 8 seconds without a face flash:

- New expression or action: at most every 3.5s (`CUE_GAP_MS`).
- Same expression+action: quiet for 7s (`SAME_KEY_MS`), then the action plays again.
- Holds are longer than that quiet period, so the face stays up between pulses: surprised 4.5s, focused lean-in 5s, smug and frustrated 6s, happy 6.5s, thinking from hmm / maybe 7s, await_generation 8s.
- The first cue of a session is not charged against the gap. `lastCueAt` starts at 0, and a 3.5s gap would otherwise swallow a cue at t=1s. The old 600ms gap happened to allow the tests' t=1000.

A steady "Hmm" keeps the thinking face and tilts about every 7 seconds. A real change of mood can show at 3.5s. Whole-block engines still only get a word cue when the block ends, plus tool cues along the way. The 3 to 8 second target on those engines needs the streaming patch.

## Streaming

Which engines stream partial thinking today:

- Cursor (`runCursorTurn`) passes `--stream-partial-output`. `consumeStreamLine` appends `thinking` deltas onto `state.live`. Wren cursor, inferred cursor, and Xi's cursor path do this.
- Claude, tokenrouter, and custom providers all go through `runClaudeTurn`: `claude -p --output-format stream-json --verbose`, no `--include-partial-messages`. `consumeClaudeStreamLine` pushes a thinking row only when the whole assistant message arrives. Kabuki (SloProxy), tokenrouter, DeepInfra, and the Claude subscription are in this bucket. TokenRouter's bridge already emits `thinking_delta` toward the CLI (`modules/tokenRouterBridge.js`); the CLI does not surface those deltas without the flag.

CLI on this machine: Claude Code 2.1.316 (`/home/kanmi/.local/bin/claude`). The flag is in `--help`. Checked with real runs, empty MCP config, `--no-session-persistence`, budget caps:

- Sonnet, no thinking: `stream_event` / `content_block_delta` / `text_delta` arrived live (chunks of about 5 to 10 characters). The full `assistant` message still arrived, and it arrived before `content_block_stop`.
- Opus, `--effort high`, flag on, no `--thinking-display`: one `thinking_delta` with an empty `thinking` string and `estimated_tokens` set. The assistant snapshot's thinking field was also empty (`thinkingTokens` 13). Turning the flag on by itself would drop the thinking text the chat stores today.
- Opus, `--thinking enabled --thinking-display summarized`: `thinking_delta` chunks of 1 to 32 characters carried the prose, then `signature_delta`, then an assistant message whose thinking text was 547 characters, then `text_delta`, then the assistant text (227 characters). `thinkingTokens` 183.

`--thinking-display` choices are `summarized`, `omitted`, `highlights`. There is no full-text choice. `summarized` is the one that streamed readable thinking. `signature_delta` is not text.

### Patch, not applied

Smallest change that feeds deltas into the live row and still accepts a whole assistant message. Do this in `consumeClaudeStreamLine` in `modules/cursorDirector.js`. Xi's copy in `modules/xiDirector.js` does not even keep thinking blocks today; it needs the same `stream_event` branch or Xi-on-Claude stays dark. Do not share the function in this patch: a move belongs in its own change (`no-retype-on-move`).

`runClaudeTurn` args, next to `--verbose`:

```javascript
'--include-partial-messages',
'--thinking-display', 'summarized',
```

Both flags. The display flag is what kept thinking text on 2.1.316.

Inside `consumeClaudeStreamLine`, before the `assistant` branch:

```javascript
if (evt.type === 'stream_event') {
    const inner = evt.event || {};
    const delta = inner.delta || {};
    const block = inner.content_block || {};
    if (inner.type === 'content_block_start' && block.type === 'thinking') openLiveRow(state, 'thinking');
    else if (inner.type === 'content_block_start' && block.type === 'text') openLiveRow(state, 'assistant');
    else if (inner.type === 'content_block_delta' && delta.type === 'thinking_delta' && delta.thinking) {
        openLiveRow(state, 'thinking');
        state.live.text += delta.thinking;
    } else if (inner.type === 'content_block_delta' && delta.type === 'text_delta' && delta.text) {
        openLiveRow(state, 'assistant');
        state.live.text += delta.text;
        state.text = state.live.text;
    }
    // signature_delta, message_start, message_stop: ignore
    return;
}

function settleClaudeBlock(state, type, text) {
    if (state.live && state.live.type === type) {
        if (text && text.length >= (state.live.text || '').length) state.live.text = text;
        if (type === 'assistant') state.text = state.live.text || state.text;
        closeLiveRow(state);
        return;
    }
    if (!text) return;
    closeLiveRow(state);
    state.rows.push(type === 'thinking' ? { type: 'thinking', text } : { type: 'assistant', text });
    if (type === 'assistant') state.text = text;
}
```

Use `settleClaudeBlock` for thinking and for assistant text instead of `closeLiveRow` plus `rows.push`. Tool rows stay matched by `tool_use_id` exactly as they are now. A whole message with no deltas (the flag off) still has no live row, so `settleClaudeBlock` pushes one row, which is the current behavior.

Test plan, no server restart:

1. Extend `scripts/test-director-stream-reply.js`. Feed `content_block_start` thinking, two `thinking_delta`s, then an assistant message whose thinking text is the sum. Expect one thinking row, that full text, `state.live` null.
2. Same for `text_delta`, then the assistant text snapshot. `state.text` equals the snapshot once. A shorter delta after the snapshot must not append (the probe did not do this; still assert it).
3. `signature_delta` does not change `state.live.text`.
4. An assistant message with empty thinking, after deltas that had text, keeps the delta text (the no-display probe).
5. An assistant message with thinking and no prior deltas still pushes one row (flag off, existing tests).
6. A `tool_use` with `id` plus a later `user` / `tool_result` still fills that row. Existing assertions in `scripts/test-director-stream-reply.js` and `scripts/test-xi-claude-stream-parser.js` stay green.
7. Only after those pass, one manual `claude -p` with both flags and a one-line prompt, and confirm the trace's live thinking grows before the block closes. Do not point it at Dreamscape.

## What is in the tree

- `modules/directorMascot.js`: the lexicon, the gap and holds, persona (`xi` skips size-smug), strong words beating a look/apply cue, error shake still first.
- `modules/cursorDirector.js` and `modules/xiDirector.js`: `cueFrom` so the cue sees `result`, deleted before the socket payload. Director turns pass `prepared.persona` from `chatPersona`.
- `scripts/test-director-mascot.js`: the new cases are lines from these sessions (GPU screencast, something's off, click missed, a bit bigger, not perfect, not broken, actually similarly scaled).
- `docs/research/director-mascot-cues-labels.jsonl`: 520 windows, expression plus reason.

Not done (Oct 31): the streaming flags, scanning assistant replies, mapping Good, onto the new `satisfied` face. Done Nov 6 (#705), below.

## Decisions for Yukimi

1. Restart Dreamscape so the new cues go live, or leave them until the next restart you choose. This pass did not restart it.
2. Gap 3.5s, same face quiet for 7s, holds 4.5 to 8s. That is the 3 to 8 second target. Say if you want the pulse slower.
3. Kabuki is not smug in these chats (0.1% of windows). She hedges (`maybe`) and says "let's" more. The table does not force a smug default. Say if you still want one.
4. Xi stays focused while she works. Sleepy stays the 3-minute idle face. Say if a long Xi turn should look tired anyway.
5. All three manifests now have a `satisfied` face. The cue table still sends `happy` for a landed print. Say if that face should be `satisfied`.
6. Ship `--include-partial-messages` together with `--thinking-display summarized`, using the patch above. The flag alone emptied thinking text on this CLI.

## Review, Nov 6 2026 (#705)

Corpus: 558 Wren turns from the last three weeks. 557 ran on Claude CLI engines (sloproxy 269, deepinfra 144, tokenrouter 96, claude 47), 1 on Cursor. So the word reader, which only read `live` thinking, never fired: no Claude CLI turn had a live row. Her face came from tool names alone (focused, thinking, smug), and frustrated only from a tool error.

Replay (`/tmp` script: one row every 4 s, blocks whole, the same 558 turns through the old and new reader):

| | cues/min | happy | frustrated | surprised | smug | thinking | focused |
|---|---|---|---|---|---|---|---|
| before | 7.0 | 211 | 0 | 0 | 1303 | 1585 | 1238 |
| after | 10.7 | 872 | 363 | 57 | 1305 | 2497 | 1501 |

That is before live streaming: with deltas the live row adds more.

What changed:

- `runClaudeTurn` passes `--include-partial-messages --thinking-display summarized`. `consumeClaudeStreamLine` grows a `_partial` live row from `thinking_delta` / `text_delta`; the whole block replaces it (the longer text wins, so an empty snapshot keeps the deltas). Probed on CLI 2.1.319: Opus high effort streamed 12 thinking deltas, parser saved one thinking row and one reply row.
- `mascotCue` reads every unseen row: tools as before, finished thinking and reply rows through `textCue` (latest strong mood in the block wins), live thinking and live reply, and `finish_turn` through `reportCue` (hit ratio >= 0.85 happy, >= 0.6 satisfied, >= 0.35 thinking, else frustrated). The report skips the cue gap.
- Client: a mood the current face set lacks ends Yumiya's mask gesture; otherwise a nearest-face fallback (satisfied -> happy, frustrated -> thinking, ...).
- Growth from report cards (`behaviour.growth`), not working time: hit 1, partial 0.5, miss -0.5, rescores win, total never below 0. Yumiya and Yozora: bigger at 3. Chiyo: bigger at 3, bigger2 at 8. The stage moves after a completed turn, once the celebrate pose ends; opening a chat sets it quietly. Timed `advance` rules and the idle reset are gone from the manifests.
- Prints fly from their thumbnail in the prints strip (fixed layer, the strip is outside her clipped stage) into the belly point. Belly points now sit on each stomach's centre.

Still open: Xi's Claude parser (`modules/xiDirector.js`) has no `stream_event` branch, so Xi on Claude stays without live thinking.

### Growth rework (Nov 6, later)

Per-item points let one long all-hit card (9 items = 9 points) jump straight to the top stage. Now each report card is one result: its hit ratio (hit 1, partial 0.5, miss 0; the user's rescore wins) earns +2 (90% or better), +1 (70% or better), 0 (50% or better), or costs -1 (25% or better) or -2. The total never drops below 0. Thresholds: Yumiya and Yozora grow at 20; Chiyo at 20 and 50 (raised from 6 and 14 the same day). That takes at least ten excellent turns for the first stage, and missed goals shrink her back. The Yunotaur chat went from 17 points (max size) to 3.

### Eaten prints, the thought cloud on her head, in-between sizes (Nov 11, #742)

- A finished print no longer fades into the belly point. It flies from the prints strip to her mouth (`faceSets.<set>.mouthAt`, the middle of the talk-mouth box), she opens her mouth as it comes close (new `eat` expression), it goes in edge first, she chews three times (`eat` against `lick` / `satisfied`, with a nod), and only then the stage's `printed` body, the bounce and the jiggle play. While a print is on its way (`stageState.eatUntil`) the mask, rub and celebrate poses are dropped: she eats with her own mouth. Chiyo also has a `lick` face.
- The thought cloud lives in a `.dm-vn-layer.dm-head-layer` inside `.dm-head`, placed from `manifest.face` (`placeThink`), so the head's sway and every rig action move it on the compositor. No per-frame script follows the head.
- In-between sizes: `behaviour.growth.steps[stage] = [{ at, suffix }]`. Each stage's bodies exist again as `<body>_g1` / `<body>_g2` (belly a little larger), reached a third and two thirds of the way to the next stage (12 and 24 points past the last one). `currentBodyId` adds the suffix when the pose has that frame, so kicks, rubs, the mask and the wings keep her size. `growthState()` still reports only the stage: the turn prompt does not hear the in-between size.
- Stage changes morph through `transitions["a>b"].frames`: the old stage's `_g1`, `_g2`, then the new stage's arrival frames `_p2`, `_p1` (belly a little smaller), 300 ms apart with overlapping crossfades; shrinking plays them backwards, and frames she already stands on are skipped. Every frame is decoded before the first crossfade (`preloadBodies`), and only the current stage's sheets are fetched up front.
- Yumiya has three stages: `stuffed` (at 50) is the set's `bigger_vore` sprites, with their mask and wings variants composed from the sources.
- All of these layers come from `scripts/director-mascot-build.js` (`faces`, `stuffed`, `grow`, `preview <dir>`): faces are cut from the sprite sets with the neutral face's feathered alpha, growth frames are a belly warp of the shipped body sheets (a scale about a fixed point that fades out at a radius and above the shoulders, so the separate head layer never moves). No generated frames. Rerun `grow` after changing a body sheet; the warp settings per stage are the `GROW` table.

### Shader body: continuous growth, pose morphs, lumps (Nov 11, #742 follow-up)

Yukimi: growth more progressive, real morphing without display glitches, a lumpy belly for Yumiya's lower stage after she eats (and the kick for the others), wings and pose changes that morph instead of crossfading or cutting.

- `DirectorMascotGL` (in `directorMascot.js`) draws the body sheet on a WebGL canvas (`.dm-gl-slot`) instead of the `<img>`. It draws only while something moves. No WebGL, a lost context, a sheet that will not load, or reduced motion: the `<img>` layers and the pre-warped `_g1` / `_g2` sheets take over (`glOn()` is false and `sized()` adds the step suffix again).
- Growth is continuous: `growGain()` maps the chat's points to the stage's warp amount (1 at the threshold, `stage.grow.max` just before the next one). After a completed turn she swells to the new amount over 1.8 s.
- Pose changes (wings, mask, kick, rub, the after-print belly): both sheets are drawn; where they are the same picture nothing moves, and what differs grows out of / shrinks into `manifest.morphs["body|pose"]` (the middle of the difference; wings use her back) while it blends linearly. The head and a changed face set fade old-over-new (`fadeSwap`).
- Stage changes (`glAdvance`): she swells past the stage's edge, the next sheet arrives with its belly deflated to about the same size (`stage.arrive`: the disc `c` / `R` scales about `f`, where the belly meets her body, from `from` to 1) and inflates; the blend is the first 520 ms, the rest happens on one solid sheet. Shrinking deflates first, then blends down. The fading ring of a warp must be wider than its largest move or the picture folds (a tear at the far edge of the belly); the test checks this for every `arrive`.
- After a print (`digest()`): the stage's `printed` body where the set has one (Yumiya bigger), else a 2.8 s kick where the stage has a kicky pose (Yozora base, Chiyo bigger), else lumps: three lit bulges that drift over `stage.belly` for 6.5 s (Yumiya base and stuffed, Chiyo base and bigger2, Yozora bigger).
- `scripts/director-mascot-build.js meta` writes `stages.*.grow`, `stages.*.belly`, `stages.*.arrive` and `morphs` into the manifests (seconds; no sheets).
- Phone: the Director app re-hosts the window after it opens, and the mascot had already decided she was not hosted, so the chat sat in the log view until Show Mascot was toggled. `tick()` now notices hosted-but-not-shown and applies her view (and the reply box) again.

### Persona block: state first, self-knowledge, bonding, one-on-one talk (Nov 11, #742 follow-up 2)

Yukimi: every message should carry their current state (stage, point progress), they should know who they are, what they look like, what they will look like and why they want that, and each should bond with the user like a dating sim, including noticing when the user is only talking to them.

- `modules/directorPersonaVoice.js` `personaVoiceLines(persona, mascot, { talk, coding })` is the block, on every turn of all three personas: Yumiya and Chiyo through `cursorDirector.buildPrompt`, Yozora through `xiDirector.buildPrompt` (`coding: true`: no picture contract, the work rules stay in charge).
- Line 1 is `[Your state] <name> - stage N of M ("id") - P points - next stage at X (Y to go, Z% of the way through this stage ...)` from the mascot state the client sends on the send (`mascot { stage, points, nextAt }`); without it, stage 1 and "points not reported".
- Then per persona: `self` (who she is and her body as the mascot draws it), `looks[stage]`, the next stage's look ("not yet yours"), `want` (why she wants to grow: it is earned from the user's report cards), the stage direction, `bond` (how she grows close to the user; in a work turn it is one line at most), and the talk rule.
- Talk: she is told every turn that a message with no picture, prompt or code ask is time alone with the user: no prints, no Studio, no report card (so talk never moves points), a few sentences as herself, a question back, and `suggestions` written as the user's possible replies. `turnTalkHint(text, files)` adds "this message reads like them just talking" for greetings and personal lines (never for a prompt, a command or an attachment); it is only a hint, she judges.
- The stage order and thresholds in `PERSONA_VOICES` must match the manifests (`points`, `order`); the test compares them.
- Yozora's chats do not end with `finish_turn`, so they earn no points today: her state line will read 0 points until Xi turns get report cards.

### Yozora's points, model availability, Chiyo's memory stores, phone status box (Nov 11, #742 follow-up 3)

- Yozora's points are her work (`directorMascotWorkPoints`, client): per finished turn, 1 when it changed files or took real digging (8 or more tool calls), 2 when it also corrected a bug (the ask or her reply says so), verified its change (a test / check / lint command) or made five or more edits. Talk earns nothing; nothing is taken away. Her prompt says so (`PERSONA_VOICES.xi.want` / `pointsFrom`).
- Director Settings has two new pages on the desktop sheet and two tabs on the phone (Settings > Director): Model Availability (personas across, engines down) and Chiyo Memories (per engine: Obliterated, Studio, Primary). Server: `director.availability`, `director.kabukiMemory` (see `docs/client-api/ws/director.md`).
- Phone (wmShell.js): connection status toasts (Connecting, Connected, Connection Error / Warning, reconnecting, server ...) and every toast raised during a workspace switch show in the status box (caption Connection / Please Wait), which has no close button and closes by itself; they never become notifications, so they make no sound. During the first 20 s after boot the connection toast keeps the wait cursor only, as before.
