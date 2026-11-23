'use strict';

// start_director_session (#1068): start or reuse a Director chat from outside the
// Director window (Sala's Plaud flow, scripts, other agents) and post the first
// request, with no browser tab bound. The persona runs its turn headless; the
// turn-finished notice (notificationInboxSources director:<sid>:turn) and
// request_form questions reach Yukimi the usual way.
//
// Reuse, in order:
//   1. source   - a chat that already took this source (plaud:<id>) is returned
//                 as it is, with no second message (idempotent).
//   2. sessionId - post into that chat (refused while it is mid-turn).
//   3. thread    - post into the newest open chat started with this thread name;
//                 a new chat (same thread) when that one is mid-turn or archived.
//   4. otherwise a new chat.

const STARTED_VIA = 'start_director_session';
const MAX_PROMPT = 60000;
const MAX_ATTACHMENTS = 8;
const MAX_TEXT_ATTACHMENT = 2 * 1024 * 1024;
const WREN_START_WAIT_MS = 8000;
const YOZORA_WEB = 'https://yozora.bluesteel.737.jp.net/DreamScape/StaticForge/issues/';
const ISSUE_LINK = /yozora\.bluesteel\.737\.jp\.net\/DreamScape\/StaticForge\/issues\/(\d+)/g;

const PERSONAS = {
    yozora: 'xi', xi: 'xi',
    yumiya: 'wren', wren: 'wren', director: 'wren',
    chiyo: 'kabuki', kabuki: 'kabuki'
};
const PERSONA_NAMES = { xi: 'Yozora', wren: 'Yumiya', kabuki: 'Chiyo' };
const TASKS = new Set(['plain', 'review']);

// Same source arriving twice at once (webhook retry) waits for the first call.
const sourceLocks = new Map();

function fail(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function resolvePersona(value) {
    const key = String(value || '').trim().toLowerCase();
    const id = PERSONAS[key];
    if (!id) throw fail(`Unknown persona "${value}". Use Yozora, Yumiya, or Chiyo.`, 'UNKNOWN_PERSONA');
    return id;
}

function backendFor(persona) {
    return persona === 'xi' ? require('./xiDirector') : require('./cursorDirector');
}

function cleanKey(value, max) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, max) : '';
}

// Text attachments become client uploads (readAttachment writes them to the chat's inbox);
// a VFS file id goes through as it is.
function normalizeAttachments(list) {
    if (list == null) return [];
    if (!Array.isArray(list)) throw fail('attachments must be an array', 'INVALID_ATTACHMENTS');
    if (list.length > MAX_ATTACHMENTS) throw fail(`At most ${MAX_ATTACHMENTS} attachments`, 'INVALID_ATTACHMENTS');
    return list.map((item, i) => {
        const a = item && typeof item === 'object' ? item : {};
        if (a.vfsFileId || a.fileId) return { source: 'vfs', fileId: String(a.vfsFileId || a.fileId) };
        if (typeof a.text !== 'string') throw fail(`attachments[${i}] needs text or vfsFileId`, 'INVALID_ATTACHMENTS');
        const buffer = Buffer.from(a.text, 'utf8');
        if (!buffer.length) throw fail(`attachments[${i}] is empty`, 'INVALID_ATTACHMENTS');
        if (buffer.length > MAX_TEXT_ATTACHMENT) throw fail(`attachments[${i}] is over 2 MB`, 'INVALID_ATTACHMENTS');
        const name = cleanKey(a.name, 80).replace(/[^\w.\- ]+/g, '_') || `attachment-${i + 1}.md`;
        return { source: 'client', name, data: buffer.toString('base64') };
    });
}

