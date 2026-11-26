'use strict';

/**
 * Task recurrence (Yozora #1203, "a recurring task unchecks and resets on its recurrence date"): a task
 * (a VTODO in the host's calendar files) that carries an RRULE is reset by the SERVER on its next date:
 * unchecked and due again. No page, no client; it also runs right after a server restart, and the clients
 * get the change pushed (vfs_updated) like any other calendar write.
 *
 * The stored format (shared with the phone's Tasks app and the desktop Calendar):
 *   RRULE:FREQ=DAILY | FREQ=WEEKLY;BYDAY=TH[,..] (INTERVAL=n; MONTHLY / YEARLY from other writers work through
 *   the same occurrences() maths; UNTIL is respected; COUNT is ignored), DUE;VALUE=DATE:YYYYMMDD, optional
 *   DTSTART;VALUE=DATE:, done state STATUS:COMPLETED + PERCENT-COMPLETE:100 + COMPLETED:<utc>, optional
 *   VALARM with TRIGGER;VALUE=DATE-TIME:<utc>.
 *
 * Reset, for every VTODO with an RRULE and a DUE (else DTSTART as the anchor, and a DUE is written) in a
 * calendar file without X-MELATON-SOURCE (phone mirrors and subscriptions are never written; X-MELATON-OWNER
 * files are fine):
 * - The rule's dates are counted from the task's current DUE date (whole days, the server's local time).
 *   next = the first rule date strictly after DUE. When the start of today >= next the task is reset: DUE
 *   becomes the LATEST rule date that is <= today (missed dates are skipped: one reset, not one per date).
 *   Done or not done makes no difference: an unfinished task rolls on to the current date too.
 * - STATUS, PERCENT-COMPLETE and COMPLETED lines are removed (no STATUS = not completed, as the clients
 *   read it; a STATUS:CANCELLED task is left alone). DTSTART moves by the same number of days as DUE; an
 *   absolute VALARM trigger moves by the same number of days (the same local clock time, so across a DST
 *   change its UTC value changes). LAST-MODIFIED and DTSTAMP are set to now (calendarMerge prefers the
 *   newer stamp), SEQUENCE is bumped when present. Every other line of the task and of the file stays
 *   byte for byte as it was: the file is edited at the line level, not re-serialised.
 * - Idempotent; the state lives only in the item. A second pass finds nothing to do.
 *
 * Scheduling (phone-power-server: one timer, no polling): the first tick runs ~20 s after start (the VFS is
 * up; a failed read is retried in a minute), then ONE unref'd timer waits for the earliest next reset (the
 * next local midnight of a task's rule, at most 12 h), and a .ics change (vfsDatabase.onUserFilesChanged)
 * rescans after a debounce. Its own writes fire that hook too: the second pass finds nothing and stops.
 *
 * Writing: inside withLock(CAL_LOCK) (the lock every calendar write shares) the file is read again, the
 * reset recomputed and written only when the text changed, through VfsManager.saveUserFileBuffer with
 * overwrite - the call vfs_upload_file makes - so the content hash changes, the replaced text is kept in
 * calendarBases (a stale window's later save still merges three-way), vfsDatabase.userFilesChanged fires
 * (the reminder scheduler rescans; the moved reminder fires again under its new id), and a vfs_updated for
 * /Workspaces/<default>/Calendars is broadcast to every client.
 */

const reminders = require('./reminderScheduler');
const { withLock, CAL_LOCK } = require('./calendarMcp');

const { parseIcs, parseIcsDate, occurrences } = reminders;

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const FIRST_TICK_MS = 20 * 1000;
const MAX_WAIT_MS = 12 * HOUR; // the timer never waits longer
const SLACK_MS = 1000; // wake just after midnight (a timer may fire a few ms early)
const DEBOUNCE_MS = 2500;
const MAX_FILE = 2 * 1024 * 1024; // as the calendar merge: bigger files are left alone
const HISTORY = 20;

let gr = null;
let nowFn = () => Date.now();
let timer = null;
let debounce = null;
let started = false;
let running = null;
let again = false;
let source = null; // async (fileId?) => [{ fileId, name, workspace, folderId, mime, text }] (tests swap it)
let writer = null; // async (file, text) (tests capture writes)
let unhook = null;
let lastTickAt = 0;
let lastError = null;
let lastNextAt = null;
const history = []; // the latest resets, for status()

