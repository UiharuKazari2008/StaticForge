'use strict';

/**
 * Reminder scheduler (Yozora #876, Yukimi Nov 16: "right now I don't even get notifications for task
 * reminders or alarms"): the server fires calendar appointment and task reminders itself, on time,
 * whether or not Melaton Mobile's page (or the desktop Calendar) is running.
 *
 * The data is the Melaton Calendar's: one iCalendar file per calendar in a workspace's Calendars folder
 * (VFS /Workspaces/<ws>/Calendars/<name>.ics, apps/calendar/client/calendar.js). The parser and the
 * recurrence expansion below are that package's (parseIcs / occurrences), ported as they are, so the
 * server reads every file the way the phone and the desktop read it: VEVENT VALARM (relative TRIGGER
 * "-PT15M" -> reminder minutes, or TRIGGER;VALUE=DATE-TIME -> reminderAt), RRULE (DAILY / WEEKLY
 * BYDAY / MONTHLY BYMONTHDAY|nXX / YEARLY, INTERVAL, COUNT, UNTIL), EXDATE, all-day events, TZID and
 * floating times as the server's local time (as the Calendar shows them); VTODO reminderAt for tasks
 * not completed. Left out, as the Calendar's own reminder window leaves them out: the calendars hidden
 * in Calendar (registry HKCU\Software\Xyridian\Melaton\Windows Calendar, Hidden), and the phone mirror
 * files (X-MELATON-SOURCE:phone:...; the phone's own calendar app reminds of those natively).
 *
 * - At start (after the VFS is up) and whenever a Calendars .ics changes (vfsDatabase.onUserFilesChanged,
 *   debounced), every reminder due from 15 minutes ago to 36 hours ahead is computed; ONE timer waits for
 *   the next one (re-armed after each fire and on change; at most 12 h, when the window rolls on).
 * - Due: a notification inbox notice (notificationInbox.publish -> inbox_updated to the pages, and
 *   activeSync inbox.notice to the phones, which post it natively when no page is running):
 *     class 'reminder', app 'calendar' / 'tasks'
 *     id    rem:<fileId>:<uid>:<occurrenceStartMs>   (an appointment: one per occurrence)
 *           rem:task:<uid>:<reminderAtMs>            (a task)
 *     title "<h:mm> | Reminder"   (Windows Mobile's reminder notification, as wmLock65 alarmNote draws it)
 *     text  the subject, the time ("10:00 AM-11:00 AM", "Tue 11/17 All Day", "Due: 11/17/2026"), the location
 *     data  { app, kind: 'reminder', uid, start, end, allDay, fileId, calendar, subject, when, location }
 *     until the appointment ends (at least an hour), a task's for a day.
 * - Fired ids are kept in sqlite (reminders.db next to notifications.db) so a restart neither repeats
 *   one nor loses one: those that came due in the last 15 minutes while the server was down fire once.
 * - Snooze (reminder_snooze from the page or the desktop Calendar): the notice is cleared (the phones
 *   take theirs down) and published again with the same id at the snooze time; kept in sqlite too.
 */

const fs = require('fs');
const path = require('path');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const CATCHUP_MS = 15 * MIN; // fire what came due this long ago (server down, a late write)
const HORIZON_MS = 36 * HOUR; // look this far ahead
const MAX_WAIT_MS = 12 * HOUR; // the timer never waits longer: the window rolls on
const FIRED_KEEP_MS = 3 * DAY;
const DEBOUNCE_MS = 2500;
const REG_KEY = 'HKCU\\Software\\Xyridian\\Melaton\\Windows Calendar';
const USER = 'admin'; // the household (the phone's user); dev_admin test tabs have no calendars of their own

let gr = null;
let db = null;
let nowFn = () => Date.now();
let timer = null;
let debounce = null;
let started = false;
let running = null; // the tick in flight
let again = false;
let source = null; // async () => [{ fileId, name, workspace, text }] (tests swap it)
let items = []; // the computed reminders in the window
let lastScanAt = 0;
let lastError = null;
const textCache = new Map(); // content hash -> parsed calendar
let unhook = null;