// The brief for task "review": a Plaud brainstorm or live-test report turned into
// Yozora issues that a coding agent can pick up without asking again.
function reviewBrief(prompt, source) {
    return [
        'Task: turn the review below (a brainstorming or live-testing report, often a Plaud recording summary, action items and transcript) into planned work on Yozora, DreamScape/StaticForge (or the repo the item belongs to).',
        '',
        'How:',
        '1. Read the whole report and any attached files first. Check the code and open Yozora issues before you write: reuse or comment on an issue that already covers an item instead of filing a duplicate.',
        '2. Group the action items into one or more issues by topic and repo. Each issue: a specific title; Ziel (goal), Kontext (what was said or seen, short quotes from the transcript), Umfang (scope) as a checklist, Abnahme (how to verify), the files or modules that are likely involved (you checked them), and the source of the review' + (source ? ` (${source})` : '') + '.',
        '3. Language: issues and issue comments on Yozora in German, like the rest of Yozora. Everything you say to Yukimi - your chat replies, request_form titles, labels and options - in English, whatever language the review is in.',
        '4. Labels by board convention: one type:*, one of p1/p2/p3, and status:ready when nothing is open, else status:triage. Add cursor-agent when a coding agent (Claude Code) can take it as written. Card it on board 5 in the column that matches its status.',
        '5. Invent nothing. Whatever is unclear or needs Yukimi\'s decision becomes a question: ask with request_form (chatId of this chat). If request_form says no client is connected, put the questions in your reply and leave them in the issue under "Offene Fragen" with status:triage. When she answers, update the issue and move it to status:ready.',
        '6. Reply (in English) with a short list: each issue as a link, its labels, and the questions still open.',
        '',
        'Review:',
        prompt
    ].join('\n');
}

function makeStub(gr) {
    const out = { errors: [], packets: [] };
    return {
        out,
        // a socket stand-in: Director only uses it as the reply target, which is this stub
        ws: { readyState: 1, __directorStart: true },
        handler: {
            globalResources: gr,
            sendToClient(_ws, packet) { out.packets.push(packet); },
            sendError(_ws, message, code) { out.errors.push({ message: String(message || 'Director error'), code: code || 'DIRECTOR_ERROR' }); }
        }
    };
}

function firstError(stub) {
    if (stub.out.errors.length) return stub.out.errors[0];
    const bad = stub.out.packets.find((p) => p && p.type === 'director_message_error');
    return bad ? { message: (bad.data && bad.data.error) || 'Director error', code: 'DIRECTOR_ERROR' } : null;
}

function throwIfFailed(stub) {
    const err = firstError(stub);
    if (err) throw fail(err.message, err.code);
}

function personaChats(backend, persona) {
    const list = typeof backend.listChatBriefs === 'function' ? backend.listChatBriefs() : [];
    return persona === 'xi' ? list : list.filter((chat) => chat.persona === persona);
}

// Yozora's engine is fixed when the chat is made: the caller's, else her last chat's, else
// TokenRouter (what the Director window starts a new Yozora chat on). runtime overrides it
// for a fallback chat.
function xiStartChoice(chats, input, runtimeOverride) {
    const latest = chats.slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
        .find((chat) => chat.runtime);
    const runtime = runtimeOverride || input.engine || (latest && latest.runtime) || 'tokenrouter';
    const sameRuntime = latest && latest.runtime === runtime && latest.choice;
    const pinned = !runtimeOverride || runtimeOverride === input.engine;
    return {
        runtime,
        model: (pinned && input.model) || (sameRuntime && latest.choice.id !== 'auto' ? latest.choice.id : undefined),
        effort: input.effort || (sameRuntime && latest.choice.effort) || 'medium'
    };
}

// Engines a Yozora start falls back to, in order, when the first refuses (#1072).
const XI_FALLBACK_ENGINES = ['custom:deepinfra', 'custom:sloproxy'];
// A refusal at the start of a turn: auth, payment, quota, an engine that is off or has no key.
const ENGINE_REFUSAL = /\b(401|402|403|429)\b|authenticat|forbidden|unauthori[sz]ed|insufficient|balance|quota|credit|rate.?limit|not turned on|no api key|ENGINE_UNAVAILABLE|PROVIDER_/i;
const EARLY_FAIL_WAIT_MS = 20000;

