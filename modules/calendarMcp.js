'use strict';

/**
 * Calendar items for agents (Yukimi, Nov 24 2026: "we need a add calendar item tool so it does not risk
 * damaging the calendar ... it needs its own calendar file that's used for that"). Plaud Actions (Yozora)
 * and any agent with the vfs scope add appointments and tasks through these tools instead of rewriting
 * an .ics with vfs_write.
 *
 *   calendar_add_items    VEVENTs / VTODOs into the agents' OWN calendar file only:
 *                         /Workspaces/<ws>/Calendars/<name>.ics (default "Yozora" in the Default workspace).
 *                         The file carries X-MELATON-OWNER:agents; a file without it (Yukimi's calendars,
 *                         the phone's mirrors, subscriptions) is never written. Items merge by UID: an item
 *                         whose UID is there already is skipped (or replaced with replace: true); nothing else
 *                         in the file changes. One write at a time per file (in-process lock: read, merge,
 *                         write back), through the same vfs_upload_file packet vfs_write uses.
 *   calendar_list_items   events and tasks of every calendar in a workspace's Calendars folder (read-only),
 *                         filtered by text / dates: so an agent checks before it adds (e.g. "plaud:<id>").
 *
 * One calendar set for the host (#1157): always the Default workspace's Calendars folder, read by every
 * workspace, Calendar, the phone's Calendar, Tasks and Today. Calendar, the phone's Calendar and Tasks edit the
 * owned file like any other: every .ics save goes through calendarMerge.js in vfs_replace_file (a three-way
 * merge by UID under CAL_LOCK, the lock addItems holds), so a stale window never overwrites an agent's items.
 *
 * Times: start / end / due as "YYYY-MM-DD" (all-day / date only), "YYYY-MM-DDTHH:MM" (wall time in
 * timezone, default America/New_York, written as UTC), or a full ISO time with Z / an offset.
 */

const crypto = require('crypto');

const OWNER = 'agents';
const DEFAULT_CALENDAR = 'Yozora';
const DEFAULT_WORKSPACE = 'default';
const DEFAULT_TZ = 'America/New_York';
const COLOR = '#ddccff';
const MAX_FILE = 2 * 1024 * 1024;
const MAX_ITEMS = 50;

const str = (description) => ({ type: 'string', description });

const ITEM_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'summary'],
    properties: {
        kind: { type: 'string', enum: ['event', 'task'] },
        uid: str('Stable id, so adding the same item again is skipped (e.g. plaud-<recording>-<n>@dreamscape). Made from the content when omitted'),
        summary: str('Title'),
        start: str('Event start: YYYY-MM-DD (all day), YYYY-MM-DDTHH:MM (wall time in timezone) or ISO with Z / offset'),
        end: str('Event end (default: start + 1 hour, or the next day for all-day)'),
        due: str('Task due date / time (same forms as start)'),
        location: str('Where'),
        description: str('Notes: the quote it came from and the source (e.g. source plaud:<id>)'),
        priority: { type: 'number', description: 'Task priority 1 (high) .. 9 (low); 5 normal' },
        categories: { type: 'array', items: { type: 'string' }, description: 'Project or area' },
        url: str('Link (an issue, a recording)'),
        reminderMinutes: { type: 'number', description: 'Event reminder, minutes before start' }
    }
};

function tool(name, description, properties, required) {
    return { name, core: true, scope: 'vfs', description, inputSchema: { type: 'object', additionalProperties: false, required: required || [], properties } };
}

const TOOLS = [
    tool('calendar_add_items', 'Add appointments (event) and to-dos (task) to the agents\' own calendar file (default "Yozora" in the Default workspace\'s Calendars folder; made on first use). Never writes any other calendar. Items merge by UID: one already there is skipped unless replace. Use this, never vfs_write, for calendar items. It shows in Calendar and Tasks on the desktop and phone, where it can be edited (every save is merged on the server).', {
        items: { type: 'array', items: ITEM_SCHEMA, description: `Up to ${MAX_ITEMS} items` },
        calendar: str('The agents\' calendar to write (default Yozora). Only a calendar agents own; letters, digits, space, - and _'),
        workspace: str('Ignored: there is one calendar set for the host (the Default workspace\'s Calendars folder)'),
        timezone: str('IANA zone for wall times (default America/New_York)'),
        replace: { type: 'boolean', description: 'Replace an item whose UID is there already (default: skip it)' }
    }, ['items']),
    tool('calendar_list_items', 'Events and tasks of every calendar in a workspace (read-only): Yukimi\'s, the phone\'s mirrors, subscriptions and the agents\' own. Filter by text (summary, description, location, UID: e.g. "plaud:<id>") and dates, to check before adding.', {
        workspace: str('Ignored: there is one calendar set for the host (the Default workspace\'s Calendars folder)'),
        calendar: str('Only this calendar (its name)'),
        search: str('Text to find (case-insensitive)'),
        from: str('YYYY-MM-DD: items on or after'),
        to: str('YYYY-MM-DD: items on or before'),
        kind: { type: 'string', enum: ['event', 'task', 'all'] },
        limit: { type: 'number', description: 'Default 100, max 500' }
    })
];
const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));
const isCalendarTool = (name) => TOOL_NAMES.has(name);

