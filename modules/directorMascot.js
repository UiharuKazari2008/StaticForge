'use strict';

// Director mascot cues (#688, research in docs/research/director-mascot-cues.md).
// The server reads each Director stream update (Wren, Kabuki, and Xi share queueDirectorStream) and turns
// new tool rows and the live thinking text into one expression/action cue. Rules only, no model call.
//
// A new expression can land every CUE_GAP_MS. The same expression+action is not re-fired inside
// SAME_KEY_MS, and holdMs is longer than that, so a steady mood stays up and the action pulses
// instead of falling back to focused for a flash. Pass data.persona ('wren' | 'kabuki' | 'xi').

const CUE_GAP_MS = 3500;
const SAME_KEY_MS = 7000;
const STATE_TTL_MS = 30 * 60 * 1000;
const sessions = new Map();   // sessionId -> { rows, lastCueAt, lastKey, at }

const NEG_BEFORE = /\b(?:not|never|no|isn'?t|wasn'?t|aren'?t|don'?t|doesn'?t|didn'?t)\b\W{0,16}$/i;

const TOOL_CUES = [
    [/^(get_session_state|get_studio_state|read_image_metadata|get_open_windows|list_|get_workspaces)/, { expression: 'focused', action: 'lean-in', holdMs: 5000 }],
    [/^(get_generated_image|show_chat_image|compare_images|Read|resolve_lookback|open_in_)/, { expression: 'focused', action: 'lean-in', holdMs: 5000 }],
    [/^(apply_studio_changes|print_studio|generate_image|generate_preset|create_phasewalker|decompile_phasewalker|expand_image|upscale_image|animate_image)/, { expression: 'smug', action: 'nod', holdMs: 6000 }],
    [/^(await_generation_job|get_generation_job)/, { expression: 'thinking', holdMs: 8000 }],
    [/^request_form/, { expression: 'thinking', action: 'tilt', holdMs: 6000 }],
    [/^(search_|get_wiki_page|get_character_card|get_prompt_guide|omegasearch|get_memory|count_prompt_tokens)/, { expression: 'thinking', action: 'tilt', holdMs: 6000 }],
    [/^(save_memory|save_preset|save_character_db_entry|set_session_title|deliver_)/, { expression: 'happy', action: 'nod', holdMs: 6500 }]
];