function xiEngineChain(first, input) {
    const chain = [first];
    if (input.fallback !== false) XI_FALLBACK_ENGINES.forEach((engine) => { if (!chain.includes(engine)) chain.push(engine); });
    return chain;
}

async function createChat(gr, persona, input, title, runtime) {
    const backend = backendFor(persona);
    const stub = makeStub(gr);
    if (persona === 'xi') {
        const choice = xiStartChoice(personaChats(backend, 'xi'), input, runtime);
        await backend.handleDirectorCreateSession(stub.handler, stub.ws, {
            persona: 'xi', description: title || '', runtime: choice.runtime
        });
        throwIfFailed(stub);
        const reply = stub.out.packets.find((p) => p.type === 'director_create_session_response');
        const id = reply && reply.data && reply.data.session && reply.data.session.id;
        if (!id) throw fail('Yozora did not create a session', 'DIRECTOR_ERROR');
        return { id, choice };
    }
    // Wren / Chiyo: no description, so create does not start a turn of its own.
    await backend.handleDirectorCreateSession(stub.handler, stub.ws, {
        persona,
        sessionType: input.sessionType || 'lowvolume'
    }, {}, null);
    throwIfFailed(stub);
    const reply = stub.out.packets.find((p) => p.type === 'director_create_session_response');
    const id = reply && reply.data && reply.data.session && reply.data.session.id;
    if (!id) throw fail('Director did not create a session', 'DIRECTOR_ERROR');
    return { id, choice: null };
}

