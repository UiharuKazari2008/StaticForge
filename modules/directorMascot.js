'use strict';

// Director mascot cues (#688). The server reads each Director stream update (Wren, Kabuki, and Xi share
// queueDirectorStream) and turns new tool rows and the live thinking text into one expression/action cue
// for the mascot. Rules only, no model call: instant and free (Yukimi 2026-10-31).

const CUE_GAP_MS = 600;
const STATE_TTL_MS = 30 * 60 * 1000;
const sessions = new Map();   // sessionId -> { rows, lastCueAt, lastKey, at }

const TOOL_CUES = [
    [/^(get_session_state|get_studio_state|read_image_metadata|get_open_windows|list_|get_workspaces)/, { expression: 'focused' }],
    [/^(get_generated_image|show_chat_image|compare_images|Read|resolve_lookback|open_in_)/, { expression: 'focused', action: 'lean-in' }],
    [/^(apply_studio_changes|print_studio|generate_image|generate_preset|create_phasewalker|decompile_phasewalker|expand_image|upscale_image|animate_image)/, { expression: 'smug', action: 'nod' }],
    [/^(await_generation_job|get_generation_job)/, { expression: 'thinking' }],
    [/^request_form/, { expression: 'thinking', action: 'tilt' }],
    [/^(search_|get_wiki_page|get_character_card|get_prompt_guide|omegasearch|get_memory|count_prompt_tokens)/, { expression: 'thinking' }],
    [/^(save_memory|save_preset|save_character_db_entry|set_session_title|deliver_)/, { expression: 'happy', action: 'nod' }]
];

const WORD_CUES = [
    [/\b(perfect|great|nice|nailed|beautiful|love (it|this)|works|got it|exactly)\b/i, { expression: 'happy', action: 'bounce' }],
    [/\b(wrong|missed|mistake|broke|broken|failed|lost the|doesn'?t (match|work)|not right)\b/i, { expression: 'frustrated', action: 'slump' }],
    [/\b(wait|actually|oh no|hold on|hmm,? no)\b/i, { expression: 'surprised' }],
    [/\b(push|wider|bigger|more mass|thicker|crank)\b/i, { expression: 'smug' }],
    [/\b(hmm|let me think|maybe|i wonder|not sure|which one|should i)\b/i, { expression: 'thinking', action: 'tilt' }]
];

function toolCue(row) {
    const name = String((row && row.name) || '');
    const result = String((row && row.result) || '');
    if (/\b(error|failed|refused|denied|timed out|rate limited)\b/i.test(result.slice(0, 400))) {
        return { expression: 'frustrated', action: 'shake', holdMs: 2600 };
    }
    for (const [re, cue] of TOOL_CUES) {
        if (re.test(name)) return { ...cue, holdMs: cue.action ? 1800 : 2600 };
    }
    return null;
}

function wordCue(text) {
    const tail = String(text || '').slice(-260);
    for (const [re, cue] of WORD_CUES) {
        if (re.test(tail)) return { ...cue, holdMs: 2200 };
    }
    return null;
}

function prune(now) {
    sessions.forEach((row, id) => {
        if (now - row.at > STATE_TTL_MS) sessions.delete(id);
    });
}

/**
 * One cue for this stream update, or null. New or changed tool rows win over the live text; at most one
 * cue per CUE_GAP_MS per session, and the same cue twice in a row is dropped.
 */
function mascotCue(sessionId, data, now = Date.now()) {
    const id = String(sessionId || '');
    if (!id || !data) return null;
    prune(now);
    const state = sessions.get(id) || { rows: [], lastCueAt: 0, lastKey: '', at: now };
    state.at = now;
    sessions.set(id, state);
    const rows = Array.isArray(data.rows) ? data.rows : [];
    let cue = null;
    for (let i = rows.length - 1; i >= 0 && !cue; i--) {
        const row = rows[i];
        if (!row || row.type !== 'tool') continue;
        const sig = `${row.name}|${String(row.result || '').length}`;
        if (state.rows[i] === sig) break;    // older rows were already seen
        cue = toolCue(row);
    }
    state.rows = rows.map((row) => (row && row.type === 'tool' ? `${row.name}|${String(row.result || '').length}` : ''));
    const live = data.live || null;
    if (!cue && live && live.type === 'thinking') cue = wordCue(live.text);
    if (!cue) return null;
    const key = `${cue.expression}|${cue.action || ''}`;
    if (key === state.lastKey && now - state.lastCueAt < 4000) return null;
    if (now - state.lastCueAt < CUE_GAP_MS) return null;
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
    _test: { toolCue, wordCue }
};
