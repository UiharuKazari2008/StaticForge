'use strict';

/**
 * Today's Recordings item (#1144): the newest Plaud recordings, one recording's AI summary, and a button that has
 * Yozora (Xi) read it and plan the work. The page never reads Plaud itself (only the Xi key may, #1075): these
 * run on the server, behind admin-only packets (ws/handlers/320-plaudTodayHandler.js).
 *
 * The button goes through startDirectorSession (#1068) with source plaud:<id>, so a second press on the same
 * recording is deduped there (sourceLocks + the chat that took the source) and only returns the running chat.
 * What came out (status, Yozora issue numbers from her replies) is read back with getDirectorSession.
 * reviewNew is the soft key's one press: ONE chat for every recording without a review, the other sources tagged on it.
 */

const plaud = require('./plaudClient');

const LIST_LIMIT = 8;
const SUMMARY_MAX = 1200;
const PERSONA = 'xi';

let deps = {};
let kept = null;     // the last good recordings list (raw, no review state) and when it was read
let lastRead = 0;

function directorStart() { return deps.directorStart || require('./directorStart'); }
function xiDirector() { return deps.xiDirector || require('./xiDirector'); }

/** The Xi chat that took this recording, from its tagged sources: no Plaud call, no start. */
function sessionFor(source) {
    try {
        const backend = xiDirector();
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

/**
 * The newest recordings with the review state of each. lastRead is when Plaud's list was last read; when Plaud cannot
 * be reached (network / refused) the kept list comes back with stale: true. battery and device are null: Plaud's
 * developer API reports no device (tested Nov 25 2026: /open/third-party/devices answers 404; a file has only serial_number).
 */
async function list() {
    let raw;
    let stale = false;
    try {
        const r = await plaud.listRecordings({ limit: LIST_LIMIT });
        raw = (r.recordings || []).slice(0, LIST_LIMIT);
        kept = raw;
        lastRead = Date.now();
    } catch (e) {
        if (e && e.code === 'PLAUD_NOT_LINKED') kept = null;
        if (!kept || !e || (e.code !== 'PLAUD_NETWORK' && e.code !== 'PLAUD_REFUSED')) throw e;
        raw = kept;
        stale = true;
    }
    const st = await plaud.status();
    const recordings = raw.map(withReview);
    return {
        linked: !!st.linked,
        recordings,
        battery: null,
        device: null,
        lastRead,
        stale,
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

const oneLine = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The soft key: one background chat for every recording without a review (newest first); none -> nothing starts. */
async function reviewNew(gr) {
    const fresh = (await list()).recordings.filter((x) => !x.review);
    if (!fresh.length) return { started: false, none: true, count: 0, waiting: 0 };
    const names = fresh.map((x) => `${x.source}${oneLine(x.name, 80) ? ` (${oneLine(x.name, 80)})` : ''}`);
    const prompt = `Only these recordings, sent from Today, newest first: ${names.join(', ')}.\n${require('./plaudActionsPrompt').BODY}`;
    const title = `Plaud: ${fresh.length} new recording${fresh.length === 1 ? '' : 's'}`.slice(0, 80);
    const out = await directorStart().startDirectorSession(gr, { persona: PERSONA, task: 'plain', source: fresh[0].source, prompt, title });
    if (!out.deduped) {
        for (const rec of fresh.slice(1)) {
            try { await xiDirector().tagStartedChat(out.sessionId, { source: rec.source }); } catch (_) { /* the chat runs; that tag only shows later */ }
        }
    }
    return { sessionId: out.sessionId, started: out.started !== false, deduped: !!out.deduped, count: fresh.length, review: sessionFor(fresh[0].source) };
}

module.exports = {
    list, summary, review, reviewNew, sessionFor,
    _test: { setDeps: (d) => { deps = Object.assign(deps, d || {}); }, reset: () => { deps = {}; kept = null; lastRead = 0; } }
};