async function sendFirst(gr, persona, sessionId, content, attachments, choice, input) {
    const backend = backendFor(persona);
    const stub = makeStub(gr);
    if (persona === 'xi') {
        // returns once the detached CLI is spawned
        await backend.handleDirectorSendMessage(stub.handler, stub.ws, {
            sessionId,
            content,
            attachments,
            model: (choice && choice.model) || input.model || undefined,
            effort: (choice && choice.effort) || input.effort || 'medium'
        }, {});
        throwIfFailed(stub);
        return;
    }
    // Wren's send awaits the whole turn: start it and return once it is running or refused.
    const start = typeof backend.directorDefaultsFor === 'function' ? backend.directorDefaultsFor(gr, persona) : null;
    const turn = backend.handleDirectorSendMessage(stub.handler, stub.ws, {
        sessionId,
        content,
        attachments,
        engine: input.engine || (start && start.engine) || undefined,
        model: input.model || (start && start.model) || undefined,
        effort: input.effort || (start && start.effort) || 'medium'
    }, {}, null).catch((err) => {
        stub.out.errors.push({ message: err.message, code: err.code || 'DIRECTOR_ERROR' });
    });
    let settled = false;
    turn.then(() => { settled = true; });
    const until = Date.now() + WREN_START_WAIT_MS;
    while (Date.now() < until) {
        if (firstError(stub)) break;
        if (settled) break;
        const running = (backend.listActiveRuns() || []).some((run) => run.sessionId === sessionId);
        if (running) return;
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throwIfFailed(stub);
}

function result(persona, sessionId, extra) {
    return Object.assign({
        sessionId,
        chatId: sessionId,
        persona,
        personaName: PERSONA_NAMES[persona],
        // what the inbox notice carries to open the chat (notificationInboxSources onDirectorStatus)
        open: { app: 'director', sessionId },
        issuesUrl: YOZORA_WEB
    }, extra);
}

async function startUnlocked(gr, input) {
    const persona = resolvePersona(input.persona);
    const backend = backendFor(persona);
    if (persona === 'xi' && !backend.isEnabled(gr)) throw fail('Yozora is turned off (config xi.enabled)', 'XI_DISABLED');
    const prompt = String(input.prompt || '').trim();
    if (!prompt) throw fail('prompt is required', 'MISSING_PARAMETERS');
    if (prompt.length > MAX_PROMPT) throw fail(`Keep prompt under ${MAX_PROMPT} characters; attach the transcript instead`, 'PROMPT_TOO_LONG');
    const task = input.task ? String(input.task).toLowerCase() : 'plain';
    if (!TASKS.has(task)) throw fail('task is plain or review', 'INVALID_TASK');
    const source = cleanKey(input.source, 200);
    const thread = cleanKey(input.thread, 80);
    const title = cleanKey(input.title, 80);
    const attachments = normalizeAttachments(input.attachments);
    const chats = personaChats(backend, persona);

    if (source) {
        const seen = chats.find((chat) => chat.sources.includes(source));
        if (seen) {
            return result(persona, seen.id, {
                created: false, reused: true, deduped: true, started: false,
                status: seen.running ? 'running' : 'idle', source
            });
        }
    }

    let target = null;
    let reason = 'new';
    if (input.sessionId) {
        target = chats.find((chat) => chat.id === input.sessionId);
        if (!target) throw fail(`No ${PERSONA_NAMES[persona]} chat ${input.sessionId}`, 'SESSION_NOT_FOUND');
        if (target.running) throw fail(`${PERSONA_NAMES[persona]} is still working in that chat; try again when the turn ends`, 'DIRECTOR_BUSY');
        reason = 'sessionId';
    } else if (thread) {
        target = chats.filter((chat) => chat.thread === thread && !chat.archived)
            .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0] || null;
        if (target && target.running) target = null;
        if (target) reason = 'thread';
    }

    const content = task === 'review' ? reviewBrief(prompt, source) : prompt;
    if (persona !== 'xi') {
        const out = await startOn(gr, persona, backend, { input, target, title, source, thread, content, attachments, runtime: null });
        return result(persona, out.sessionId, {
            created: out.created, reused: !out.created, reusedBy: out.created ? null : reason, deduped: false,
            started: true, status: 'running', source: source || null, thread: thread || null
        });
    }

    // Yozora: try her engine, then DeepInfra, then SloProxy, while an engine refuses at the start.
    // A pinned sessionId keeps its engine (no fallback).
    const first = target ? (target.runtime || 'cursor') : xiStartChoice(chats, input).runtime;
    const chain = input.sessionId ? [first] : xiEngineChain(first, input);
    const fallbackFrom = [];
    for (let i = 0; i < chain.length; i += 1) {
        const useTarget = i === 0 ? target : null;
        let out;
        try {
            out = await startOn(gr, persona, backend, {
                input, target: useTarget, title, source, thread, content, attachments, runtime: chain[i], watch: chain.length > 1
            });
        } catch (error) {
            if (i === chain.length - 1 || !ENGINE_REFUSAL.test(`${error.code || ''} ${error.message || ''}`)) {
                if (fallbackFrom.length) error.fallbackFrom = fallbackFrom;
                throw error;
            }
            fallbackFrom.push({ engine: chain[i], error: String(error.message || error.code).slice(0, 300) });
            continue;
        }
        return result(persona, out.sessionId, {
            created: out.created, reused: !out.created, reusedBy: out.created ? null : reason, deduped: false,
            started: true, status: 'running', source: source || null, thread: thread || null,
            engine: chain[i], fallbackFrom: fallbackFrom.length ? fallbackFrom : undefined
        });
    }
    throw fail('No engine could start Yozora', 'ENGINE_UNAVAILABLE');
}