// ------------------------------------------------------------------ the Calendar package's parser

const pad = (n) => String(n).padStart(2, '0');
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds());
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const icsUnescape = (s) => String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function parseIcsDate(value, params) {
    const v = String(value || '').trim();
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
    if (!m) return null;
    const [, y, mo, d, h, mi, s, z] = m;
    if (h === undefined || (params && /VALUE=DATE(?!-)/i.test(params))) return { date: new Date(+y, +mo - 1, +d), allDay: true };
    if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0))), allDay: false };
    // TZID or floating: the time as written, here (Calendar shows it in the local zone)
    return { date: new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0)), allDay: false };
}

function parseRrule(v) {
    const r = {};
    String(v || '').split(';').forEach((part) => {
        const [k, val] = part.split('=');
        if (!k || val === undefined) return;
        const key = k.toUpperCase();
        if (key === 'FREQ') r.freq = val.toUpperCase();
        else if (key === 'INTERVAL') r.interval = Math.max(1, parseInt(val, 10) || 1);
        else if (key === 'COUNT') r.count = parseInt(val, 10) || null;
        else if (key === 'UNTIL') { const p = parseIcsDate(val); r.until = p ? p.date : null; } else if (key === 'BYDAY') {
            r.byday = val.split(',').map((x) => x.replace(/^[+-]?\d+/, '').toUpperCase());
            const m = /^([+-]?\d+)[A-Z]{2}$/i.exec(val.split(',')[0]);
            if (m) r.bypos = parseInt(m[1], 10);
        } else if (key === 'BYMONTHDAY') r.bymonthday = parseInt(val, 10) || null;
    });
    return r.freq ? r : null;
}

/** "-PT15M" -> 15 (minutes before); "PT0S" -> 0. */
function durationMinutes(v) {
    const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(String(v || '').trim());
    if (!m) return 0;
    const total = (+(m[2] || 0)) * 10080 + (+(m[3] || 0)) * 1440 + (+(m[4] || 0)) * 60 + (+(m[5] || 0)) + Math.round((+(m[6] || 0)) / 60);
    return m[1] === '-' ? total : -total;
}