// ------------------------------------------------------------------ dates

const pad = (n) => String(n).padStart(2, '0');
const dayOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const plusDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayNumber = (d) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ymd8 = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const utcStamp = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; };

/**
 * An iCalendar date / date-time property line moved by whole local days, keeping its parameters, its form
 * (date, UTC, floating / TZID) and its local clock time. Answers the new line, or null when the value is unreadable.
 */
function shiftLine(line, days) {
    const colon = line.indexOf(':');
    if (colon < 0) return null;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1).trim();
    const semi = head.indexOf(';');
    const p = parseIcsDate(value, semi < 0 ? '' : head.slice(semi + 1));
    if (!p) return null;
    const d = p.date;
    const nd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes(), d.getSeconds());
    let out;
    if (/^\d{8}$/.test(value)) out = ymd8(nd);
    else if (/Z$/i.test(value)) out = `${utcStamp(nd.getTime()).slice(0, /T\d{4}Z$/i.test(value) ? 13 : 15)}Z`;
    else out = `${ymd8(nd)}T${pad(nd.getHours())}${pad(nd.getMinutes())}${/T\d{6}$/.test(value) ? pad(nd.getSeconds()) : ''}`;
    return `${head}:${out}`;
}

/** A property line folded at 75 octets (RFC 5545 3.1); a character is never cut. */
function fold(line) {
    if (Buffer.byteLength(line, 'utf8') <= 75) return line;
    const out = [];
    let cur = '';
    let bytes = 0;
    for (const ch of line) {
        const n = Buffer.byteLength(ch, 'utf8');
        if (bytes + n > 75) { out.push(cur); cur = ' '; bytes = 1; }
        cur += ch;
        bytes += n;
    }
    out.push(cur);
    return out.join('\r\n');
}

// ------------------------------------------------------------------ the rule

/** The rule's dates (local midnights) in [from, to), counted from `anchor`. */
function ruleDates(rule, anchor, from, to) {
    return occurrences({ start: anchor, end: anchor, exdates: [], rrule: rule }, from, to).map((o) => o.start);
}

/** The first date of the rule strictly after the anchor, or null (UNTIL passed, or no such date soon). */
function nextDate(rule, anchor) {
    for (const span of [45, 400, 2000]) {
        const dates = ruleDates(rule, anchor, plusDays(anchor, 1), plusDays(anchor, 1 + span));
        if (dates.length) return dates[0];
    }
    return null;
}

/**
 * What one task needs: { uid, nextAt, anchor0, anchor } where anchor differs from anchor0 when it is to be
 * reset, nextAt is the ms of the next reset (the start of that day); null when the task is not repeating,
 * cancelled, without a date, or its series has ended (UNTIL before today: nothing is reset any more).
 */
function planTask(lines, nowMs) {
    let task;
    try { task = parseIcs(`BEGIN:VCALENDAR\n${lines.join('\n')}\nEND:VCALENDAR`).tasks[0]; } catch (_e) { return null; }
    if (!task || !task.rrule) return null;
    if (lines.some((l) => /^STATUS:\s*CANCELLED\s*$/i.test(l))) return null;
    const src = task.due || task.start;
    if (!src) return null;
    const rule = Object.assign({}, task.rrule, { count: null }); // COUNT is ignored
    const today = dayOf(new Date(nowMs));
    if (rule.until && dayOf(rule.until).getTime() < today.getTime()) return null; // the series has ended: a finished task stays finished
    const anchor0 = dayOf(src);
    let anchor = anchor0;
    let nextAt = null;
    for (let k = 0; k < 6; k += 1) { // a rule whose dates shift with a new anchor (monthly 31st) settles in a pass or two
        const next = nextDate(rule, anchor);
        if (!next) break;
        if (next.getTime() > today.getTime()) { nextAt = next.getTime(); break; }
        const upTo = ruleDates(rule, anchor, plusDays(anchor, 1), plusDays(today, 1));
        if (!upTo.length) break;
        anchor = upTo[upTo.length - 1];
    }
    return { uid: task.uid || '', nextAt, anchor0, anchor, hasDue: !!task.due };
}

