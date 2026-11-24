'use strict';

/**
 * Today's Recordings item (#1144): the newest Plaud recordings, one recording's AI summary, and a button that has
 * Yozora (Xi) read it and plan the work. The page never reads Plaud itself (only the Xi key may, #1075): these
 * run on the server, behind admin-only packets (ws/handlers/320-plaudTodayHandler.js).
 *
 * The button goes through startDirectorSession (#1068) with source plaud:<id>, so a second press on the same
 * recording is deduped there (sourceLocks + the chat that took the source) and only returns the running chat.
 * What came out (status, Yozora issue numbers from her replies) is read back with getDirectorSession.
 */

const plaud = require('./plaudClient');

const LIST_LIMIT = 8;
const SUMMARY_MAX = 1200;
const PERSONA = 'xi';

function directorStart() { return require('./directorStart'); }

/** The Xi chat that took this recording, from its tagged sources: no Plaud call, no start. */
function sessionFor(source) {
    try {
        const backend = require('./xiDirector');
        const chats = typeof backend.listChatBriefs === 'function' ? backend.listChatBriefs() : [];
        const chat = chats.find((c) => Array.isArray(c.sources) && c.sources.includes(source));
        if (!chat) return null;
        const info = directorStart().getDirectorSession(null, { sessionId: chat.id });
        return { sessionId: chat.id, status: info.status, issues: info.issues || [], updatedAt: info.updatedAt || null, engine: chat.runtime || null };
    } catch (_) { return null; }
}

function withReview(rec) {
    const source = `plaud:${rec.id}`;
    return Object.assign({}, rec, { source, review: sessionFor(source) });
}

/** The newest recordings with the review state of each. battery is null: Plaud's developer API does not report it. */
async function list() {
    const r = await plaud.listRecordings({ limit: LIST_LIMIT });
    const st = await plaud.status();
    const recordings = (r.recordings || []).slice(0, LIST_LIMIT).map(withReview);
    return {
        linked: !!st.linked,
        recordings,
        battery: null,
        waiting: recordings.filter((x) => !x.review).length,
        reviewing: recordings.filter((x) => x.review && x.review.status === 'running').length
    };
}

/** One recording's summary: the first AI note, cut. */
async function summary(id) {
    const rec = await plaud.getRecording(id);
    const note = (rec.notes || []).find((n) => n.markdown && !/^\(not readable/.test(n.markdown)) || null;
    const text = note ? String(note.markdown).slice(0, SUMMARY_MAX) : '';
    return { id: rec.id, name: rec.name, summary: text, title: note ? note.title : '', review: sessionFor(rec.source) };
}

/** Start (or find) the Yozora review of one recording. */
async function review(gr, id) {
    const rec = await plaud.getRecording(id);
    const when = rec.startAt || rec.createdAt || '';
    const prompt = [
        `Plaud recording "${rec.name || rec.id}"${when ? ` (${when})` : ''}, source ${rec.source}.`,
        'Read its AI notes (plaud_get_recording) and its full transcript (plaud_get_transcript), then plan the work on Yozora as the task describes.',
        rec.notes && rec.notes[0] ? `\nAI notes (cut):\n${String(rec.notes[0].markdown).slice(0, 3000)}` : ''
    ].join('\n');
    const out = await directorStart().startDirectorSession(gr, {
        persona: PERSONA, task: 'review', source: rec.source, prompt, title: `Plaud: ${rec.name || rec.id}`.slice(0, 80)
    });
    return { sessionId: out.sessionId, started: out.started !== false, deduped: !!out.deduped, review: sessionFor(rec.source) };
}

module.exports = { list, summary, review, sessionFor };