/** An .ics text to { name, color, source, refresh, events, tasks } (apps/calendar parseIcs). */
function parseIcs(text) {
    const lines = String(text || '').replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
    const cal = { name: '', color: '', source: '', refresh: 0, events: [], tasks: [] };
    let cur = null;
    let alarm = null;
    for (const line of lines) {
        if (!line) continue;
        const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
        if (colon < 0) continue;
        const head = line.slice(0, colon);
        const value = line.slice(colon + 1);
        const semi = head.indexOf(';');
        const name = (semi < 0 ? head : head.slice(0, semi)).toUpperCase();
        const params = semi < 0 ? '' : head.slice(semi + 1);
        if (name === 'BEGIN') {
            const what = value.toUpperCase();
            if (what === 'VEVENT') cur = { kind: 'event', exdates: [] };
            else if (what === 'VTODO') cur = { kind: 'task' };
            else if (what === 'VALARM' && cur) alarm = {};
            continue;
        }
        if (name === 'END') {
            const what = value.toUpperCase();
            if (what === 'VALARM' && cur && alarm) {
                if (alarm.at && cur.reminderAt === undefined) cur.reminderAt = alarm.at;
                else if (alarm.minutes !== undefined && cur.reminder === undefined) cur.reminder = alarm.minutes;
                alarm = null;
            } else if ((what === 'VEVENT' || what === 'VTODO') && cur) {
                if (cur.kind === 'event' && cur.start) {
                    if (!cur.end) cur.end = cur.allDay ? addDays(cur.start, 1) : new Date(cur.start.getTime() + (cur.duration || 0));
                    cal.events.push(cur);
                } else if (cur.kind === 'task') cal.tasks.push(cur);
                cur = null;
            }
            continue;
        }
        if (alarm) {
            if (name === 'TRIGGER') {
                if (/VALUE=DATE-TIME/i.test(params)) { const p = parseIcsDate(value, ''); if (p) alarm.at = p.date; } else alarm.minutes = durationMinutes(value);
            }
            continue;
        }
        if (!cur) {
            if (name === 'X-WR-CALNAME') cal.name = icsUnescape(value);
            else if (name === 'X-MELATON-COLOR' || name === 'X-APPLE-CALENDAR-COLOR') cal.color = value.slice(0, 7);
            else if (name === 'X-MELATON-SOURCE') cal.source = value;
            else if (name === 'X-MELATON-REFRESH') cal.refresh = parseInt(value, 10) || 0;
            continue;
        }
        switch (name) {
            case 'UID': cur.uid = value; break;
            case 'SUMMARY': cur.summary = icsUnescape(value); break;
            case 'LOCATION': cur.location = icsUnescape(value); break;
            case 'DTSTART': { const p = parseIcsDate(value, params); if (p) { cur.start = p.date; cur.allDay = p.allDay; } break; }
            case 'DTEND': { const p = parseIcsDate(value, params); if (p) cur.end = p.date; break; }
            case 'DURATION': cur.duration = durationMinutes(value) * -60000; break;
            case 'DUE': { const p = parseIcsDate(value, params); if (p) cur.due = p.date; break; }
            case 'RRULE': cur.rrule = parseRrule(value); break;
            case 'EXDATE': value.split(',').forEach((x) => { const p = parseIcsDate(x, params); if (p) cur.exdates.push(p.date.getTime()); }); break;
            case 'STATUS': if (cur.kind === 'task') cur.completed = value.toUpperCase() === 'COMPLETED'; break;
            case 'COMPLETED': if (cur.kind === 'task') cur.completed = true; break;
            case 'PERCENT-COMPLETE': if (cur.kind === 'task' && parseInt(value, 10) >= 100) cur.completed = true; break;
            default:
        }
    }
    return cal;
}

/** The month's day for a MONTHLY rule: BYMONTHDAY n / -n, BYDAY nXX / -nXX, else the start's date. */
function monthlyDate(year, month, r, s0) {
    const first = new Date(year, month, 1);
    const y = first.getFullYear();
    const m = first.getMonth();
    const last = new Date(y, m + 1, 0).getDate();
    let day;
    if (r.bypos && r.byday && r.byday.length) {
        const wd = DAY_CODES.indexOf(r.byday[0]);
        if (r.bypos > 0) day = 1 + ((wd - first.getDay() + 7) % 7) + (r.bypos - 1) * 7;
        else { const lastWd = new Date(y, m, last).getDay(); day = last - ((lastWd - wd + 7) % 7) + (r.bypos + 1) * 7; }
    } else if (r.bymonthday) day = r.bymonthday > 0 ? r.bymonthday : last + 1 + r.bymonthday;
    else day = s0.getDate();
    if (day < 1 || day > last) return null;
    return new Date(y, m, day, s0.getHours(), s0.getMinutes(), s0.getSeconds());
}

