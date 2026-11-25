'use strict';

/**
 * Standing orders go into a Director chat's CLI session once, not into every turn (cost, Nov 25 2026).
 *
 * The turn prompt is stored in the CLI session's history, and every model step re-sends that whole history.
 * A Yozora turn opened with ~17 KB of identity, fleet rules and persona voice and a Wren/Yumiya turn with ~9 KB
 * of voice, so a chat of 11 turns carried ~190 KB (~47k tokens) of the same text, re-read on every step of every
 * later turn ("every single message is the entire prompt again"). The first turn of a session still gets the
 * full block; later turns get only what changes (her state line, her look, the user's request) and a pointer.
 * The full block is sent again when the session is new (restart, engine switch, handoff, replay), when her
 * growth stage changed, and every FULL_EVERY turns (a compacted CLI session may have dropped the first message).
 */

const FULL_EVERY = 12;

const STANDING_POINTER = 'Standing orders, identity and voice: unchanged, as in this session\'s first turn and the rules above.';

/**
 * True when this turn carries the full standing block. Records the decision on the chat
 * (chat.standingSent = { key, stage, turns }); the caller saves the chat as it already does for the turn.
 * key: what identifies the model's session (engine + session id); anything that starts a new session changes it.
 */
function standingFull(chat, key, stage, force) {
    if (!chat || typeof chat !== 'object') return true;
    const seen = chat.standingSent;
    const same = seen && seen.key === key && seen.stage === (stage || '') && Number.isFinite(seen.turns) && seen.turns < FULL_EVERY;
    if (same && !force) {
        chat.standingSent = { key, stage: stage || '', turns: seen.turns + 1 };
        return false;
    }
    chat.standingSent = { key, stage: stage || '', turns: 1 };
    return true;
}

module.exports = { standingFull, STANDING_POINTER, FULL_EVERY };