// First match wins. Evaluation words come before fillers. "actually" and bare "wait" / "bigger" are
// not cues: on the hand-read windows they were almost never surprise or smug.
// guard=true skips a match sitting right after not / never / n't ("not perfect", "not broken").
const WORD_CUES = [
    [/\bnot bad\b/i, { expression: 'happy', action: 'bounce', holdMs: 6500 }],
    [/\b(ah,|oh no|hold on)\b/i, { expression: 'surprised', holdMs: 4500 }],
    [/\bi realize\b/i, { expression: 'surprised', holdMs: 4500 }],
    [/\b(?:my earlier click missed|click missed)\b/i, { expression: 'surprised', holdMs: 4500 }],
    [/(?:^|[.!\n]\s*)good[,!.]/i, { expression: 'happy', action: 'bounce', holdMs: 6500 }, true],
    [/\b(?:nailed|beautifully|end to end|clean read|good answer)\b/i, { expression: 'happy', action: 'bounce', holdMs: 6500 }, true],
    [/\bsomething'?s off\b/i, { expression: 'frustrated', action: 'slump', holdMs: 6000 }],
    [/\b(?:doesn'?t match|not right)\b/i, { expression: 'frustrated', action: 'slump', holdMs: 6000 }, true],
    [/\b(?:missed|wrong|failed|broken)\b/i, { expression: 'frustrated', action: 'slump', holdMs: 6000 }, true],
    [/\ba bit bigger\b/i, { expression: 'smug', action: 'nod', holdMs: 6000 }, true],
    [/\bhmm+\b/i, { expression: 'thinking', action: 'tilt', holdMs: 7000 }],
    [/\bmaybe\b/i, { expression: 'thinking', action: 'tilt', holdMs: 7000 }],
    [/\b(?:not sure|i wonder|let me think|should i|hard to tell|wondering)\b/i, { expression: 'thinking', action: 'tilt', holdMs: 7000 }],
    [/\blet me (?:check|look|read|apply|search|adjust|print)\b/i, { expression: 'focused', action: 'lean-in', holdMs: 5000 }],
    [/\bi'?ll (?:check|look|apply|search|read)\b/i, { expression: 'focused', action: 'lean-in', holdMs: 5000 }]
];

function negated(text, index) {
    return NEG_BEFORE.test(String(text || '').slice(0, index));
}

function toolCue(row) {
    const name = String((row && row.name) || '');
    const result = String((row && row.result) || '');
    if (/\b(error|failed|refused|denied|timed out|rate limited)\b/i.test(result.slice(0, 400))) {
        return { expression: 'frustrated', action: 'shake', holdMs: 6000 };
    }
    for (const [re, cue] of TOOL_CUES) {
        if (re.test(name)) return { ...cue };
    }
    return null;
}

function wordCue(text, persona) {
    const tail = String(text || '').slice(-260);
    const who = persona === 'xi' || persona === 'kabuki' || persona === 'wren' ? persona : '';
    for (const [re, cue, guard] of WORD_CUES) {
        const match = re.exec(tail);
        if (!match) continue;
        if (guard && negated(tail, match.index)) continue;
        // Xi does not swagger about size. Her working face is focused; smug from "a bit bigger" is Kabuki and Wren.
        if (who === 'xi' && cue.expression === 'smug') continue;
        return { ...cue };
    }
    return null;
}

function strongWord(cue) {
    if (!cue) return false;
    return cue.expression === 'frustrated' || cue.expression === 'surprised' || cue.expression === 'happy' || cue.expression === 'smug';
}

function prune(now) {
    sessions.forEach((row, id) => {
        if (now - row.at > STATE_TTL_MS) sessions.delete(id);
    });
}

/**
 * One cue for this stream update, or null. A tool error wins. A strong word on the live thinking
 * (frustrated, surprised, happy, smug) beats a focused, thinking, or smug tool cue in the same update,
 * so "she looked, and it's off" is not stuck on the look. At most one emitted cue per CUE_GAP_MS,
 * and the same expression+action is quiet for SAME_KEY_MS.
 */
function mascotCue(sessionId, data, now = Date.now()) {
    const id = String(sessionId || '');
    if (!id || !data) return null;
    prune(now);
    const state = sessions.get(id) || { rows: [], lastCueAt: 0, lastKey: '', at: now };
    state.at = now;
    sessions.set(id, state);
    const rows = Array.isArray(data.rows) ? data.rows : [];
    let tool = null;
    for (let i = rows.length - 1; i >= 0 && !tool; i--) {
        const row = rows[i];
        if (!row || row.type !== 'tool') continue;
        const sig = `${row.name}|${String(row.result || '').length}`;
        if (state.rows[i] === sig) break;    // older rows were already seen
        tool = toolCue(row);
    }
    state.rows = rows.map((row) => (row && row.type === 'tool' ? `${row.name}|${String(row.result || '').length}` : ''));
    const live = data.live || null;
    const word = live && live.type === 'thinking' ? wordCue(live.text, data.persona) : null;
    let cue = null;
    if (tool && tool.action === 'shake') cue = tool;
    else if (strongWord(word) && (!tool || tool.expression === 'focused' || tool.expression === 'thinking' || tool.expression === 'smug')) cue = word;
    else cue = tool || word;
    if (!cue) return null;
    const key = `${cue.expression}|${cue.action || ''}`;
    if (state.lastCueAt) {
        if (key === state.lastKey && now - state.lastCueAt < SAME_KEY_MS) return null;
        if (now - state.lastCueAt < CUE_GAP_MS) return null;
    }
    state.lastCueAt = now;
    state.lastKey = key;
    return cue;
}

function forgetSession(sessionId) {
    sessions.delete(String(sessionId || ''));
}

function resetMascotCues() {
    sessions.clear();
}

module.exports = {
    mascotCue,
    forgetSession,
    resetMascotCues,
    _test: { toolCue, wordCue, CUE_GAP_MS, SAME_KEY_MS }
};