/** The event's occurrences that touch [a, b): { ev, start, end } each (apps/calendar occurrences). */
function occurrences(ev, a, b) {
    const out = [];
    const len = ev.end - ev.start;
    const ex = new Set(ev.exdates || []);
    const push = (s) => { if (!ex.has(s.getTime()) && s < b && new Date(s.getTime() + Math.max(len, 1)) > a) out.push({ ev, start: s, end: new Date(s.getTime() + len) }); };
    const r = ev.rrule;
    if (!r) { push(ev.start); return out; }
    const step = r.interval || 1;
    let n = 0;
    const limit = r.count || Infinity;
    const until = r.until ? r.until.getTime() : Infinity;
    const s0 = ev.start;
    for (let i = 0; i < 4000 && n < limit; i += 1) {
        let cands;
        if (r.freq === 'DAILY') cands = [addDays(s0, i * step)];
        else if (r.freq === 'WEEKLY') {
            const weekStart = addDays(s0, i * 7 * step - s0.getDay());
            const days = r.byday && r.byday.length ? r.byday.map((c) => DAY_CODES.indexOf(c)).filter((x) => x >= 0).sort() : [s0.getDay()];
            cands = days.map((dd) => addDays(weekStart, dd)).filter((x) => x >= s0);
        } else if (r.freq === 'MONTHLY') {
            const c = monthlyDate(s0.getFullYear(), s0.getMonth() + i * step, r, s0);
            cands = c && c >= s0 ? [c] : [];
        } else if (r.freq === 'YEARLY') cands = [new Date(s0.getFullYear() + i * step, s0.getMonth(), s0.getDate(), s0.getHours(), s0.getMinutes())];
        else cands = i ? [] : [s0];
        if (!cands.length && r.freq !== 'MONTHLY') break;
        let past = false;
        for (const c of cands) {
            if (c.getTime() > until || n >= limit) { past = true; break; }
            n += 1;
            if (c >= b) { past = true; break; }
            push(c);
        }
        if (past) break;
    }
    return out;
}

// ------------------------------------------------------------------ wording (Windows Mobile's reminder)