// ---------------------------------------------------------------- iCalendar text

const esc = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const unesc = (s) => String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const pad = (n) => String(n).padStart(2, '0');

/** Lines folded at 75 octets (RFC 5545 3.1). */
function fold(line) {
    const out = [];
    let rest = line;
    while (Buffer.byteLength(rest, 'utf8') > 75) {
        let cut = 75;
        while (Buffer.byteLength(rest.slice(0, cut), 'utf8') > 75) cut -= 1;
        out.push(rest.slice(0, cut));
        rest = ` ${rest.slice(cut)}`;
    }
    out.push(rest);
    return out.join('\r\n');
}
const unfold = (text) => String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');

/** The offset (ms) of an IANA zone at a UTC instant. */
function zoneOffset(tz, utcMs) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs));
    const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour, +v.minute, +v.second) - utcMs;
}

/** "YYYY-MM-DD" -> { date }, wall time -> { utc ms } (through tz), ISO with zone -> { utc ms }. */
function parseWhen(value, tz) {
    const v = String(value || '').trim();
    if (!v) return null;
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (m) return { allDay: true, y: +m[1], mo: +m[2], d: +m[3] };
    m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v);
    if (m) {
        try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch (_) { throw new Error(`Unknown timezone ${tz}`); }
        const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
        let utc = wall - zoneOffset(tz, wall);
        utc = wall - zoneOffset(tz, utc); // across a DST change
        return { allDay: false, utc };
    }
    const t = Date.parse(v);
    if (Number.isFinite(t) && /[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) return { allDay: false, utc: t };
    throw new Error(`Cannot read the time "${v}" (YYYY-MM-DD, YYYY-MM-DDTHH:MM, or ISO with Z / an offset)`);
}
const utcStamp = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; };
const dateStamp = (w) => `${w.y}${pad(w.mo)}${pad(w.d)}`;
const nextDay = (w) => { const t = new Date(Date.UTC(w.y, w.mo - 1, w.d + 1)); return { allDay: true, y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const prop = (name, w) => (w.allDay ? `${name};VALUE=DATE:${dateStamp(w)}` : `${name}:${utcStamp(w.utc)}`);

function uidOf(item) {
    if (item.uid) {
        const u = String(item.uid).trim();
        if (!/^[\w.@:+-]{3,200}$/.test(u)) throw new Error(`uid ${u.slice(0, 40)} has characters a UID cannot (letters, digits and . @ : + - _ only)`);
        return u;
    }
    const h = crypto.createHash('sha256').update(JSON.stringify([item.kind, item.summary, item.start || item.due || '', item.description || ''])).digest('hex').slice(0, 20);
    return `agent-${h}@dreamscape`;
}

/** One item as VEVENT / VTODO lines (unfolded). */
function componentLines(item, tz, nowMs) {
    const kind = item.kind === 'task' ? 'task' : 'event';
    const summary = String(item.summary || '').trim();
    if (!summary) throw new Error('An item needs a summary');
    const L = [kind === 'event' ? 'BEGIN:VEVENT' : 'BEGIN:VTODO', `UID:${uidOf(item)}`, `DTSTAMP:${utcStamp(nowMs)}`, `SUMMARY:${esc(summary.slice(0, 300))}`];
    if (kind === 'event') {
        const start = parseWhen(item.start, tz);
        if (!start) throw new Error(`"${summary.slice(0, 60)}": an event needs a start`);
        let end = item.end ? parseWhen(item.end, tz) : null;
        if (!end) end = start.allDay ? nextDay(start) : { allDay: false, utc: start.utc + 3600e3 };
        if (end.allDay !== start.allDay) throw new Error(`"${summary.slice(0, 60)}": start and end must both be dates or both times`);
        if ((end.allDay ? Date.UTC(end.y, end.mo - 1, end.d) : end.utc) <= (start.allDay ? Date.UTC(start.y, start.mo - 1, start.d) : start.utc)) throw new Error(`"${summary.slice(0, 60)}": the end is not after the start`);
        L.push(prop('DTSTART', start), prop('DTEND', end));
    } else {
        if (item.due) L.push(prop('DUE', parseWhen(item.due, tz)));
        if (item.start) L.push(prop('DTSTART', parseWhen(item.start, tz)));
        const p = Number(item.priority);
        if (Number.isFinite(p) && p >= 1 && p <= 9) L.push(`PRIORITY:${Math.round(p)}`);
        L.push('STATUS:NEEDS-ACTION');
    }
    if (item.location) L.push(`LOCATION:${esc(String(item.location).slice(0, 300))}`);
    if (item.description) L.push(`DESCRIPTION:${esc(String(item.description).slice(0, 4000))}`);
    if (Array.isArray(item.categories) && item.categories.length) L.push(`CATEGORIES:${item.categories.slice(0, 8).map((c) => esc(String(c).slice(0, 60))).join(',')}`);
    if (item.url && /^https?:\/\//i.test(String(item.url))) L.push(`URL:${String(item.url).slice(0, 500)}`);
    const rm = Number(item.reminderMinutes);
    if (kind === 'event' && Number.isFinite(rm) && rm >= 0 && rm <= 40320) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary.slice(0, 200))}`, `TRIGGER:-PT${Math.round(rm)}M`, 'END:VALARM');
    L.push(kind === 'event' ? 'END:VEVENT' : 'END:VTODO');
    return { uid: L[1].slice(4), kind, lines: L };
}

function newCalendar(name) {
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dreamscape//Agents Calendar//EN', 'CALSCALE:GREGORIAN',
        `X-WR-CALNAME:${esc(name)}`, `X-MELATON-COLOR:${COLOR}`, `X-MELATON-OWNER:${OWNER}`, 'END:VCALENDAR'];
}

/** The file as header lines, components ({ uid, kind, lines }) and the closing line. */
function splitCalendar(text) {
    const lines = unfold(text).filter((l) => l.length);
    if (!/^BEGIN:VCALENDAR$/i.test(lines[0] || '') || !/^END:VCALENDAR$/i.test(lines[lines.length - 1] || '')) throw new Error('Not an iCalendar file (BEGIN / END:VCALENDAR)');
    const header = [];
    const comps = [];
    let cur = null;
    let depth = 0;
    lines.slice(1, -1).forEach((l) => {
        const b = /^BEGIN:(\w+)/i.exec(l);
        const e = /^END:(\w+)/i.exec(l);
        if (!cur && b && /^(VEVENT|VTODO|VJOURNAL|VTIMEZONE|VFREEBUSY)$/i.test(b[1])) { cur = { type: b[1].toUpperCase(), lines: [l], uid: '' }; depth = 1; return; }
        if (!cur) { header.push(l); return; }
        cur.lines.push(l);
        if (b) depth += 1;
        if (e) depth -= 1;
        if (depth === 1 && /^UID[;:]/i.test(l)) cur.uid = l.slice(l.indexOf(':') + 1).trim();
        if (depth === 0) { comps.push(cur); cur = null; }
    });
    if (cur) throw new Error('A component is not closed');
    return { header, comps };
}

const ownerOf = (header) => { const l = header.find((x) => /^X-MELATON-OWNER[;:]/i.test(x)); return l ? l.slice(l.indexOf(':') + 1).trim() : ''; };
const joinCalendar = (header, comps) => ['BEGIN:VCALENDAR', ...header, ...comps.flatMap((c) => c.lines), 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';

/**
 * Merges items into an owned calendar's text (or a new one). Answers { text, added, replaced, skipped }.
 * Pure: the tool and the tests use it.
 */
function mergeItems(text, name, items, opts = {}) {
    const { header, comps } = splitCalendar(text || newCalendar(name).join('\r\n'));
    if (ownerOf(header) !== OWNER) throw new Error(`${name} is not an agents' calendar (no X-MELATON-OWNER:${OWNER}): it is never written. Use another calendar name`);
    const now = opts.now || Date.now();
    const tz = opts.timezone || DEFAULT_TZ;
    const out = { added: [], replaced: [], skipped: [] };
    const made = items.map((it) => componentLines(it, tz, now));
    const seen = new Set();
    made.forEach((c) => {
        if (seen.has(c.uid)) throw new Error(`UID ${c.uid} is given twice`);
        seen.add(c.uid);
        const at = comps.findIndex((x) => x.uid === c.uid);
        if (at >= 0 && !opts.replace) { out.skipped.push(c.uid); return; }
        const comp = { type: c.kind === 'task' ? 'VTODO' : 'VEVENT', uid: c.uid, lines: c.lines };
        if (at >= 0) { comps[at] = comp; out.replaced.push(c.uid); } else { comps.push(comp); out.added.push(c.uid); }
    });
    return Object.assign(out, { text: joinCalendar(header, comps) });
}

/** The events and tasks of one .ics text, flattened for listing. */
function readItems(text, calName) {
    let parsed;
    try { parsed = splitCalendar(text); } catch (_) { return { name: calName, items: [], owner: '' }; }
    const hdr = (k) => { const l = parsed.header.find((x) => new RegExp(`^${k}[;:]`, 'i').test(x)); return l ? unesc(l.slice(l.indexOf(':') + 1)) : ''; };
    const name = hdr('X-WR-CALNAME') || calName;
    const when = (line) => {
        if (!line) return null;
        const v = line.slice(line.indexOf(':') + 1).trim();
        const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
        if (!m) return v;
        if (m[4] === undefined) return `${m[1]}-${m[2]}-${m[3]}`;
        return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}${m[7] ? 'Z' : ''}`;
    };
    const items = parsed.comps.filter((c) => c.type === 'VEVENT' || c.type === 'VTODO').map((c) => {
        const top = c.lines.filter((l, i) => i === 0 || !/^(BEGIN|END):VALARM/i.test(l));
        const get = (k) => top.find((l) => new RegExp(`^${k}[;:]`, 'i').test(l));
        const val = (k) => { const l = get(k); return l ? unesc(l.slice(l.indexOf(':') + 1)) : ''; };
        return {
            calendar: name,
            kind: c.type === 'VTODO' ? 'task' : 'event',
            uid: c.uid,
            summary: val('SUMMARY'),
            start: when(get('DTSTART')),
            end: when(get('DTEND')),
            due: when(get('DUE')),
            location: val('LOCATION') || undefined,
            description: val('DESCRIPTION').slice(0, 600) || undefined,
            status: val('STATUS') || undefined,
            rrule: val('RRULE') || undefined
        };
    });
    return { name, items, owner: ownerOf(parsed.header), source: hdr('X-MELATON-SOURCE') };
}

// ---------------------------------------------------------------- the tools (VFS through the facade's packets)

const locks = new Map(); // lock key -> promise of the write in progress (every calendar write shares CAL_LOCK)
const CAL_LOCK = 'calendars';
function withLock(key, fn) {
    const prev = locks.get(key) || Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    const tail = run.catch(() => {});
    locks.set(key, tail);
    tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
    return run;
}

function safeName(n) {
    const name = String(n || DEFAULT_CALENDAR).trim();
    if (!/^[\w][\w -]{0,39}$/.test(name) || /^phone\b/i.test(name)) throw new Error('calendar: letters, digits, space, - and _ (up to 40), not starting with "Phone"');
    return name;
}
/** One calendar set for the host (#1157): the Default workspace's Calendars folder, whatever workspace is asked for. */
function safeWorkspace() {
    return DEFAULT_WORKSPACE;
}

async function listFolder(ctx, folder) {
    const p = await ctx.dispatchPacketTool(ctx.gr, ctx.req, 'vfs_list_directory', { path: folder, limit: 500 });
    if (!p.success) return null;
    return ((p.data && p.data.items) || []).filter((i) => i && i.kind !== 'folder' && /\.ics$/i.test(i.name || ''));
}

async function readText(ctx, item) {
    const id = item.targetId || item.id;
    const file = await ctx.gr.getVfsDatabase().getUserFileById(id);
    if (!file || !file.content_hash) throw new Error(`${item.name}: its content is missing`);
    if (Number(file.size) > MAX_FILE) throw new Error(`${item.name} is larger than 2 MB`);
    const fs = require('fs');
    return fs.promises.readFile(ctx.gr.getVfsManager().getFileBlobPath(file.content_hash), 'utf8');
}

async function ensureFolder(ctx, ws) {
    const root = `/Workspaces/${ws}`;
    const p = await ctx.dispatchPacketTool(ctx.gr, ctx.req, 'vfs_list_directory', { path: root, search: 'Calendars', limit: 50 });
    if (!p.success) throw new Error(p.error || `No workspace ${ws}`);
    const has = ((p.data && p.data.items) || []).some((i) => i && i.name === 'Calendars' && (i.kind === 'folder' || i.targetKind === 'vfs-folder'));
    if (!has) {
        const mk = await ctx.dispatchPacketTool(ctx.gr, ctx.req, 'vfs_create_folder', { path: root, name: 'Calendars' });
        if (!mk.success) throw new Error(mk.error || 'Could not make the Calendars folder');
    }
    return `${root}/Calendars`;
}

async function addItems(ctx, input) {
    const items = Array.isArray(input.items) ? input.items : [];
    if (!items.length) throw new Error('No items');
    if (items.length > MAX_ITEMS) throw new Error(`At most ${MAX_ITEMS} items per call`);
    const name = safeName(input.calendar);
    const ws = safeWorkspace(input.workspace);
    const tz = String(input.timezone || DEFAULT_TZ);
    const fileName = `${name}.ics`;
    return withLock(CAL_LOCK, async () => {
        const folder = await ensureFolder(ctx, ws);
        const files = (await listFolder(ctx, folder)) || [];
        const existing = files.find((f) => String(f.name).toLowerCase() === fileName.toLowerCase());
        const text = existing ? await readText(ctx, existing) : '';
        const merged = mergeItems(text, name, items, { replace: input.replace === true, timezone: tz });
        if (merged.added.length || merged.replaced.length) {
            const up = await ctx.dispatchPacketTool(ctx.gr, ctx.req, 'vfs_upload_file', {
                path: folder, fileData: Buffer.from(merged.text, 'utf8').toString('base64'),
                originalFilename: existing ? existing.name : fileName, overwrite: true, mimeType: 'text/calendar'
            });
            if (!up.success) throw new Error(up.error || 'Could not write the calendar');
        }
        return { calendar: name, path: `${folder}/${existing ? existing.name : fileName}`, created: !existing, added: merged.added, replaced: merged.replaced, skipped: merged.skipped };
    });
}

async function listItems(ctx, input) {
    const ws = safeWorkspace(input.workspace);
    const folder = `/Workspaces/${ws}/Calendars`;
    const files = await listFolder(ctx, folder);
    if (!files) return { workspace: ws, calendars: [], items: [], note: 'No Calendars folder in this workspace' };
    const search = String(input.search || '').toLowerCase();
    const from = input.from ? String(input.from).slice(0, 10) : '';
    const to = input.to ? String(input.to).slice(0, 10) : '';
    const kind = input.kind === 'event' || input.kind === 'task' ? input.kind : 'all';
    const limit = Math.max(1, Math.min(500, Number(input.limit) || 100));
    const calendars = [];
    let items = [];
    for (const f of files) {
        let r;
        try { r = readItems(await readText(ctx, f), f.name.replace(/\.ics$/i, '')); } catch (e) { calendars.push({ name: f.name, error: e.message }); continue; }
        if (input.calendar && r.name.toLowerCase() !== String(input.calendar).toLowerCase()) continue;
        calendars.push({ name: r.name, file: f.name, items: r.items.length, agents: r.owner === OWNER, phoneMirror: /^phone:/.test(r.source || ''), subscribed: !!r.source && !/^phone:/.test(r.source) });
        items = items.concat(r.items);
    }
    items = items.filter((it) => {
        if (kind !== 'all' && it.kind !== kind) return false;
        const day = String(it.start || it.due || '').slice(0, 10);
        if (from && day && day < from) return false;
        if (to && day && day > to) return false;
        if (search && ![it.summary, it.description, it.location, it.uid].some((x) => String(x || '').toLowerCase().includes(search))) return false;
        return true;
    }).sort((a, b) => String(a.start || a.due || '9').localeCompare(String(b.start || b.due || '9')));
    return { workspace: ws, calendars, total: items.length, items: items.slice(0, limit) };
}

async function handleCalendarTool(ctx, name, args) {
    const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    const result = (obj, isError) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }], isError: isError === true });
    try {
        const out = name === 'calendar_add_items' ? await addItems(ctx, input) : await listItems(ctx, input);
        return result(Object.assign({ success: true }, out));
    } catch (e) {
        return result({ success: false, error: (e && e.message) || 'Failed' }, true);
    }
}

module.exports = { TOOLS, isCalendarTool, handleCalendarTool, mergeItems, readItems, parseWhen, OWNER, withLock, CAL_LOCK, splitCalendar, joinCalendar, _test: { splitCalendar, componentLines, fold } };