// Resolves null once the turn has output (the engine accepted it) or the wait is over.
async function tookIt(backend, sessionId) {
    const until = Date.now() + EARLY_FAIL_WAIT_MS;
    while (Date.now() < until) {
        if (typeof backend.runHasOutput === 'function' && backend.runHasOutput(sessionId)) return null;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
}

// One attempt: make (or reuse) the chat, tag it, send. With watch, wait a short while for a turn
// that dies at once and throw its error so the caller can fall back; the chat this attempt made
// is deleted and the source given back.
async function startOn(gr, persona, backend, a) {
    const created = !a.target;
    let sessionId;
    let choice = null;
    if (a.target) {
        sessionId = a.target.id;
    } else {
        const made = await createChat(gr, persona, a.input, a.title, a.runtime);
        sessionId = made.id;
        choice = made.choice;
    }
    // tag before the send so a retry of the same source finds this chat even mid-turn
    await backend.tagStartedChat(sessionId, {
        source: a.source || null,
        thread: a.thread || null,
        startedVia: created ? STARTED_VIA : null,
        name: created && a.title ? a.title : null
    });
    let early = null;
    let stopWatch = null;
    if (a.watch && typeof backend.onRunSettled === 'function') {
        early = new Promise((resolve) => {
            stopWatch = backend.onRunSettled((info) => { if (info.sessionId === sessionId) resolve(info); });
        });
    }
    const undo = async () => {
        if (a.source) await backend.tagStartedChat(sessionId, { dropSource: a.source }).catch(() => {});
        if (created && persona === 'xi') {
            const stub = makeStub(gr);
            await backend.handleDirectorDeleteSession(stub.handler, stub.ws, { sessionId }).catch(() => {});
        }
    };
    try {
        await sendFirst(gr, persona, sessionId, a.content, a.attachments, choice, a.input);
        if (early) {
            const info = await Promise.race([early, tookIt(backend, sessionId)]);
            if (info && info.failed && !info.cancelled && ENGINE_REFUSAL.test(info.error || '')) {
                throw fail(info.error, 'ENGINE_REFUSED');
            }
        }
    } catch (error) {
        // a send that never started must not leave the source taken: the retry would be deduped
        await undo();
        error.sessionId = sessionId;
        throw error;
    } finally {
        if (stopWatch) stopWatch();
    }
    return { sessionId, created };
}

async function startDirectorSession(gr, input) {
    const args = input && typeof input === 'object' ? input : {};
    const source = cleanKey(args.source, 200);
    if (!source) return startUnlocked(gr, args);
    const key = `${String(args.persona || '').toLowerCase()}|${source}`;
    const prior = sourceLocks.get(key) || Promise.resolve();
    const run = prior.catch(() => {}).then(() => startUnlocked(gr, args));
    const tail = run.catch(() => {});
    sourceLocks.set(key, tail);
    tail.then(() => { if (sourceLocks.get(key) === tail) sourceLocks.delete(key); });
    return run;
}

// get_director_session: what a caller needs to follow up (status, last reply, tagged sources).
function getDirectorSession(gr, input) {
    const args = input && typeof input === 'object' ? input : {};
    const id = String(args.sessionId || args.chatId || '').trim();
    if (!id) throw fail('sessionId is required', 'MISSING_PARAMETERS');
    for (const persona of ['xi', 'wren']) {
        const backend = backendFor(persona);
        const chat = (backend.listChatBriefs ? backend.listChatBriefs() : []).find((item) => item.id === id);
        if (chat) {
            const pid = persona === 'xi' ? 'xi' : chat.persona;
            const log = typeof backend.readChatLog === 'function' ? backend.readChatLog(id) : [];
            const replies = log.filter((m) => m.role === 'assistant' && m.content);
            const issues = new Set();
            replies.forEach((m) => {
                for (const hit of String(m.content).matchAll(ISSUE_LINK)) issues.add(Number(hit[1]));
            });
            const last = replies[replies.length - 1];
            return result(pid, id, {
                name: chat.name, archived: chat.archived, status: chat.running ? 'running' : 'idle',
                sources: chat.sources, thread: chat.thread, updatedAt: chat.updated_at,
                messages: log.length,
                lastReply: last ? String(last.content).slice(0, 4000) : null,
                lastReplyAt: last ? last.timestamp || null : null,
                issues: Array.from(issues).sort((a, b) => a - b)
            });
        }
    }
    throw fail('Session not found', 'SESSION_NOT_FOUND');
}

module.exports = {
    startDirectorSession,
    getDirectorSession,
    STARTED_VIA,
    _test: { resolvePersona, normalizeAttachments, reviewBrief, xiStartChoice, xiEngineChain, makeStub, sourceLocks, ENGINE_REFUSAL }
};