const WD3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
function clock(d) { return `${d.getHours() % 12 || 12}:${pad(d.getMinutes())}`; }
function timeText(d) { return `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`; }
const dayText = (d) => `${WD3[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
const dateText = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;

/** The appointment's time line: "10:00 AM-11:00 AM" today, "Tue 11/17 10:00 AM-11:00 AM", "All Day". */
function whenText(start, end, allDay, now) {
    const today = sameDay(start, now);
    if (allDay) return today ? 'All Day' : `${dayText(start)} All Day`;
    const span = `${timeText(start)}-${sameDay(start, end) || +end - +start <= 0 ? '' : `${dayText(end)} `}${timeText(end)}`;
    return today ? span : `${dayText(start)} ${span}`;
}

// ------------------------------------------------------------------ the store (fired, snoozed)

function database() {
    if (db) return db;
    const Database = require('better-sqlite3');
    let file = process.env.REMINDER_DB;
    if (!file) {
        let dir = null;
        try { dir = gr && gr.getPath ? gr.getPath('databases') : null; } catch (_e) { dir = null; }
        file = path.join(dir || path.join(__dirname, '..', '.cache'), 'reminders.db');
    }
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 4000');
    db.exec(`
        CREATE TABLE IF NOT EXISTS fired (id TEXT PRIMARY KEY, at INTEGER NOT NULL, firedAt INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS snoozed (id TEXT PRIMARY KEY, at INTEGER NOT NULL, notice TEXT NOT NULL);
    `);
    return db;
}

const isFired = (id) => !!database().prepare('SELECT 1 FROM fired WHERE id = ?').get(id);
function markFired(id, at) {
    database().prepare('INSERT INTO fired (id, at, firedAt) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET at = excluded.at, firedAt = excluded.firedAt').run(id, at, nowFn());
}
const snoozedRows = () => database().prepare('SELECT * FROM snoozed ORDER BY at').all();

// ------------------------------------------------------------------ the calendars

function hiddenCalendars() {
    try {
        const reg = gr && gr.getConfig ? gr.getConfig({ path: 'userGlobalSettings' }) : null;
        const key = reg && reg.registry && reg.registry[REG_KEY];
        const v = key && key.Hidden;
        const list = Array.isArray(v) ? v : JSON.parse(v || '[]');
        return new Set(Array.isArray(list) ? list.map(String) : []);
    } catch (_e) {
        return new Set();
    }
}

/** Every workspace's Calendars/*.ics: [{ fileId, name, workspace, hash, text }]. */
async function readCalendarFiles() {
    const vdb = require('./vfsDatabase');
    const wsm = gr && gr.getWorkspaceManager ? gr.getWorkspaceManager() : null;
    const workspaces = Object.keys((wsm && wsm.getWorkspaces && wsm.getWorkspaces()) || {});
    const dir = gr.getPath('userFiles');
    const out = [];
    for (const workspace of workspaces) {
        const folders = (await vdb.getFoldersByParent('workspace', workspace, null)) || [];
        for (const folder of folders.filter((f) => String(f.name || '').toLowerCase() === 'calendars')) {
            const files = (await vdb.getUserFilesByLocation('workspace', workspace, folder.id)) || [];
            for (const f of files) {
                if (!/\.ics$/i.test(f.original_name || '') || f.trashed_at) continue;
                let text = null;
                if (!textCache.has(f.content_hash)) {
                    try { text = await fs.promises.readFile(path.join(dir, f.content_hash), 'utf8'); } catch (_e) { continue; }
                }
                out.push({ fileId: f.id, name: f.original_name, workspace, hash: f.content_hash, text });
            }
        }
    }
    return out;
}

function parsedOf(file) {
    const key = file.hash || null;
    if (key && textCache.has(key)) return textCache.get(key);
    const cal = parseIcs(file.text || '');
    if (key) {
        textCache.set(key, cal);
        if (textCache.size > 200) textCache.delete(textCache.keys().next().value);
    }
    return cal;
}

/** The reminders due in [from, to): [{ id, at, notice }] sorted by at. */
function computeReminders(files, from, to) {
    const now = new Date(nowFn());
    const hidden = hiddenCalendars();
    const out = [];
    for (const file of files) {
        const cal = parsedOf(file);
        if (/^phone:/i.test(cal.source || '')) continue; // the phone's own calendars: Android reminds of them
        const calName = cal.name || String(file.name || 'Calendar').replace(/\.ics$/i, '');
        if (hidden.has(calName)) continue;
        const base = { fileId: file.fileId, calendar: calName, workspace: file.workspace || null };
        for (const ev of cal.events) {
            if (!ev.uid || !ev.start) continue;
            const add = (o, at) => {
                if (!(at >= from && at < to)) return;
                const subject = ev.summary || 'No Subject';
                const when = whenText(o.start, ev.allDay ? new Date(+o.end - DAY) : o.end, !!ev.allDay, now);
                const lines = [subject, when, ev.location || ''].filter(Boolean);
                out.push({
                    id: `rem:${file.fileId}:${ev.uid}:${o.start.getTime()}`,
                    at,
                    notice: {
                        app: 'calendar',
                        cls: 'reminder',
                        title: `${clock(new Date(at))} | Reminder`,
                        text: lines.join('\n'),
                        actions: ['dismiss', 'snooze'],
                        data: Object.assign({ app: 'calendar', kind: 'reminder', uid: ev.uid, start: o.start.getTime(), end: o.end.getTime(), allDay: !!ev.allDay, subject, when, location: ev.location || '' }, base),
                        expiresAt: Math.max(o.end.getTime(), at + HOUR),
                    },
                });
            };
            if (ev.reminderAt) {
                // "On date": one reminder at that moment (Calendar's checkReminders)
                add({ start: ev.start, end: ev.end }, ev.reminderAt.getTime());
                continue;
            }
            if (ev.reminder === null || ev.reminder === undefined) continue;
            const lead = ev.reminder * MIN;
            occurrences(ev, new Date(from + lead), new Date(to + lead)).forEach((o) => add(o, o.start.getTime() - lead));
        }
        for (const t of cal.tasks) {
            if (!t.uid || t.completed || !t.reminderAt) continue;
            const at = t.reminderAt.getTime();
            if (!(at >= from && at < to)) continue;
            const subject = t.summary || 'No Subject';
            const when = t.due ? `Due: ${dateText(t.due)}` : '';
            out.push({
                id: `rem:task:${t.uid}:${at}`,
                at,
                notice: {
                    app: 'tasks',
                    cls: 'reminder',
                    title: `${clock(new Date(at))} | Reminder`,
                    text: [subject, when].filter(Boolean).join('\n'),
                    actions: ['dismiss', 'snooze'],
                    data: Object.assign({ app: 'tasks', kind: 'reminder', task: true, uid: t.uid, start: at, due: t.due ? t.due.getTime() : null, subject, when, location: '' }, base),
                    expiresAt: at + DAY,
                },
            });
        }
    }
    return out.sort((a, b) => a.at - b.at);
}

// ------------------------------------------------------------------ firing

function inbox() {
    return require('./notificationInbox').bind(gr);
}

function publishNotice(id, notice) {
    try {
        return inbox().publish(Object.assign({ user: USER, id }, notice));
    } catch (e) {
        console.warn(`[reminders] publish ${id}: ${e.message}`);
        return null;
    }
}

function fire(item) {
    markFired(item.id, item.at); // first: a failing publish must not loop
    const out = publishNotice(item.id, item.notice);
    console.log(`[reminders] ${out ? 'fired' : 'skipped (expired)'} ${item.id} due ${new Date(item.at).toISOString()}`);
    return out;
}

function fireSnoozed(row) {
    database().prepare('DELETE FROM snoozed WHERE id = ?').run(row.id);
    let notice = null;
    try { notice = JSON.parse(row.notice); } catch (_e) { return null; }
    if (!notice) return null;
    notice.title = `${clock(new Date(nowFn()))} | Reminder`;
    if (notice.expiresAt && notice.expiresAt <= nowFn()) notice.expiresAt = nowFn() + HOUR; // snoozed past its end: still shown a while
    const out = publishNotice(row.id, notice);
    console.log(`[reminders] snooze over: ${row.id}`);
    return out;
}

async function scan() {
    const now = nowFn();
    const files = await (source || readCalendarFiles)();
    items = computeReminders(files, now - CATCHUP_MS, now + HORIZON_MS);
    lastScanAt = now;
    lastError = null;
    try { database().prepare('DELETE FROM fired WHERE at < ?').run(now - FIRED_KEEP_MS); } catch (_e) { /* best effort */ }
}

/** Rescan, fire what is due, arm the timer for the next one. */
async function tick() {
    if (running) { again = true; return running; }
    running = (async () => {
        try {
            await scan();
        } catch (e) {
            // the VFS not up yet (boot), or a bad read: try again in a minute
            lastError = e.message;
            console.warn(`[reminders] scan failed: ${e.message}`);
            arm(MIN);
            return;
        }
        const now = nowFn();
        for (const it of items) {
            if (it.at > now) break;
            if (it.at >= now - CATCHUP_MS && !isFired(it.id)) fire(it);
        }
        for (const row of snoozedRows()) if (row.at <= now) fireSnoozed(row);
        arm();
    })();
    try { await running; } finally {
        running = null;
        if (again) { again = false; await tick(); }
    }
    return undefined;
}

/** The single timer: the next reminder (or snooze) due, else when the window rolls on. */
function arm(ms) {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!started) return;
    let wait = ms;
    if (wait === undefined) {
        const now = nowFn();
        let next = Infinity;
        for (const it of items) if (it.at > now && !isFired(it.id)) { next = it.at; break; }
        for (const row of snoozedRows()) if (row.at < next) next = row.at;
        wait = Math.min(MAX_WAIT_MS, Math.max(250, next - now));
    }
    timer = setTimeout(() => { timer = null; tick(); }, Math.min(wait, 24 * HOUR));
    if (timer.unref) timer.unref();
}

/** A calendar file may have changed (vfsDatabase.onUserFilesChanged): rescan shortly. */
function changed(info) {
    if (!started) return;
    if (info && info.name && !/\.ics$/i.test(String(info.name))) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { debounce = null; tick(); }, DEBOUNCE_MS);
    if (debounce.unref) debounce.unref();
}

/**
 * Put a reminder off (the page's Snooze, the desktop Calendar's Snooze): it is cleared now (the phones
 * take theirs down) and comes back with the same id at `at` (or in `minutes`).
 */
function snooze(user, id, { minutes, at } = {}) {
    const key = String(id || '');
    if (!/^rem:/.test(key)) return { ok: false, error: 'not a reminder' };
    const u = user === 'dev_admin' ? 'dev_admin' : USER;
    if (u !== USER) return { ok: false, error: 'no reminders for this user' };
    const when = Number.isFinite(Number(at)) && Number(at) > nowFn() ? Number(at) : nowFn() + Math.max(1, Math.min(20160, Number(minutes) || 5)) * MIN;
    let notice = null;
    const held = inbox().list(u, { includeCleared: true }).find((n) => n.id === key);
    if (held) notice = { app: held.app, cls: held.cls, title: held.title, text: held.text, actions: held.actions, data: held.data, expiresAt: held.expiresAt };
    else {
        const it = items.find((x) => x.id === key);
        if (it) notice = it.notice;
    }
    if (!notice) return { ok: false, error: 'reminder not found' };
    database().prepare('INSERT INTO snoozed (id, at, notice) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET at = excluded.at, notice = excluded.notice').run(key, when, JSON.stringify(notice));
    // never fires again from the calendar (it was already shown; snoozed before it fired: it waits for the snooze)
    database().prepare('INSERT OR IGNORE INTO fired (id, at, firedAt) VALUES (?, ?, ?)').run(key, when, nowFn());
    try { inbox().clear(u, key, 'snooze'); } catch (_e) { /* best effort */ }
    arm();
    return { ok: true, at: when };
}

/** A reminder dismissed elsewhere (the desktop Calendar): it never fires, and its notice is cleared. */
function dismiss(user, id) {
    const key = String(id || '');
    if (!/^rem:/.test(key)) return { ok: false };
    // the household's reminders only: a dev_admin test tab must not silence the phone's
    if ((user === 'dev_admin' ? 'dev_admin' : USER) !== USER) return { ok: false, error: 'no reminders for this user' };
    database().prepare('DELETE FROM snoozed WHERE id = ?').run(key);
    const it = items.find((x) => x.id === key);
    markFired(key, it ? it.at : nowFn());
    let cleared = false;
    try { cleared = inbox().clear(USER, key, 'calendar'); } catch (_e) { cleared = false; }
    arm();
    return { ok: true, cleared };
}

/** Start once (the inbox handler's registerPackets): first scan when the VFS is up. */
function start(globalResources, { delayMs = 15000 } = {}) {
    if (globalResources) gr = globalResources;
    if (started || process.env.REMINDER_SCHEDULER_OFF) return module.exports;
    started = true;
    try {
        const vdb = require('./vfsDatabase');
        if (typeof vdb.onUserFilesChanged === 'function') unhook = vdb.onUserFilesChanged(changed);
    } catch (e) { console.warn(`[reminders] no VFS change hook: ${e.message}`); }
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
    const now = nowFn();
    return {
        started,
        lastScanAt,
        lastError,
        next: items.filter((it) => it.at > now && !isFired(it.id)).slice(0, 10).map((it) => ({ id: it.id, at: it.at, title: it.notice.title, text: it.notice.text })),
        snoozed: snoozedRows().map((r) => ({ id: r.id, at: r.at })),
    };
}

module.exports = {
    start,
    stop,
    tick,
    changed,
    snooze,
    dismiss,
    status,
    parseIcs,
    occurrences,
    computeReminders,
    _test: {
        setNow: (fn) => { nowFn = fn || (() => Date.now()); },
        setSource: (fn) => { source = fn || null; },
        bind: (g) => { gr = g; },
        startNoTimer: () => { started = true; },
        timerDelay: () => (timer ? timer._idleTimeout : null),
        items: () => items,
        reset: () => {
            stop();
            if (db) db.close();
            db = null;
            items = [];
            textCache.clear();
            running = null;
            again = false;
        },
    },
};