// ------------------------------------------------------------------ the text

/** Physical lines with their terminators, grouped into logical (unfolded) entries { raw, text }. */
function entriesOf(text) {
    const phys = [];
    const re = /[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g;
    let m;
    while ((m = re.exec(text))) phys.push(m[0]);
    const out = [];
    for (const p of phys) {
        const content = p.replace(/(?:\r\n|\r|\n)$/, '');
        if (out.length && /^[ \t]/.test(p)) { out[out.length - 1].raw += p; out[out.length - 1].text += content.slice(1); } else out.push({ raw: p, text: content });
    }
    return out;
}

/** The VTODO's entries rewritten for a reset to `plan.anchor`. Unchanged entries keep their raw text. */
function rewriteTask(entries, plan, nowMs) {
    const days = dayNumber(plan.anchor) - dayNumber(plan.anchor0);
    const stamp = utcStamp(nowMs);
    const out = [];
    const made = (text) => ({ raw: null, text });
    let depth = 0;
    let sawDue = false;
    let sawMod = false;
    let sawStamp = false;
    let dtstartAt = -1;
    let extrasAt = -1;
    entries.forEach((e) => {
        const t = e.text;
        const begin = /^BEGIN:/i.test(t);
        const end = /^END:/i.test(t);
        if (begin) {
            depth += 1;
            if (depth === 2 && extrasAt < 0) extrasAt = out.length;
            out.push(e);
            return;
        }
        if (end) {
            if (depth === 1 && extrasAt < 0) extrasAt = out.length; // END:VTODO
            depth -= 1;
            out.push(e);
            return;
        }
        const name = ((/^([A-Za-z0-9-]+)/.exec(t) || [])[1] || '').toUpperCase();
        if (depth >= 2) {
            // an absolute reminder moves with the task
            if (name === 'TRIGGER' && /VALUE=DATE-TIME/i.test(t.slice(0, Math.max(0, t.indexOf(':'))))) {
                const s = shiftLine(t, days);
                out.push(s ? made(s) : e);
            } else out.push(e);
            return;
        }
        if (name === 'STATUS' || name === 'PERCENT-COMPLETE' || name === 'COMPLETED') return;
        if (name === 'DUE') {
            const s = shiftLine(t, days);
            if (s) { sawDue = true; out.push(made(s)); }
            return; // an unreadable DUE is replaced by a written one
        }
        if (name === 'DTSTART') {
            const s = shiftLine(t, days);
            out.push(s ? made(s) : e);
            dtstartAt = out.length; // a written DUE goes right after it
            return;
        }
        if (name === 'DTSTAMP') { sawStamp = true; out.push(made(`DTSTAMP:${stamp}`)); return; }
        if (name === 'LAST-MODIFIED') { sawMod = true; out.push(made(`LAST-MODIFIED:${stamp}`)); return; }
        if (name === 'SEQUENCE') {
            const n = /^SEQUENCE[^:]*:\s*(\d+)/i.exec(t);
            out.push(n ? made(`SEQUENCE:${parseInt(n[1], 10) + 1}`) : e);
            return;
        }
        out.push(e);
    });
    const adds = [];
    if (!sawDue) adds.push({ at: dtstartAt >= 0 ? dtstartAt : extrasAt, items: [made(`DUE;VALUE=DATE:${ymd8(plan.anchor)}`)] });
    const stamps = [];
    if (!sawStamp) stamps.push(made(`DTSTAMP:${stamp}`));
    if (!sawMod) stamps.push(made(`LAST-MODIFIED:${stamp}`));
    if (stamps.length) adds.push({ at: extrasAt, items: stamps });
    adds.sort((a, b) => b.at - a.at).forEach((a) => out.splice(a.at, 0, ...a.items));
    return out;
}

/**
 * The text of one calendar file after the resets due at `nowMs`: { text, resets: [{ uid, from, to }], nextAt }.
 * nextAt is the earliest future reset moment over all repeating tasks (after these resets), or null.
 * Pure: the scheduler and the tests use it.
 */
function resetText(icsText, nowMs) {
    const text = String(icsText == null ? '' : icsText);
    const none = { text, resets: [], nextAt: null };
    if (!/RRULE/i.test(text) || !/BEGIN:VTODO/i.test(text)) return none;
    const entries = entriesOf(text);
    let depth = 0;
    let start = null;
    const spans = [];
    for (let i = 0; i < entries.length; i += 1) {
        const t = entries[i].text;
        const b = /^BEGIN:(\w+)/i.exec(t);
        const e = /^END:(\w+)/i.exec(t);
        if (b) {
            if (depth === 1 && start === null && /^VTODO$/i.test(b[1])) start = i;
            depth += 1;
        } else if (e) {
            if (depth === 2 && start !== null && /^VTODO$/i.test(e[1])) { spans.push([start, i]); start = null; }
            depth -= 1;
        } else if (depth === 1 && /^X-MELATON-SOURCE[;:]/i.test(t)) return none; // a mirror or a subscription: never written
    }
    if (!spans.length) return none;
    const resets = [];
    let nextAt = null;
    const pieces = [];
    let at = 0;
    spans.forEach(([s, e]) => {
        const slice = entries.slice(s, e + 1);
        const plan = planTask(slice.map((x) => x.text), nowMs);
        if (!plan) return;
        if (plan.nextAt !== null && (nextAt === null || plan.nextAt < nextAt)) nextAt = plan.nextAt;
        if (plan.anchor.getTime() === plan.anchor0.getTime()) return;
        pieces.push(entries.slice(at, s), rewriteTask(slice, plan, nowMs));
        at = e + 1;
        resets.push({ uid: plan.uid, from: plan.hasDue ? ymd(plan.anchor0) : null, to: ymd(plan.anchor) });
    });
    if (!resets.length) return { text, resets, nextAt };
    pieces.push(entries.slice(at));
    const eol = (/(\r\n|\r|\n)/.exec(text) || ['\r\n'])[0];
    const out = pieces.flat().map((x) => (x.raw !== null ? x.raw : `${fold(x.text)}${eol}`)).join('');
    return { text: out, resets, nextAt };
}

// ------------------------------------------------------------------ the files

async function listFiles(fileId) {
    if (source) return (await source(fileId)) || [];
    const all = await reminders.readCalendarFiles({ always: true });
    return fileId ? all.filter((f) => f.fileId === fileId) : all;
}

function broadcastUpdated(workspace) {
    try {
        const vfs = gr && gr.getVfsManager ? gr.getVfsManager() : null;
        if (vfs && typeof vfs.invalidatePathStatsCache === 'function') vfs.invalidatePathStatsCache();
        try { require('./vfsFuseHttp').invalidateFuseLookupCache(); } catch (_e) { /* not loaded */ }
        const wss = gr && typeof gr.getWebSocketServer === 'function' ? gr.getWebSocketServer() : null;
        if (wss && typeof wss.broadcast === 'function') wss.broadcast({ type: 'vfs_updated', data: { path: `/Workspaces/${workspace}/Calendars` }, timestamp: new Date().toISOString() });
    } catch (_e) { /* no live clients */ }
}

/** The real write: the VFS's own overwrite of a stored file (the call vfs_upload_file makes), then the push. */
async function writeFile(file, text) {
    if (writer) return writer(file, text);
    const vfs = gr.getVfsManager();
    const saved = await vfs.saveUserFileBuffer(Buffer.from(text, 'utf8'), {
        originalName: file.name,
        mimeType: file.mime || 'text/calendar',
        scope: 'workspace',
        workspaceId: file.workspace,
        folderId: file.folderId,
        overwrite: true,
    });
    if (!saved || !saved.id) throw new Error('file was not stored');
    try {
        const content = saved.content_hash;
        if (content) await require('./replicationJournal').recordVfsFile(content, { operation: 'INSERT', payload: { fileId: saved.id, originalName: saved.original_name, scope: 'workspace', workspaceId: file.workspace } });
    } catch (_e) { /* replication is best effort */ }
    broadcastUpdated(file.workspace);
    return saved;
}

/** One file: reset what is due, under the calendar lock. Answers its next reset moment (ms) or null. */
async function processFile(file, now) {
    if (typeof file.text !== 'string' || file.text.length > MAX_FILE) return null;
    const probe = resetText(file.text, now);
    if (!probe.resets.length) return probe.nextAt;
    return withLock(CAL_LOCK, async () => {
        // read again under the lock: a client save or an agent may have written since
        const fresh = (await listFiles(file.fileId)).find((f) => f.fileId === file.fileId);
        if (!fresh || typeof fresh.text !== 'string' || fresh.text.length > MAX_FILE) return null;
        const r = resetText(fresh.text, now);
        if (r.text !== fresh.text) {
            await writeFile(fresh, r.text);
            r.resets.forEach((x) => {
                console.log(`[task-recurrence] reset ${x.uid} due ${x.from || '(none)'} -> ${x.to}`);
                history.unshift({ at: now, uid: x.uid, from: x.from, to: x.to, file: fresh.name });
            });
            history.length = Math.min(history.length, HISTORY);
        }
        return r.nextAt;
    });
}

/** Look at every calendar, reset what is due, arm the timer for the next date. */
async function tick() {
    if (running) { again = true; return running; }
    running = (async () => {
        let next = null;
        try {
            const now = nowFn();
            const files = await listFiles();
            for (const f of files) {
                const n = await processFile(f, now);
                if (n !== null && (next === null || n < next)) next = n;
            }
            lastTickAt = now;
            lastError = null;
            lastNextAt = next;
        } catch (e) {
            // the VFS not up yet (boot), or a failed read / write: try again in a minute
            lastError = e.message;
            console.warn(`[task-recurrence] pass failed: ${e.message}`);
            arm(MIN);
            return;
        }
        arm();
    })();
    try { await running; } finally {
        running = null;
        if (again) { again = false; await tick(); }
    }
    return undefined;
}

/** The single timer: the earliest next reset (just after the local midnight), at most 12 h. */
function arm(ms) {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!started) return;
    const wait = ms !== undefined ? ms : Math.min(MAX_WAIT_MS, lastNextAt === null ? MAX_WAIT_MS : Math.max(1000, lastNextAt - nowFn() + SLACK_MS));
    timer = setTimeout(() => { timer = null; tick(); }, wait);
    if (timer.unref) timer.unref();
}

/** A calendar file may have changed (vfsDatabase.onUserFilesChanged): look again shortly. */
function changed(info) {
    if (!started) return;
    if (info && info.name && !/\.ics$/i.test(String(info.name))) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { debounce = null; tick(); }, DEBOUNCE_MS);
    if (debounce.unref) debounce.unref();
}

/** Start once (the inbox handler's registerPackets): first pass when the VFS is up. */
function start(globalResources, { delayMs = FIRST_TICK_MS } = {}) {
    if (globalResources) gr = globalResources;
    if (started || process.env.TASK_RECURRENCE_OFF) return module.exports;
    started = true;
    try {
        const vdb = require('./vfsDatabase');
        if (typeof vdb.onUserFilesChanged === 'function') unhook = vdb.onUserFilesChanged(changed);
    } catch (e) { console.warn(`[task-recurrence] no VFS change hook: ${e.message}`); }
    arm(delayMs);
    return module.exports;
}

function stop() {
    started = false;
    if (timer) clearTimeout(timer);
    if (debounce) clearTimeout(debounce);
    timer = null;
    debounce = null;
    if (unhook) { try { unhook(); } catch (_e) { /* gone */ } unhook = null; }
}

function status() {
    return { started, lastTickAt, lastError, nextAt: lastNextAt, recent: history.slice() };
}

module.exports = {
    start,
    stop,
    tick,
    changed,
    status,
    resetText,
    _test: {
        setNow: (fn) => { nowFn = fn || (() => Date.now()); },
        setSource: (fn) => { source = fn || null; },
        setWriter: (fn) => { writer = fn || null; },
        bind: (g) => { gr = g; },
        startNoTimer: () => { started = true; },
        timerDelay: () => (timer ? timer._idleTimeout : null),
        shiftLine,
        fold,
        reset: () => {
            stop();
            source = null;
            writer = null;
            running = null;
            again = false;
            lastNextAt = null;
            lastError = null;
            history.length = 0;
        },
    },
};
