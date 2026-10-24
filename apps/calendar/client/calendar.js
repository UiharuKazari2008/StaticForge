/**
 * Windows Calendar (Yozora #632), Vista's WinCal.exe as a Melaton system package (apps/calendar).
 *
 *   the window      File / Edit / View / Share / Help; New Appointment, New Task, Delete, Today, View,
 *                   Subscribe, Print, Search; the Navigation pane (the date, Calendars, Tasks), the view
 *                   (Day, Work Week, Week, Month), the Details pane of what is selected
 *   the data        each calendar is a real iCalendar file in the workspace's Calendars folder
 *                   (Workspaces/<ws>/Calendars/<name>.ics): VEVENTs (all-day, recurring RRULE with
 *                   EXDATEs, VALARM reminders) and VTODOs; its colour and subscription ride along as
 *                   X-WR-CALNAME / X-MELATON-COLOR / X-MELATON-SOURCE
 *   Subscribe       a webcal / https .ics read through the server (/calendar-feed), kept read-only,
 *                   refreshed on its interval
 *   Reminders       Vista's Windows Calendar Reminders window (Dismiss, Snooze) while Calendar runs
 *   File            Import / Export .ics; Share > Send via E-mail (Dovecote, the .ics attached)
 *
 *   melatonApps.define('calendar', start)
 */
(function (root) {
    'use strict';

    const doc = document;
    const KEY = 'HKCU\\Software\\Xyridian\\Melaton\\Windows Calendar';
    const reg = (n, d) => (root.melatonRegistry ? root.melatonRegistry.get(KEY, n, d) : d);
    const setReg = (v) => { if (root.melatonRegistry) void root.melatonRegistry.set(KEY, v); };
    const ICON16 = '/static_images/app_icons/16/vista-calendar.webp';
    const ICON24 = '/static_images/app_icons/24/vista-calendar.webp';
    const CMD = '/static_images/vista-cmdbar';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const vfs = () => root.vfsClient || (typeof vfsClient !== 'undefined' ? vfsClient : null); // eslint-disable-line no-undef

    // Vista's calendar colours, in its order
    const COLORS = [['#4b7cc5', 'Blue'], ['#d24726', 'Red'], ['#5ea32f', 'Green'], ['#8c5aa8', 'Purple'], ['#e3961d', 'Orange'], ['#3aa4b1', 'Teal'], ['#c94d8f', 'Pink'], ['#827b71', 'Gray']];
    const DAY = 86400000;
    const SLOT = 20; // px per half hour
    const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const REMINDERS = [[null, 'None'], [0, 'On start date'], [5, '5 minutes before'], [10, '10 minutes before'], [15, '15 minutes before'], [30, '30 minutes before'], [60, '1 hour before'], [120, '2 hours before'], [1440, '1 day before'], [2880, '2 days before'], [10080, '1 week before']];
    const RECUR = [['', 'Once'], ['DAILY', 'Daily'], ['WEEKLY', 'Weekly'], ['MONTHLY', 'Monthly'], ['YEARLY', 'Yearly']];

    // ---- dates -------------------------------------------------------------------------------

    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds());
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const pad = (n) => String(n).padStart(2, '0');
    function timeText(d) {
        const h = d.getHours() % 12 || 12;
        return `${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
    }
    const dateText = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    const longDate = (d) => `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    const inputDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const inputTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    function fromInputs(date, time) {
        const [y, m, dd] = String(date).split('-').map(Number);
        const [h, mi] = String(time || '00:00').split(':').map(Number);
        return new Date(y, (m || 1) - 1, dd || 1, h || 0, mi || 0);
    }

    // ---- iCalendar ---------------------------------------------------------------------------

    const icsEscape = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
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

    const icsDate = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const icsUtc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

    function parseRrule(v) {
        const r = {};
        String(v || '').split(';').forEach((part) => {
            const [k, val] = part.split('=');
            if (!k || val === undefined) return;
            const key = k.toUpperCase();
            if (key === 'FREQ') r.freq = val.toUpperCase();
            else if (key === 'INTERVAL') r.interval = Math.max(1, parseInt(val, 10) || 1);
            else if (key === 'COUNT') r.count = parseInt(val, 10) || null;
            else if (key === 'UNTIL') { const p = parseIcsDate(val); r.until = p ? p.date : null; } else if (key === 'BYDAY') r.byday = val.split(',').map((x) => x.replace(/^[+-]?\d+/, '').toUpperCase());
        });
        return r.freq ? r : null;
    }

    function rruleText(r) {
        if (!r || !r.freq) return '';
        let s = `FREQ=${r.freq}`;
        if (r.interval > 1) s += `;INTERVAL=${r.interval}`;
        if (r.count) s += `;COUNT=${r.count}`;
        if (r.until) s += `;UNTIL=${icsUtc(r.until)}`;
        if (r.byday && r.byday.length) s += `;BYDAY=${r.byday.join(',')}`;
        return s;
    }

    /** An .ics text to { name, color, source, refresh, events, tasks }. */
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
                    if (alarm.minutes !== undefined && cur.reminder === undefined) cur.reminder = alarm.minutes;
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
                if (name === 'TRIGGER') alarm.minutes = durationMinutes(value);
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
                case 'DESCRIPTION': cur.description = icsUnescape(value); break;
                case 'URL': cur.url = value; break;
                case 'DTSTART': { const p = parseIcsDate(value, params); if (p) { cur.start = p.date; cur.allDay = p.allDay; } break; }
                case 'DTEND': { const p = parseIcsDate(value, params); if (p) cur.end = p.date; break; }
                case 'DURATION': cur.duration = durationMinutes(value) * -60000; break;
                case 'DUE': { const p = parseIcsDate(value, params); if (p) cur.due = p.date; break; }
                case 'RRULE': cur.rrule = parseRrule(value); break;
                case 'EXDATE': value.split(',').forEach((x) => { const p = parseIcsDate(x, params); if (p) cur.exdates.push(p.date.getTime()); }); break;
                case 'PRIORITY': cur.priority = parseInt(value, 10) || 0; break;
                case 'STATUS': if (cur.kind === 'task') cur.completed = value.toUpperCase() === 'COMPLETED'; break;
                case 'COMPLETED': if (cur.kind === 'task') cur.completed = true; break;
                case 'PERCENT-COMPLETE': if (cur.kind === 'task' && parseInt(value, 10) >= 100) cur.completed = true; break;
                default:
            }
        }
        return cal;
    }

    /** "-PT15M" -> 15 (minutes before); "PT0S" -> 0. */
    function durationMinutes(v) {
        const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(String(v || '').trim());
        if (!m) return 0;
        const total = (+(m[2] || 0)) * 10080 + (+(m[3] || 0)) * 1440 + (+(m[4] || 0)) * 60 + (+(m[5] || 0)) + Math.round((+(m[6] || 0)) / 60);
        return m[1] === '-' ? total : -total;
    }

    function fold(line) {
        const out = [];
        let s = line;
        while (s.length > 74) { out.push(s.slice(0, 74)); s = ` ${s.slice(74)}`; }
        out.push(s);
        return out.join('\r\n');
    }

    function toIcs(cal) {
        const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Xyridian//Windows Calendar for Melaton//EN', 'CALSCALE:GREGORIAN',
            `X-WR-CALNAME:${icsEscape(cal.name)}`, `X-MELATON-COLOR:${cal.color}`];
        if (cal.source) L.push(`X-MELATON-SOURCE:${cal.source}`, `X-MELATON-REFRESH:${cal.refresh || 0}`);
        const stamp = icsUtc(new Date());
        cal.events.forEach((e) => {
            L.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`);
            if (e.allDay) L.push(`DTSTART;VALUE=DATE:${icsDate(e.start)}`, `DTEND;VALUE=DATE:${icsDate(e.end)}`);
            else L.push(`DTSTART:${icsUtc(e.start)}`, `DTEND:${icsUtc(e.end)}`);
            L.push(`SUMMARY:${icsEscape(e.summary)}`);
            if (e.location) L.push(`LOCATION:${icsEscape(e.location)}`);
            if (e.description) L.push(`DESCRIPTION:${icsEscape(e.description)}`);
            if (e.url) L.push(`URL:${e.url}`);
            if (e.rrule) L.push(`RRULE:${rruleText(e.rrule)}`);
            (e.exdates || []).forEach((x) => L.push(e.allDay ? `EXDATE;VALUE=DATE:${icsDate(new Date(x))}` : `EXDATE:${icsUtc(new Date(x))}`));
            if (e.reminder !== null && e.reminder !== undefined) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(e.summary)}`, `TRIGGER:${e.reminder ? `-PT${e.reminder}M` : 'PT0S'}`, 'END:VALARM');
            L.push('END:VEVENT');
        });
        cal.tasks.forEach((t) => {
            L.push('BEGIN:VTODO', `UID:${t.uid}`, `DTSTAMP:${stamp}`, `SUMMARY:${icsEscape(t.summary)}`);
            if (t.start) L.push(`DTSTART;VALUE=DATE:${icsDate(t.start)}`);
            if (t.due) L.push(`DUE;VALUE=DATE:${icsDate(t.due)}`);
            if (t.priority) L.push(`PRIORITY:${t.priority}`);
            if (t.completed) L.push('STATUS:COMPLETED', 'PERCENT-COMPLETE:100');
            if (t.description) L.push(`DESCRIPTION:${icsEscape(t.description)}`);
            if (t.url) L.push(`URL:${t.url}`);
            L.push('END:VTODO');
        });
        L.push('END:VCALENDAR');
        return `${L.map(fold).join('\r\n')}\r\n`;
    }

    const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}@melaton`;

    /** The event's occurrences that touch [a, b): { ev, start, end } each. */
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
        const codes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
        for (let i = 0; i < 4000 && n < limit; i += 1) {
            let cands;
            if (r.freq === 'DAILY') cands = [addDays(s0, i * step)];
            else if (r.freq === 'WEEKLY') {
                const weekStart = addDays(s0, i * 7 * step - s0.getDay());
                const days = r.byday && r.byday.length ? r.byday.map((c) => codes.indexOf(c)).filter((x) => x >= 0).sort() : [s0.getDay()];
                cands = days.map((dd) => addDays(weekStart, dd)).filter((x) => x >= s0);
            } else if (r.freq === 'MONTHLY') cands = [new Date(s0.getFullYear(), s0.getMonth() + i * step, s0.getDate(), s0.getHours(), s0.getMinutes())].filter((x) => x.getDate() === s0.getDate());
            else if (r.freq === 'YEARLY') cands = [new Date(s0.getFullYear() + i * step, s0.getMonth(), s0.getDate(), s0.getHours(), s0.getMinutes())];
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

    // ---- files --------------------------------------------------------------------------------

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
            r.onerror = () => reject(r.error);
            r.readAsDataURL(blob);
        });
    }

    const textB64 = (t) => blobToBase64(new Blob([t], { type: 'text/calendar' }));

    function workspaceRoot() {
        const ws = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : 'Default'; // eslint-disable-line no-undef
        return `/Workspaces/${ws}`;
    }

    function userName() {
        const a = root.meletonAccounts;
        const n = (a && typeof a.displayName === 'function' && a.displayName()) || (a && typeof a.name === 'function' && a.name()) || (root.localStorage && root.localStorage.getItem('username')) || '';
        return n || 'My';
    }

    // ---- the app ------------------------------------------------------------------------------

    class Calendar {
        constructor(app) {
            this.app = app;
            this.calendars = [];
            this.view = reg('View', 'day');
            this.date = startOfDay(new Date());
            this.navMonth = new Date(this.date.getFullYear(), this.date.getMonth(), 1);
            this.sel = null; // { kind: 'event' | 'task' | 'calendar', item, cal, occ }
            this.saveTimers = new Map();
            this.fired = new Set();
            this.search = '';
            this.build();
            void this.load();
            this.tick = setInterval(() => { this.checkReminders(); this.refreshSubscriptions(false); }, 30000);
        }

        // ---- loading and saving ----------------------------------------------------------

        folder() { return `${workspaceRoot()}/Calendars`; }

        async load() {
            this.status('Opening your calendars...');
            const V = vfs();
            let items = [];
            // a folder that is not there is a server error (and its exception window): look first
            let has = false;
            try {
                const top = await V.listDirectory(workspaceRoot(), { offset: 0, limit: 500 });
                has = ((top && top.items) || []).some((i) => i.name === 'Calendars' && (i.kind === 'folder' || i.targetKind === 'vfs-folder'));
            } catch (_) { has = false; }
            if (!has) {
                try { await V.createFolder(workspaceRoot(), 'Calendars'); } catch (_e) { /* not allowed here */ }
            } else {
                try {
                    const res = await V.listDirectory(this.folder(), { offset: 0, limit: 200 });
                    items = (res && res.items) || [];
                } catch (_) { items = []; }
            }
            const files = items.filter((i) => /\.ics$/i.test(i.name || '') && (i.targetKind === 'user-file' || i.kind === 'file'));
            for (const f of files) {
                try {
                    const r = await V.downloadFile(f.id);
                    const text = await (await fetch(r.downloadUrl, { credentials: 'same-origin' })).text();
                    this.adopt(parseIcs(text), { fileId: f.id, fileName: f.name });
                } catch (err) {
                    console.warn('Calendar: could not read', f.name, err);
                }
            }
            if (!this.calendars.length) {
                const cal = this.adopt({ name: `${userName()}'s Calendar`, color: COLORS[0][0], events: [], tasks: [] }, {});
                await this.save(cal);
            }
            const hidden = (() => { try { return JSON.parse(reg('Hidden', '[]')); } catch (_) { return []; } })();
            this.calendars.forEach((c) => { c.visible = !hidden.includes(c.name); });
            this.status('');
            this.render();
            this.checkReminders();
            this.refreshSubscriptions(true);
        }

        adopt(parsed, file) {
            const n = this.calendars.length;
            const cal = {
                id: `c${Date.now().toString(36)}${n}`,
                name: parsed.name || (file.fileName || 'Calendar').replace(/\.ics$/i, ''),
                color: parsed.color || COLORS[n % COLORS.length][0],
                source: parsed.source || '',
                refresh: parsed.refresh || 0,
                fileId: file.fileId || null,
                fileName: file.fileName || null,
                events: [],
                tasks: [],
                visible: true,
                lastRefresh: 0
            };
            cal.readonly = !!cal.source;
            parsed.events.forEach((e) => cal.events.push({ uid: e.uid || uid(), summary: e.summary || '', location: e.location || '', description: e.description || '', url: e.url || '', start: e.start, end: e.end, allDay: !!e.allDay, rrule: e.rrule || null, exdates: e.exdates || [], reminder: e.reminder === undefined ? null : e.reminder }));
            parsed.tasks.forEach((t) => cal.tasks.push({ uid: t.uid || uid(), summary: t.summary || '', due: t.due || null, start: t.start || null, priority: t.priority || 0, completed: !!t.completed, description: t.description || '', url: t.url || '' }));
            this.calendars.push(cal);
            return cal;
        }

        fileNameOf(cal) {
            return `${cal.name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'Calendar'}.ics`;
        }

        /** The calendar's .ics written to its file (a new file the first time). */
        async save(cal) {
            const V = vfs();
            const data = await textB64(toIcs(cal));
            try {
                if (cal.fileId) await V.replaceFile(cal.fileId, data, 'text/calendar');
                else {
                    const res = await V.uploadFile(this.folder(), data, this.fileNameOf(cal), 'text/calendar');
                    const f = res && (res.file || res.entry || res);
                    cal.fileId = (f && (f.id || f.fileId)) || null;
                    cal.fileName = this.fileNameOf(cal);
                }
            } catch (err) {
                this.status(`${cal.name} could not be saved: ${(err && err.message) || err}`);
            }
        }

        touched(cal) {
            if (!cal || cal.readonly) return;
            clearTimeout(this.saveTimers.get(cal.id));
            this.saveTimers.set(cal.id, setTimeout(() => { this.saveTimers.delete(cal.id); void this.save(cal); }, 700));
        }

        async flush() {
            const waits = [];
            for (const [id, t] of this.saveTimers) {
                clearTimeout(t);
                const cal = this.calendars.find((c) => c.id === id);
                if (cal) waits.push(this.save(cal));
            }
            this.saveTimers.clear();
            await Promise.all(waits);
        }

        // ---- the window -------------------------------------------------------------------

        build() {
            const W = Math.min(root.innerWidth - 40, 1040);
            const H = Math.min(root.innerHeight - 80, 700);
            const m = doc.createElement('div');
            m.className = 'modal hidden resizeable-window wcal-window';
            m.dataset.windowIdentifier = 'melatonWindowsCalendar';
            m.dataset.windowClient = 'light';
            m.dataset.taskbarIcon = ICON24;
            m.dataset.windowDefaultWidth = String(W);
            m.dataset.windowDefaultHeight = String(H);
            m.dataset.windowMinWidth = '640';
            m.dataset.windowMinHeight = '420';
            m.style.width = `${W}px`;
            m.style.height = `${H}px`;
            m.setAttribute('role', 'dialog');
            m.setAttribute('aria-label', 'Windows Calendar');
            const btn = (a, label, img, title) => `<button type="button" class="wcal-cmd" data-a="${a}" title="${esc(title || label)}">${img ? `<img src="${CMD}/${img}.png" alt="">` : ''}<span>${label}</span></button>`;
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${ICON16}" alt=""><span>Windows Calendar</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small wcal-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="modal-content win7 wcal-client">
                    <div class="naxt-menubar wcal-menubar" role="menubar">${['File', 'Edit', 'View', 'Share', 'Help'].map((t) => `<button type="button" class="naxt-menu-title" data-wcal-menu="${t.toLowerCase()}" role="menuitem">${t}</button>`).join('')}</div>
                    <div class="wcal-cmdbar" role="toolbar">
                        ${btn('new-appt', 'New Appointment', 'calendar')}
                        ${btn('new-task', 'New Task', 'checklist')}
                        ${btn('delete', 'Delete', 'delete')}
                        <span class="wcal-sep"></span>
                        ${btn('today', 'Today', 'clock')}
                        <button type="button" class="wcal-cmd wcal-view-btn" title="Change the view"><span>View</span><span class="wcal-arrow"></span></button>
                        <span class="wcal-sep"></span>
                        ${btn('subscribe', 'Subscribe...', 'download')}
                        ${btn('print', 'Print', 'document')}
                        <span class="wcal-fill"></span>
                        <label class="wcal-search"><input type="search" placeholder="Search" aria-label="Search"></label>
                    </div>
                    <div class="wcal-body">
                        <div class="wcal-nav">
                            <div class="wcal-nav-head">Date</div>
                            <div class="wcal-mini"></div>
                            <div class="wcal-nav-head">Calendars</div>
                            <div class="wcal-cals"></div>
                            <div class="wcal-nav-head">Tasks</div>
                            <div class="wcal-tasks"></div>
                        </div>
                        <div class="wcal-main">
                            <div class="wcal-view-head"><button type="button" class="wcal-step" data-step="-1" title="Previous"></button><button type="button" class="wcal-step is-next" data-step="1" title="Next"></button><span class="wcal-title"></span></div>
                            <div class="wcal-view"></div>
                        </div>
                        <div class="wcal-details"></div>
                    </div>
                    <div class="wcal-status"></div>
                </div>`;
            doc.body.appendChild(m);
            this.modal = m;
            this.el = (s) => m.querySelector(s);
            this.wire();
            call('openModal', m);
            m.classList.remove('hidden');
            const place = () => {
                const r = m.getBoundingClientRect();
                call('setModalOffsetsFromViewportTopLeft', m, Math.max(0, Math.round((root.innerWidth - r.width) / 2)), Math.max(0, Math.round((root.innerHeight - 35 - r.height) / 2)));
            };
            let placed = false;
            const once = () => { if (!placed) { placed = true; place(); } };
            requestAnimationFrame(once);
            setTimeout(once, 60);
            if (root.programFaults && root.programFaults.registerProgram) {
                m.id = 'melatonWindowsCalendarModal';
                root.programFaults.registerProgram(m.id, { name: 'Windows Calendar', terminate: () => this.app.exit(), relaunch: () => root.melatonApps && root.melatonApps.launch({ packageId: 'calendar' }) });
            }
            this.applyPanes();
            this.render();
        }

        wire() {
            const m = this.modal;
            m.querySelector('.wcal-close').addEventListener('click', () => void this.close());
            m.querySelectorAll('[data-wcal-menu]').forEach((t) => {
                root.contextMenu.attachClickMenuToElement(t, {
                    onAction: (a) => void this.action(a),
                    sections: [{ type: 'list', initfn: (section) => { section.items = this.menu(t.dataset.wcalMenu); } }]
                });
            });
            root.contextMenu.attachClickMenuToElement(m.querySelector('.wcal-view-btn'), {
                onAction: (a) => void this.action(a),
                sections: [{ type: 'list', initfn: (section) => { section.items = this.viewItems(); } }]
            });
            m.querySelectorAll('.wcal-cmd[data-a]').forEach((b) => b.addEventListener('click', () => void this.action(b.dataset.a)));
            m.querySelectorAll('.wcal-step').forEach((b) => b.addEventListener('click', () => this.step(Number(b.dataset.step))));
            const search = m.querySelector('.wcal-search input');
            search.addEventListener('input', () => { this.search = search.value.trim().toLowerCase(); this.render(); });
            m.addEventListener('keydown', (ev) => {
                if (ev.target.closest('input, textarea, select')) return;
                const ctrl = ev.ctrlKey || ev.metaKey;
                let a = null;
                if (ev.key === 'Delete') a = 'delete';
                else if (ctrl && ev.shiftKey && /^[1-4]$/.test(ev.key)) a = ['view-day', 'view-workweek', 'view-week', 'view-month'][Number(ev.key) - 1];
                else if (ctrl && !ev.shiftKey && ev.key.toLowerCase() === 'n') a = 'new-appt';
                else if (ctrl && ev.shiftKey && ev.key.toLowerCase() === 'k') a = 'new-task';
                else if (ctrl && ev.key.toLowerCase() === 't') a = 'today';
                else if (ctrl && ev.key.toLowerCase() === 'p') a = 'print';
                if (!a) return;
                ev.preventDefault();
                ev.stopPropagation();
                void this.action(a);
            });
        }

        viewItems() {
            return [['day', 'Day', 'Ctrl+Shift+1'], ['workweek', 'Work Week', 'Ctrl+Shift+2'], ['week', 'Week', 'Ctrl+Shift+3'], ['month', 'Month', 'Ctrl+Shift+4']]
                .map(([v, t, k]) => ({ text: t, subtext: k, action: `view-${v}`, showIndicator: true, checked: this.view === v }));
        }

        menu(name) {
            const sel = this.sel;
            const editable = sel && sel.cal && !sel.cal.readonly && sel.kind !== 'calendar';
            switch (name) {
                case 'file': return [
                    { text: 'New', hasSubmenu: true, submenu: [
                        { text: 'Appointment', subtext: 'Ctrl+N', action: 'new-appt' },
                        { text: 'Task', subtext: 'Ctrl+Shift+K', action: 'new-task' },
                        { text: 'Calendar', action: 'new-cal' }
                    ] },
                    { separator: true },
                    { text: 'Import...', action: 'import' },
                    { text: 'Export...', action: 'export' },
                    { separator: true },
                    { text: 'Print...', subtext: 'Ctrl+P', action: 'print' },
                    { separator: true },
                    { text: 'Exit', action: 'exit' }
                ];
                case 'edit': return [
                    { text: 'Delete', subtext: 'Del', action: 'delete', disabled: !sel || (sel.cal && sel.cal.readonly && sel.kind !== 'calendar') },
                    { separator: true },
                    { text: 'Find', subtext: 'Ctrl+I', action: 'find' }
                ];
                case 'view': return this.viewItems().concat([
                    { separator: true },
                    { text: 'Today', subtext: 'Ctrl+T', action: 'today' },
                    { separator: true },
                    { text: 'Navigation Pane', action: 'pane-nav', showIndicator: true, checked: reg('NavPane', true) !== false },
                    { text: 'Details Pane', action: 'pane-details', showIndicator: true, checked: reg('DetailsPane', true) !== false }
                ]);
                case 'share': return [
                    { text: 'Subscribe...', action: 'subscribe' },
                    { text: 'Refresh', action: 'refresh', disabled: !this.calendars.some((c) => c.source) },
                    { separator: true },
                    { text: 'Send via E-mail...', action: 'send', disabled: !this.currentCal() }
                ];
                case 'help': return [{ text: 'About Windows Calendar', action: 'about' }];
                default: return [];
            }
            void editable;
        }

        async action(a) {
            if (a.startsWith('view-')) { this.view = a.slice(5); setReg({ View: this.view }); this.render(); return; }
            switch (a) {
                case 'new-appt': this.newAppointment(); return;
                case 'new-task': this.newTask(); return;
                case 'new-cal': this.newCalendar(); return;
                case 'delete': await this.deleteSelected(); return;
                case 'today': this.date = startOfDay(new Date()); this.navMonth = new Date(this.date.getFullYear(), this.date.getMonth(), 1); this.render(); return;
                case 'subscribe': this.subscribeDialog(); return;
                case 'refresh': this.refreshSubscriptions(true, true); return;
                case 'print': this.print(); return;
                case 'import': this.importDialog(); return;
                case 'export': this.exportDialog(); return;
                case 'send': await this.send(); return;
                case 'find': { const s = this.el('.wcal-search input'); if (s) s.focus(); return; }
                case 'pane-nav': setReg({ NavPane: reg('NavPane', true) === false }); this.applyPanes(); return;
                case 'pane-details': setReg({ DetailsPane: reg('DetailsPane', true) === false }); this.applyPanes(); return;
                case 'about': if (typeof root.openAboutMelatoninModal === 'function') root.openAboutMelatoninModal({ program: 'Windows Calendar' }); return;
                case 'exit': await this.close(); return;
                default:
            }
        }

        applyPanes() {
            this.modal.classList.toggle('wcal-no-nav', reg('NavPane', true) === false);
            this.modal.classList.toggle('wcal-no-details', reg('DetailsPane', true) === false);
        }

        status(text) { const s = this.el('.wcal-status'); if (s) s.textContent = text || ''; }

        currentCal() {
            if (this.sel && this.sel.cal) return this.sel.cal;
            return this.calendars.find((c) => !c.readonly) || this.calendars[0] || null;
        }

        writableCal() {
            const c = this.sel && this.sel.cal;
            if (c && !c.readonly) return c;
            return this.calendars.find((x) => !x.readonly && x.visible) || this.calendars.find((x) => !x.readonly) || null;
        }

        // ---- the range shown -------------------------------------------------------------

        range() {
            const d = this.date;
            if (this.view === 'day') return { a: d, b: addDays(d, 1), days: 1 };
            if (this.view === 'month') {
                const first = new Date(d.getFullYear(), d.getMonth(), 1);
                const a = addDays(first, -first.getDay());
                return { a, b: addDays(a, 42), days: 42 };
            }
            const sun = addDays(d, -d.getDay());
            if (this.view === 'workweek') return { a: addDays(sun, 1), b: addDays(sun, 6), days: 5 };
            return { a: sun, b: addDays(sun, 7), days: 7 };
        }

        step(n) {
            if (this.view === 'month') this.date = new Date(this.date.getFullYear(), this.date.getMonth() + n, 1);
            else this.date = addDays(this.date, n * (this.view === 'day' ? 1 : 7));
            this.navMonth = new Date(this.date.getFullYear(), this.date.getMonth(), 1);
            this.render();
        }

        /** Every visible occurrence in [a, b), with its calendar, filtered by the search box. */
        occurrencesIn(a, b) {
            const out = [];
            const q = this.search;
            this.calendars.forEach((cal) => {
                if (!cal.visible) return;
                cal.events.forEach((ev) => {
                    if (q && !`${ev.summary} ${ev.location} ${ev.description}`.toLowerCase().includes(q)) return;
                    occurrences(ev, a, b).forEach((o) => out.push({ ...o, cal }));
                });
            });
            return out.sort((x, y) => x.start - y.start || (y.end - y.start) - (x.end - x.start));
        }

        // ---- rendering ---------------------------------------------------------------------

        render() {
            if (!this.modal) return;
            this.renderMini();
            this.renderCals();
            this.renderTasks();
            this.renderView();
            this.renderDetails();
        }

        renderMini() {
            const host = this.el('.wcal-mini');
            const m0 = this.navMonth;
            const first = addDays(m0, -m0.getDay());
            const today = startOfDay(new Date());
            const { a, b } = this.range();
            let html = `<div class="wcal-mini-head"><button type="button" class="wcal-mini-step" data-m="-1" title="Previous month"></button><span>${MONTHS[m0.getMonth()]} ${m0.getFullYear()}</span><button type="button" class="wcal-mini-step is-next" data-m="1" title="Next month"></button></div><table class="wcal-mini-grid"><tr>${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x) => `<th>${x}</th>`).join('')}</tr>`;
            const busy = new Set(this.occurrencesIn(first, addDays(first, 42)).map((o) => startOfDay(o.start).getTime()));
            for (let r = 0; r < 6; r += 1) {
                html += '<tr>';
                for (let c = 0; c < 7; c += 1) {
                    const d = addDays(first, r * 7 + c);
                    const cls = [d.getMonth() !== m0.getMonth() ? 'is-other' : '', sameDay(d, today) ? 'is-today' : '', d >= a && d < b ? 'is-in' : '', busy.has(d.getTime()) ? 'is-busy' : ''].filter(Boolean).join(' ');
                    html += `<td class="${cls}" data-d="${d.getTime()}">${d.getDate()}</td>`;
                }
                html += '</tr>';
            }
            html += '</table>';
            host.innerHTML = html;
            host.onclick = (ev) => {
                const s = ev.target.closest('[data-m]');
                if (s) { this.navMonth = new Date(m0.getFullYear(), m0.getMonth() + Number(s.dataset.m), 1); this.renderMini(); return; }
                const td = ev.target.closest('[data-d]');
                if (td) { this.date = new Date(Number(td.dataset.d)); this.navMonth = new Date(this.date.getFullYear(), this.date.getMonth(), 1); this.render(); }
            };
        }

        renderCals() {
            const host = this.el('.wcal-cals');
            host.innerHTML = this.calendars.map((c) => `<div class="wcal-cal${this.sel && this.sel.kind === 'calendar' && this.sel.cal === c ? ' is-sel' : ''}" data-id="${c.id}">
                <input type="checkbox" class="wcal-cal-vis"${c.visible ? ' checked' : ''} title="Show this calendar"><span class="wcal-swatch" style="background:${c.color}"></span><span class="wcal-cal-name">${esc(c.name)}</span>${c.source ? '<span class="wcal-sub" title="Subscribed (read-only)"></span>' : ''}</div>`).join('');
            host.onclick = (ev) => {
                const row = ev.target.closest('.wcal-cal');
                if (!row) return;
                const cal = this.calendars.find((c) => c.id === row.dataset.id);
                if (ev.target.closest('.wcal-cal-vis')) {
                    cal.visible = ev.target.checked;
                    setReg({ Hidden: JSON.stringify(this.calendars.filter((c) => !c.visible).map((c) => c.name)) });
                    this.render();
                    return;
                }
                this.select({ kind: 'calendar', cal });
            };
        }

        renderTasks() {
            const host = this.el('.wcal-tasks');
            const list = [];
            this.calendars.forEach((cal) => { if (cal.visible) cal.tasks.forEach((t) => list.push({ t, cal })); });
            list.sort((x, y) => (x.t.completed - y.t.completed) || ((x.t.due || Infinity) - (y.t.due || Infinity)));
            const now = startOfDay(new Date());
            host.innerHTML = list.map(({ t, cal }) => `<div class="wcal-task${this.sel && this.sel.item === t ? ' is-sel' : ''}${t.completed ? ' is-done' : ''}${!t.completed && t.due && t.due < now ? ' is-overdue' : ''}" data-cal="${cal.id}" data-uid="${esc(t.uid)}">
                <input type="checkbox"${t.completed ? ' checked' : ''}${cal.readonly ? ' disabled' : ''} title="Completed"><span class="wcal-swatch" style="background:${cal.color}"></span><span class="wcal-task-name">${esc(t.summary || 'New Task')}</span></div>`).join('');
            host.onclick = (ev) => {
                const row = ev.target.closest('.wcal-task');
                if (!row) return;
                const cal = this.calendars.find((c) => c.id === row.dataset.cal);
                const t = cal && cal.tasks.find((x) => x.uid === row.dataset.uid);
                if (!t) return;
                if (ev.target.matches('input[type=checkbox]')) { t.completed = ev.target.checked; this.touched(cal); this.renderTasks(); this.renderDetails(); return; }
                this.select({ kind: 'task', item: t, cal });
            };
        }

        renderView() {
            const host = this.el('.wcal-view');
            const { a, b, days } = this.range();
            const title = this.el('.wcal-title');
            if (this.view === 'day') title.textContent = longDate(this.date);
            else if (this.view === 'month') title.textContent = `${MONTHS[this.date.getMonth()]} ${this.date.getFullYear()}`;
            else title.textContent = `${MONTHS[a.getMonth()]} ${a.getDate()}, ${a.getFullYear()} - ${MONTHS[addDays(b, -1).getMonth()]} ${addDays(b, -1).getDate()}, ${addDays(b, -1).getFullYear()}`;
            if (this.view === 'month') { this.renderMonth(host, a); return; }
            const occ = this.occurrencesIn(a, b);
            const allDay = occ.filter((o) => o.ev.allDay || o.end - o.start >= DAY);
            const timed = occ.filter((o) => !(o.ev.allDay || o.end - o.start >= DAY));
            const today = startOfDay(new Date());
            const cols = [];
            for (let i = 0; i < days; i += 1) cols.push(addDays(a, i));
            const workStart = 8;
            const workEnd = 17;
            let html = `<div class="wcal-grid-head" style="--cols:${days}"><div class="wcal-gutter"></div>${cols.map((d) => `<div class="wcal-colhead${sameDay(d, today) ? ' is-today' : ''}" data-d="${d.getTime()}">${days === 1 ? WEEKDAYS[d.getDay()] : `${WEEKDAYS[d.getDay()].slice(0, 3)} ${d.getMonth() + 1}/${d.getDate()}`}</div>`).join('')}</div>`;
            html += `<div class="wcal-allday" style="--cols:${days}"><div class="wcal-gutter"></div>${cols.map((d) => `<div class="wcal-allday-col" data-d="${d.getTime()}">${allDay.filter((o) => o.start < addDays(d, 1) && o.end > d).map((o) => this.chip(o, true)).join('')}</div>`).join('')}</div>`;
            html += `<div class="wcal-scroll"><div class="wcal-hours" style="--cols:${days}"><div class="wcal-gutter">${Array.from({ length: 24 }, (_, h) => `<div class="wcal-hour-label" style="height:${SLOT * 2}px">${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}</div>`).join('')}</div>`;
            html += cols.map((d) => {
                const slots = Array.from({ length: 48 }, (_, s) => {
                    const h = s / 2;
                    const work = d.getDay() > 0 && d.getDay() < 6 && h >= workStart && h < workEnd;
                    return `<div class="wcal-slot${work ? ' is-work' : ''}${s % 2 ? ' is-half' : ''}" data-t="${d.getTime() + s * 1800000}"></div>`;
                }).join('');
                const mine = timed.filter((o) => o.start < addDays(d, 1) && o.end > d);
                // overlapping appointments share the column side by side
                const lanes = [];
                const placed = mine.map((o) => {
                    let lane = lanes.findIndex((end) => end <= o.start);
                    if (lane < 0) { lane = lanes.length; lanes.push(o.end); } else lanes[lane] = o.end;
                    return { o, lane };
                });
                const n = Math.max(1, lanes.length);
                const items = placed.map(({ o, lane }) => {
                    const s = Math.max(o.start, d);
                    const e = Math.min(o.end, addDays(d, 1));
                    const top = ((s - d) / 1800000) * SLOT;
                    const h = Math.max(SLOT - 2, ((e - s) / 1800000) * SLOT - 2);
                    return this.chip(o, false, `top:${top}px;height:${h}px;left:calc(${(lane / n) * 100}% + 1px);width:calc(${100 / n}% - 6px)`);
                }).join('');
                const nowLine = sameDay(d, new Date()) ? `<div class="wcal-now" style="top:${((Date.now() - d) / 1800000) * SLOT}px"></div>` : '';
                return `<div class="wcal-col" data-d="${d.getTime()}">${slots}${items}${nowLine}</div>`;
            }).join('');
            html += '</div></div>';
            host.className = 'wcal-view is-grid';
            host.innerHTML = html;
            const sc = host.querySelector('.wcal-scroll');
            // a new day or view opens at 8 AM (Vista); a redraw of the same one keeps its scroll
            const at = `${this.view}|${a.getTime()}`;
            if (sc && this.scrolledFor !== at) { sc.scrollTop = SLOT * 2 * 8 - 4; this.scrolledFor = at; } else if (sc && this.scrollTop !== undefined) sc.scrollTop = this.scrollTop;
            if (sc) sc.addEventListener('scroll', () => { this.scrollTop = sc.scrollTop; });
            this.wireGrid(host);
        }

        chip(o, allDay, style = '') {
            const s = this.sel;
            const on = s && s.kind === 'event' && s.item === o.ev && (!s.occ || s.occ.start.getTime() === o.start.getTime());
            const label = `${allDay ? '' : `<span class="wcal-chip-time">${timeText(o.start)}</span> `}${esc(o.ev.summary || 'New Appointment')}${o.ev.location ? ` <span class="wcal-chip-loc">(${esc(o.ev.location)})</span>` : ''}`;
            return `<div class="wcal-chip${allDay ? ' is-allday' : ''}${on ? ' is-sel' : ''}${o.ev.rrule ? ' is-recur' : ''}" style="--c:${o.cal.color};${style}" data-cal="${o.cal.id}" data-uid="${esc(o.ev.uid)}" data-s="${o.start.getTime()}" title="${esc(`${o.ev.summary || 'New Appointment'}\n${allDay ? 'All day' : `${timeText(o.start)} - ${timeText(o.end)}`}${o.ev.location ? `\n${o.ev.location}` : ''}`)}">${label}${allDay || o.cal.readonly ? '' : '<div class="wcal-chip-grip"></div>'}</div>`;
        }

        findOcc(el) {
            const cal = this.calendars.find((c) => c.id === el.dataset.cal);
            const ev = cal && cal.events.find((x) => x.uid === el.dataset.uid);
            if (!ev) return null;
            const start = new Date(Number(el.dataset.s));
            return { cal, ev, occ: { start, end: new Date(start.getTime() + (ev.end - ev.start)) } };
        }

        wireGrid(host) {
            // a click picks a time; a drag over empty time makes a new appointment of that length;
            // dragging an appointment moves it, its bottom edge sets its end (15-minute steps)
            host.onpointerdown = (ev) => {
                if (ev.button !== 0) return;
                const chip = ev.target.closest('.wcal-chip');
                if (chip) {
                    const f = this.findOcc(chip);
                    if (!f) return;
                    this.select({ kind: 'event', item: f.ev, cal: f.cal, occ: f.occ });
                    if (f.cal.readonly || chip.classList.contains('is-allday')) return;
                    const grip = ev.target.closest('.wcal-chip-grip');
                    this.drag = { mode: grip ? 'resize' : 'move', f, y0: ev.clientY, x0: ev.clientX, moved: false, s0: f.ev.start, e0: f.ev.end };
                    host.setPointerCapture(ev.pointerId);
                    return;
                }
                const slot = ev.target.closest('.wcal-slot');
                if (slot) {
                    this.drag = { mode: 'new', t0: Number(slot.dataset.t), t1: Number(slot.dataset.t) + 1800000 };
                    host.setPointerCapture(ev.pointerId);
                    this.paintPick(host);
                    return;
                }
                const ad = ev.target.closest('.wcal-allday-col, .wcal-colhead');
                if (ad) { this.date = new Date(Number(ad.dataset.d)); this.select(null); }
            };
            host.onpointermove = (ev) => {
                const g = this.drag;
                if (!g) return;
                const slotAt = () => {
                    const el = doc.elementFromPoint(ev.clientX, ev.clientY);
                    const s = el && el.closest && el.closest('.wcal-slot');
                    return s ? Number(s.dataset.t) : null;
                };
                if (g.mode === 'new') {
                    const t = slotAt();
                    if (t === null) return;
                    g.t1 = Math.max(t + 1800000, g.t0 + 1800000);
                    this.paintPick(host);
                    return;
                }
                const dy = ev.clientY - g.y0;
                const q = Math.round(dy / (SLOT / 2)) * 900000; // 15 minutes
                if (Math.abs(dy) > 3 || Math.abs(ev.clientX - g.x0) > 3) g.moved = true;
                if (!g.moved) return;
                const e = g.f.ev;
                if (g.mode === 'resize') e.end = new Date(Math.max(e.start.getTime() + 900000, g.e0.getTime() + q));
                else {
                    // a move across days follows the column under the pointer
                    const el = doc.elementFromPoint(ev.clientX, ev.clientY);
                    const col = el && el.closest && el.closest('.wcal-col');
                    const dayShift = col ? Math.round((Number(col.dataset.d) - startOfDay(g.f.occ.start).getTime()) / DAY) : 0;
                    const len = g.e0 - g.s0;
                    e.start = new Date(addDays(g.s0, dayShift).getTime() + q);
                    e.end = new Date(e.start.getTime() + len);
                }
                this.sel.occ = null;
                this.renderView();
            };
            host.onpointerup = () => {
                const g = this.drag;
                this.drag = null;
                if (!g) return;
                if (g.mode === 'new') {
                    this.pick = { start: new Date(g.t0), end: new Date(g.t1) };
                    this.date = startOfDay(new Date(g.t0));
                    this.select(null);
                    if (g.t1 - g.t0 > 1800000) this.newAppointment();
                    return;
                }
                if (g.moved) { this.touched(g.f.cal); this.render(); }
            };
            host.ondblclick = (ev) => {
                if (ev.target.closest('.wcal-chip')) { const t = this.modal.querySelector('.wcal-d-title'); if (t) t.focus(); return; }
                const slot = ev.target.closest('.wcal-slot');
                if (slot) { const t = Number(slot.dataset.t); this.pick = { start: new Date(t), end: new Date(t + 3600000) }; this.newAppointment(); }
                const ad = ev.target.closest('.wcal-allday-col');
                if (ad) { const d = new Date(Number(ad.dataset.d)); this.pick = { start: d, end: addDays(d, 1), allDay: true }; this.newAppointment(); }
            };
        }

        paintPick(host) {
            const g = this.drag || this.pickRange;
            host.querySelectorAll('.wcal-slot.is-pick').forEach((s) => s.classList.remove('is-pick'));
            if (!g) return;
            host.querySelectorAll('.wcal-slot').forEach((s) => { const t = Number(s.dataset.t); if (t >= g.t0 && t < g.t1) s.classList.add('is-pick'); });
        }

        renderMonth(host, a) {
            const occ = this.occurrencesIn(a, addDays(a, 42));
            const today = startOfDay(new Date());
            let html = `<div class="wcal-month-head">${WEEKDAYS.map((w) => `<div>${w}</div>`).join('')}</div><div class="wcal-month">`;
            for (let i = 0; i < 42; i += 1) {
                const d = addDays(a, i);
                const mine = occ.filter((o) => o.start < addDays(d, 1) && o.end > d);
                const shown = mine.slice(0, 4);
                html += `<div class="wcal-day${d.getMonth() !== this.date.getMonth() ? ' is-other' : ''}${sameDay(d, today) ? ' is-today' : ''}" data-d="${d.getTime()}"><div class="wcal-day-num">${d.getDate() === 1 ? `${MONTHS[d.getMonth()].slice(0, 3)} 1` : d.getDate()}</div>${shown.map((o) => this.chip(o, o.ev.allDay)).join('')}${mine.length > shown.length ? `<div class="wcal-more">${mine.length - shown.length} more...</div>` : ''}</div>`;
            }
            html += '</div>';
            host.className = 'wcal-view is-month';
            host.innerHTML = html;
            host.onpointerdown = (ev) => {
                const chip = ev.target.closest('.wcal-chip');
                if (chip) { const f = this.findOcc(chip); if (f) this.select({ kind: 'event', item: f.ev, cal: f.cal, occ: f.occ }); return; }
                const day = ev.target.closest('.wcal-day');
                if (day) { this.date = new Date(Number(day.dataset.d)); this.select(null); }
            };
            host.onpointermove = null;
            host.onpointerup = null;
            host.ondblclick = (ev) => {
                const day = ev.target.closest('.wcal-day');
                if (day && !ev.target.closest('.wcal-chip')) {
                    const more = ev.target.closest('.wcal-more');
                    this.date = new Date(Number(day.dataset.d));
                    if (more) { this.view = 'day'; this.render(); return; }
                    this.pick = { start: this.date, end: addDays(this.date, 1), allDay: true };
                    this.newAppointment();
                }
            };
        }

        select(sel) {
            this.sel = sel;
            this.render();
        }

        // ---- the details pane ---------------------------------------------------------------

        renderDetails() {
            const host = this.el('.wcal-details');
            const s = this.sel;
            if (!s) { host.innerHTML = `<div class="wcal-d-empty">${esc(longDate(this.date))}</div>`; return; }
            const ro = s.cal && s.cal.readonly;
            const calOptions = (cur) => this.calendars.filter((c) => !c.readonly || c === cur).map((c) => `<option value="${c.id}"${c === cur ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
            const dis = ro ? ' disabled' : '';
            if (s.kind === 'calendar') {
                const c = s.cal;
                host.innerHTML = `<div class="wcal-d">
                    <input type="text" class="tbp-edit wcal-d-title" value="${esc(c.name)}"${dis} aria-label="Calendar name">
                    <div class="wcal-d-group">Details</div>
                    <label class="wcal-d-row"><span>Color:</span><select class="wcal-d-color"${dis}>${COLORS.map(([v, t]) => `<option value="${v}"${v === c.color ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
                    ${c.source ? `<div class="wcal-d-group">Subscription Information</div><div class="wcal-d-note">Subscribed to:<br><span class="wcal-d-url">${esc(c.source)}</span></div><label class="wcal-d-row"><span>Refresh:</span><select class="wcal-d-refresh">${[[0, 'No update'], [15, 'Every 15 minutes'], [60, 'Every hour'], [1440, 'Every day'], [10080, 'Every week']].map(([v, t]) => `<option value="${v}"${v === (c.refresh || 0) ? ' selected' : ''}>${t}</option>`).join('')}</select></label>` : ''}
                    <div class="wcal-d-note">${c.events.length} appointment${c.events.length === 1 ? '' : 's'}, ${c.tasks.length} task${c.tasks.length === 1 ? '' : 's'}</div>
                </div>`;
                const name = host.querySelector('.wcal-d-title');
                name.addEventListener('change', () => { const v = name.value.trim(); if (v) { c.name = v; this.touched(c); this.renderCals(); } });
                host.querySelector('.wcal-d-color').addEventListener('change', (ev) => { c.color = ev.target.value; this.touched(c); if (c.readonly) void this.save(c); this.render(); });
                const rf = host.querySelector('.wcal-d-refresh');
                if (rf) rf.addEventListener('change', () => { c.refresh = Number(rf.value); void this.save(c); });
                return;
            }
            if (s.kind === 'task') {
                const t = s.item;
                host.innerHTML = `<div class="wcal-d">
                    <input type="text" class="tbp-edit wcal-d-title" value="${esc(t.summary)}" placeholder="New Task"${dis} aria-label="Title">
                    <label class="wcal-d-row"><span>Calendar:</span><select class="wcal-d-cal"${dis}>${calOptions(s.cal)}</select></label>
                    <label class="wcal-d-row"><span>URL:</span><input type="text" class="tbp-edit wcal-d-url-in" value="${esc(t.url)}"${dis}></label>
                    <div class="wcal-d-group">Task Information</div>
                    <label class="wcal-d-check"><input type="checkbox" class="wcal-d-done"${t.completed ? ' checked' : ''}${dis}><span>Completed</span></label>
                    <label class="wcal-d-row"><span>Priority:</span><select class="wcal-d-pri"${dis}>${[[0, 'None'], [9, 'Low'], [5, 'Medium'], [1, 'High']].map(([v, l]) => `<option value="${v}"${(t.priority || 0) === v || (v === 1 && t.priority > 0 && t.priority < 5) || (v === 9 && t.priority > 5) ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
                    <label class="wcal-d-row"><span>Start:</span><input type="date" class="tbp-edit wcal-d-tstart" value="${t.start ? inputDate(t.start) : ''}"${dis}></label>
                    <label class="wcal-d-row"><span>Due date:</span><input type="date" class="tbp-edit wcal-d-due" value="${t.due ? inputDate(t.due) : ''}"${dis}></label>
                    <div class="wcal-d-group">Notes</div>
                    <textarea class="tbp-edit wcal-d-notes"${dis}>${esc(t.description)}</textarea>
                </div>`;
                const bind = (sel, ev, fn) => { const e = host.querySelector(sel); if (e) e.addEventListener(ev, () => { fn(e); this.touched(s.cal); this.renderTasks(); }); };
                bind('.wcal-d-title', 'input', (e) => { t.summary = e.value; });
                bind('.wcal-d-url-in', 'change', (e) => { t.url = e.value.trim(); });
                bind('.wcal-d-done', 'change', (e) => { t.completed = e.checked; });
                bind('.wcal-d-pri', 'change', (e) => { t.priority = Number(e.value); });
                bind('.wcal-d-tstart', 'change', (e) => { t.start = e.value ? fromInputs(e.value) : null; });
                bind('.wcal-d-due', 'change', (e) => { t.due = e.value ? fromInputs(e.value) : null; });
                bind('.wcal-d-notes', 'input', (e) => { t.description = e.value; });
                this.bindCalMove(host, s, 'tasks');
                return;
            }
            const e = s.item;
            const r = e.rrule;
            host.innerHTML = `<div class="wcal-d">
                <input type="text" class="tbp-edit wcal-d-title" value="${esc(e.summary)}" placeholder="New Appointment"${dis} aria-label="Title">
                <label class="wcal-d-row"><span>Location:</span><input type="text" class="tbp-edit wcal-d-loc" value="${esc(e.location)}"${dis}></label>
                <label class="wcal-d-row"><span>Calendar:</span><select class="wcal-d-cal"${dis}>${calOptions(s.cal)}</select></label>
                <label class="wcal-d-row"><span>URL:</span><input type="text" class="tbp-edit wcal-d-url-in" value="${esc(e.url)}"${dis}></label>
                <div class="wcal-d-group">Appointment Information</div>
                <label class="wcal-d-check"><input type="checkbox" class="wcal-d-allday"${e.allDay ? ' checked' : ''}${dis}><span>All-day appointment</span></label>
                <label class="wcal-d-row"><span>Start:</span><input type="date" class="tbp-edit wcal-d-sd" value="${inputDate(e.start)}"${dis}><input type="time" class="tbp-edit wcal-d-st" value="${inputTime(e.start)}" step="900"${e.allDay ? ' hidden' : ''}${dis}></label>
                <label class="wcal-d-row"><span>End:</span><input type="date" class="tbp-edit wcal-d-ed" value="${inputDate(e.allDay ? addDays(e.end, -1) : e.end)}"${dis}><input type="time" class="tbp-edit wcal-d-et" value="${inputTime(e.end)}" step="900"${e.allDay ? ' hidden' : ''}${dis}></label>
                <label class="wcal-d-row"><span>Recurrence:</span><select class="wcal-d-rec"${dis}>${RECUR.map(([v, t]) => `<option value="${v}"${(r ? r.freq : '') === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
                ${r ? `<div class="wcal-d-note">${esc(recurText(e))}</div>` : ''}
                <div class="wcal-d-group">Reminder</div>
                <label class="wcal-d-row"><span>Reminder:</span><select class="wcal-d-rem"${dis}>${REMINDERS.map(([v, t]) => `<option value="${v === null ? '' : v}"${e.reminder === v || (e.reminder === undefined && v === null) ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
                <div class="wcal-d-group">Notes</div>
                <textarea class="tbp-edit wcal-d-notes"${dis}>${esc(e.description)}</textarea>
            </div>`;
            const changed = (re) => { this.touched(s.cal); if (re) this.render(); else { this.renderView(); this.renderMini(); } };
            const on = (sel, ev, fn, re) => { const el = host.querySelector(sel); if (el) el.addEventListener(ev, () => { fn(el); changed(re); }); };
            on('.wcal-d-title', 'input', (el) => { e.summary = el.value; });
            on('.wcal-d-loc', 'input', (el) => { e.location = el.value; });
            on('.wcal-d-url-in', 'change', (el) => { e.url = el.value.trim(); });
            on('.wcal-d-notes', 'input', (el) => { e.description = el.value; });
            on('.wcal-d-allday', 'change', (el) => {
                e.allDay = el.checked;
                if (e.allDay) { e.start = startOfDay(e.start); e.end = addDays(startOfDay(new Date(Math.max(e.end - 1, e.start))), 1); } else { e.start = new Date(startOfDay(e.start).getTime() + 9 * 3600000); e.end = new Date(e.start.getTime() + 3600000); }
                s.occ = null;
            }, true);
            const times = () => {
                const len = e.end - e.start;
                const sd = host.querySelector('.wcal-d-sd').value;
                const st = host.querySelector('.wcal-d-st').value;
                const ed = host.querySelector('.wcal-d-ed').value;
                const et = host.querySelector('.wcal-d-et').value;
                const ns = e.allDay ? fromInputs(sd) : fromInputs(sd, st);
                let ne = e.allDay ? addDays(fromInputs(ed), 1) : fromInputs(ed, et);
                // a new start keeps the length (Vista); an end before the start moves with it
                if (ns.getTime() !== e.start.getTime()) ne = new Date(ns.getTime() + len);
                if (ne <= ns) ne = new Date(ns.getTime() + (e.allDay ? DAY : 1800000));
                e.start = ns;
                e.end = ne;
                s.occ = null;
            };
            ['.wcal-d-sd', '.wcal-d-st', '.wcal-d-ed', '.wcal-d-et'].forEach((q) => on(q, 'change', times, true));
            on('.wcal-d-rec', 'change', (el) => { e.rrule = el.value ? { freq: el.value, interval: 1, byday: el.value === 'WEEKLY' ? [['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][e.start.getDay()]] : null } : null; e.exdates = []; }, true);
            on('.wcal-d-rem', 'change', (el) => { e.reminder = el.value === '' ? null : Number(el.value); this.fired.delete(`${e.uid}|${e.start.getTime()}`); });
            this.bindCalMove(host, s, 'events');
        }

        /** Moving an item to another calendar (the Calendar box). */
        bindCalMove(host, s, field) {
            const sel = host.querySelector('.wcal-d-cal');
            if (!sel) return;
            sel.addEventListener('change', () => {
                const to = this.calendars.find((c) => c.id === sel.value);
                if (!to || to === s.cal) return;
                s.cal[field] = s.cal[field].filter((x) => x !== s.item);
                to[field].push(s.item);
                this.touched(s.cal);
                this.touched(to);
                s.cal = to;
                this.render();
            });
        }

        // ---- new, delete -------------------------------------------------------------------

        newAppointment() {
            const cal = this.writableCal();
            if (!cal) return;
            const p = this.pick;
            this.pick = null;
            let start;
            let end;
            let allDay = false;
            if (p) { start = p.start; end = p.end; allDay = !!p.allDay; } else {
                const now = new Date();
                const base = sameDay(this.date, now) ? now : new Date(this.date.getTime() + 9 * 3600000);
                start = new Date(Math.ceil(base.getTime() / 1800000) * 1800000);
                end = new Date(start.getTime() + 3600000);
                if (this.view === 'month') { start = this.date; end = addDays(start, 1); allDay = true; }
            }
            const ev = { uid: uid(), summary: '', location: '', description: '', url: '', start, end, allDay, rrule: null, exdates: [], reminder: allDay ? null : 15 };
            cal.events.push(ev);
            this.touched(cal);
            this.date = startOfDay(start);
            this.select({ kind: 'event', item: ev, cal, occ: null });
            const t = this.modal.querySelector('.wcal-d-title');
            if (t) t.focus();
        }

        newTask() {
            const cal = this.writableCal();
            if (!cal) return;
            const t = { uid: uid(), summary: '', due: null, start: null, priority: 0, completed: false, description: '', url: '' };
            cal.tasks.push(t);
            this.touched(cal);
            this.select({ kind: 'task', item: t, cal });
            const el = this.modal.querySelector('.wcal-d-title');
            if (el) el.focus();
        }

        newCalendar() {
            const used = new Set(this.calendars.map((c) => c.color));
            const color = (COLORS.find(([c]) => !used.has(c)) || COLORS[this.calendars.length % COLORS.length])[0];
            let name = 'New Calendar';
            let n = 2;
            while (this.calendars.some((c) => c.name === name)) name = `New Calendar ${n++}`;
            const cal = this.adopt({ name, color, events: [], tasks: [] }, {});
            void this.save(cal);
            this.select({ kind: 'calendar', cal });
            const el = this.modal.querySelector('.wcal-d-title');
            if (el) { el.focus(); el.select(); }
        }

        async ask(html, buttons) {
            return call('showConfirmationDialog', html, buttons.map(([text, value], i) => ({ text, value, className: `btn-standard${i ? '' : ' primary'}` })), null, { title: 'Windows Calendar', width: 420 });
        }

        async deleteSelected() {
            const s = this.sel;
            if (!s) return;
            if (s.kind === 'calendar') {
                const c = s.cal;
                const v = await this.ask(`<p>Are you sure you want to delete the calendar "${esc(c.name)}"?</p><p>All its appointments and tasks are deleted with it.</p>`, [['Delete', 'yes'], ['Cancel', 'no']]);
                if (v !== 'yes') return;
                this.calendars = this.calendars.filter((x) => x !== c);
                if (c.fileId) { try { await vfs().moveToTrash([{ id: c.fileId, type: 'file', kind: 'file', name: c.fileName }], this.folder()); } catch (_) { try { await vfs().deleteEntry(c.fileId); } catch (_e) { /* left as it is */ } } }
                this.select(null);
                return;
            }
            if (s.cal.readonly) { this.status('This calendar is subscribed: it cannot be changed here.'); return; }
            if (s.kind === 'task') {
                s.cal.tasks = s.cal.tasks.filter((x) => x !== s.item);
            } else if (s.item.rrule && s.occ) {
                const v = await this.ask(`<p>"${esc(s.item.summary || 'New Appointment')}" is a recurring appointment.</p><p>Do you want to delete only this occurrence or the series?</p>`, [['Delete this occurrence', 'one'], ['Delete the series', 'all'], ['Cancel', 'no']]);
                if (v === 'one') s.item.exdates = (s.item.exdates || []).concat([s.occ.start.getTime()]);
                else if (v === 'all') s.cal.events = s.cal.events.filter((x) => x !== s.item);
                else return;
            } else s.cal.events = s.cal.events.filter((x) => x !== s.item);
            this.touched(s.cal);
            this.select(null);
        }

        // ---- reminders ------------------------------------------------------------------------

        checkReminders() {
            const now = Date.now();
            const due = [];
            this.calendars.forEach((cal) => {
                if (!cal.visible) return;
                cal.events.forEach((ev) => {
                    if (ev.reminder === null || ev.reminder === undefined) return;
                    occurrences(ev, new Date(now - 6 * 3600000), new Date(now + 8 * DAY)).forEach((o) => {
                        const at = o.start.getTime() - ev.reminder * 60000;
                        const key = `${ev.uid}|${o.start.getTime()}`;
                        const snooze = this.snoozed && this.snoozed.get(key);
                        if (at <= now && o.end.getTime() > now - 3600000 && !this.fired.has(key) && (!snooze || snooze <= now)) due.push({ o, cal, key });
                    });
                });
            });
            if (due.length) this.showReminders(due);
        }

        /** Vista's Windows Calendar Reminders: the list, Dismiss / Dismiss All / Snooze. */
        showReminders(list) {
            const V = root.vistaDialogTemplate;
            this.reminderList = (this.reminderList || []).filter((x) => !list.some((y) => y.key === x.key)).concat(list);
            list.forEach((x) => this.fired.add(x.key));
            if (this.reminderOpen) { this.drawReminders(); return; }
            if (!V) return;
            const tpl = { t: 'Windows Calendar Reminders', w: 260, h: 150, f: ['MS Shell Dlg', 8], c: [
                [101, 'S', 7, 7, 246, 84, 0x5000000e, '', 0],
                [-1, 'S', 7, 98, 246, 8, 0x50020000, 'Click &Snooze to be reminded again in:', 0],
                [102, 'C', 7, 110, 100, 100, 0x50210003, '', 0],
                [103, 'B', 111, 109, 40, 14, 0x50010000, '&Snooze', 0],
                [104, 'B', 157, 109, 46, 14, 0x50010000, '&Dismiss', 0],
                [105, 'B', 207, 109, 46, 14, 0x50010000, 'Dismiss &All', 0],
                [2, 'B', 203, 130, 50, 14, 0x50010000, 'Close', 0]
            ] };
            this.reminderOpen = true;
            if (typeof root.playMelatonSound === 'function') { try { root.playMelatonSound('reminder'); } catch (_) { /* no sound */ } }
            V.openDialog({
                id: 'wcalReminders', tpl, owner: this.modal,
                init: (ctx) => {
                    this.reminderCtx = ctx;
                    const s = ctx.el(102);
                    if (s) s.innerHTML = [[5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [240, '4 hours'], [1440, '1 day']].map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
                    this.drawReminders();
                    const host = ctx.el(101);
                    if (host) host.addEventListener('click', (ev) => { const row = ev.target.closest('[data-k]'); if (row) { this.reminderPick = row.dataset.k; this.drawReminders(); } });
                    const done = (keys, snoozeMin) => {
                        keys.forEach((k) => {
                            if (snoozeMin) { if (!this.snoozed) this.snoozed = new Map(); this.snoozed.set(k, Date.now() + snoozeMin * 60000); this.fired.delete(k); }
                        });
                        this.reminderList = this.reminderList.filter((x) => !keys.includes(x.key));
                        this.reminderPick = null;
                        if (!this.reminderList.length) { const c = ctx.el(2); if (c) c.click(); } else this.drawReminders();
                    };
                    const pickKeys = () => (this.reminderPick ? [this.reminderPick] : this.reminderList.slice(0, 1).map((x) => x.key));
                    ctx.on(103, 'click', () => done(pickKeys(), Number(ctx.get(102)) || 5));
                    ctx.on(104, 'click', () => done(pickKeys(), 0));
                    ctx.on(105, 'click', () => done(this.reminderList.map((x) => x.key), 0));
                },
                cancel: () => { this.reminderOpen = false; },
                close: () => { this.reminderOpen = false; }
            });
        }

        drawReminders() {
            const ctx = this.reminderCtx;
            const host = ctx && ctx.el(101);
            if (!host) return;
            host.classList.add('wcal-rem-list');
            if (!this.reminderPick && this.reminderList.length) this.reminderPick = this.reminderList[0].key;
            host.innerHTML = this.reminderList.map((x) => {
                const o = x.o;
                const mins = Math.round((o.start - Date.now()) / 60000);
                const when = mins > 0 ? `In ${mins >= 60 ? `${Math.round(mins / 60)} hour${Math.round(mins / 60) === 1 ? '' : 's'}` : `${mins} minute${mins === 1 ? '' : 's'}`}` : mins === 0 ? 'Now' : 'Overdue';
                return `<div class="wcal-rem${this.reminderPick === x.key ? ' is-sel' : ''}" data-k="${esc(x.key)}"><span class="wcal-swatch" style="background:${x.cal.color}"></span><span class="wcal-rem-name">${esc(o.ev.summary || 'New Appointment')}</span><span class="wcal-rem-when">${o.ev.allDay ? dateText(o.start) : `${dateText(o.start)} ${timeText(o.start)}`} - ${when}</span></div>`;
            }).join('');
        }

        // ---- subscriptions -----------------------------------------------------------------

        subscribeDialog() {
            const V = root.vistaDialogTemplate;
            if (!V) return;
            const tpl = { t: 'Subscribe to a Calendar', w: 280, h: 110, f: ['MS Shell Dlg', 8], c: [
                [-1, 'S', 7, 7, 266, 16, 0x50020000, 'Enter the location of the calendar you want to subscribe to (webcal:// or https://, an .ics file):', 0],
                [-1, 'S', 7, 30, 80, 8, 0x50020000, '&Calendar to subscribe to:', 0],
                [101, 'E', 7, 41, 266, 12, 0x50810080, '', 0],
                [-1, 'S', 7, 60, 60, 8, 0x50020000, '&Update interval:', 0],
                [102, 'C', 70, 58, 100, 100, 0x50210003, '', 0],
                [103, 'S', 7, 76, 266, 8, 0x50020000, '', 0],
                [1, 'B', 169, 90, 50, 14, 0x50010001, 'Subscribe', 0],
                [2, 'B', 223, 90, 50, 14, 0x50010000, 'Cancel', 0]
            ] };
            V.openDialog({
                id: 'wcalSubscribe', tpl, owner: this.modal,
                init: (ctx) => {
                    const s = ctx.el(102);
                    if (s) { s.innerHTML = [[0, 'No update'], [15, 'Every 15 minutes'], [60, 'Every hour'], [1440, 'Every day'], [10080, 'Every week']].map(([v, t]) => `<option value="${v}">${t}</option>`).join(''); s.value = '1440'; }
                },
                ok: async (ctx) => {
                    const url = String(ctx.get(101) || '').trim();
                    if (!url) return false;
                    ctx.text(103, 'Getting the calendar...');
                    const res = await this.fetchFeed(url);
                    if (res.error) { ctx.text(103, res.error); return false; }
                    const parsed = parseIcs(res.text);
                    const used = new Set(this.calendars.map((c) => c.color));
                    parsed.color = parsed.color || (COLORS.find(([c]) => !used.has(c)) || COLORS[0])[0];
                    parsed.name = parsed.name || url.replace(/^\w+:\/\//, '').split(/[/?#]/)[0];
                    parsed.source = url;
                    parsed.refresh = Number(ctx.get(102)) || 0;
                    const cal = this.adopt(parsed, {});
                    cal.lastRefresh = Date.now();
                    await this.save(cal);
                    this.select({ kind: 'calendar', cal });
                    return true;
                }
            });
        }

        async fetchFeed(url) {
            try {
                const r = await fetch(`/calendar-feed?url=${encodeURIComponent(url)}`, { credentials: 'same-origin' });
                if (!r.ok) { let msg = `The server answered ${r.status}.`; try { msg = (await r.json()).error || msg; } catch (_) { /* keep it */ } return { error: msg }; }
                return { text: await r.text() };
            } catch (err) {
                return { error: (err && err.message) || 'The calendar could not be reached.' };
            }
        }

        /** Subscribed calendars read again when their interval is up (force: all of them now). */
        async refreshSubscriptions(atStart, force) {
            for (const cal of this.calendars) {
                if (!cal.source) continue;
                const due = force || (cal.refresh > 0 && Date.now() - (cal.lastRefresh || 0) >= cal.refresh * 60000) || (atStart && cal.refresh > 0);
                if (!due) continue;
                cal.lastRefresh = Date.now();
                const res = await this.fetchFeed(cal.source);
                if (res.error) { this.status(`${cal.name}: ${res.error}`); continue; }
                const parsed = parseIcs(res.text);
                const tmp = this.adopt({ ...parsed, name: cal.name, color: cal.color }, {});
                this.calendars.pop();
                cal.events = tmp.events;
                cal.tasks = tmp.tasks;
                await this.save(cal);
            }
            this.render();
        }

        // ---- import, export, send, print ---------------------------------------------------

        importDialog() {
            if (typeof root.studioOpenFolderDialog !== 'function') return;
            void root.studioOpenFolderDialog('open-vfs', {
                owner: this.modal,
                startPath: workspaceRoot(),
                host: {
                    title: 'Import',
                    rejectMessage: 'Choose an iCalendar (.ics) file',
                    acceptItem: (item) => !!item && item.targetKind === 'user-file' && /\.ics$/i.test(item.name || ''),
                    onOpen: async (item) => {
                        try {
                            const r = await vfs().downloadFile(item.id);
                            const text = await (await fetch(r.downloadUrl, { credentials: 'same-origin' })).text();
                            const parsed = parseIcs(text);
                            const into = this.writableCal();
                            const v = await this.ask(`<p>Import ${parsed.events.length} appointment${parsed.events.length === 1 ? '' : 's'} and ${parsed.tasks.length} task${parsed.tasks.length === 1 ? '' : 's'} from "${esc(item.name)}" into:</p>`, [[`${into ? into.name : 'a new calendar'}`, 'into'], ['A new calendar', 'new'], ['Cancel', 'no']]);
                            if (v === 'no' || !v) return;
                            if (v === 'new' || !into) {
                                const cal = this.adopt({ ...parsed, name: parsed.name || item.name.replace(/\.ics$/i, ''), source: '' }, {});
                                cal.readonly = false;
                                await this.save(cal);
                            } else {
                                const tmp = this.adopt(parsed, {});
                                this.calendars.pop();
                                const have = new Set(into.events.map((x) => x.uid).concat(into.tasks.map((x) => x.uid)));
                                tmp.events.forEach((x) => { if (!have.has(x.uid)) into.events.push(x); });
                                tmp.tasks.forEach((x) => { if (!have.has(x.uid)) into.tasks.push(x); });
                                await this.save(into);
                            }
                            this.render();
                        } catch (err) {
                            this.status(`The file could not be imported: ${(err && err.message) || err}`);
                        }
                    }
                }
            });
        }

        exportDialog() {
            const cal = this.currentCal();
            if (!cal || typeof root.studioOpenFolderDialog !== 'function') return;
            const self = this;
            void root.studioOpenFolderDialog('save', {
                owner: this.modal,
                startPath: workspaceRoot(),
                host: {
                    title: 'Export',
                    typeLabel: 'iCalendar Files (*.ics)',
                    acceptType: 'user-file',
                    suggestName: () => self.fileNameOf(cal),
                    async onSave(info) {
                        let name = String(info.name || '').trim();
                        if (!name) return false;
                        if (!/\.ics$/i.test(name)) name += '.ics';
                        try {
                            await vfs().uploadFile(info.path || '/', await textB64(toIcs({ ...cal, source: '' })), name, 'text/calendar');
                            return true;
                        } catch (err) {
                            self.status(`The calendar could not be exported: ${(err && err.message) || err}`);
                            return false;
                        }
                    },
                    onCancel() {}
                }
            });
        }

        async send() {
            const cal = this.currentCal();
            const open = typeof doveOpenComposeWindow === 'function' ? doveOpenComposeWindow : root.doveOpenComposeWindow; // eslint-disable-line no-undef
            if (!cal || typeof open !== 'function') { this.status('Dovecote is not available to send the calendar.'); return; }
            const text = toIcs({ ...cal, source: '' });
            open({ mode: 'create', to: '', subject: cal.name, body: `The calendar "${cal.name}" is attached. Import it into Windows Calendar (File > Import).`, attachments: [{ name: this.fileNameOf(cal), mimeType: 'text/calendar', size: text.length, base64: await textB64(text) }] });
        }

        /** Print: the view as it is, on its own page (the browser's print dialog). */
        print() {
            const view = this.el('.wcal-main');
            const css = Array.from(doc.querySelectorAll('link[data-melaton-app-style*="calendar"]')).map((l) => `<link rel="stylesheet" href="${esc(l.href)}">`).join('');
            const f = doc.createElement('iframe');
            f.className = 'wcal-print-frame';
            doc.body.appendChild(f);
            const w = f.contentWindow;
            w.document.open();
            w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Windows Calendar</title>${css}<style>body{margin:12px;font:12px "Segoe UI",sans-serif}.wcal-scroll{overflow:visible!important;height:auto!important}</style></head><body class="wcal-print"><div class="wcal-window"><div class="wcal-main">${view.innerHTML}</div></div></body></html>`);
            w.document.close();
            setTimeout(() => { try { w.focus(); w.print(); } catch (_) { /* no printing here */ } setTimeout(() => f.remove(), 2000); }, 400);
        }

        async close() {
            await this.flush();
            this.app.exit();
        }

        destroy() {
            clearInterval(this.tick);
            this.saveTimers.forEach((t) => clearTimeout(t));
            try { call('closeModal', this.modal); } catch (_) { /* gone */ }
            const m = this.modal;
            setTimeout(() => m.remove(), 300);
        }
    }

    function recurText(e) {
        const r = e.rrule;
        if (!r) return '';
        const every = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[r.freq] || '';
        const n = r.interval > 1 ? `${r.interval} ${every}s` : every;
        let s = `Occurs every ${n}`;
        if (r.freq === 'WEEKLY' && r.byday && r.byday.length) {
            const names = { SU: 'Sunday', MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday' };
            s += ` on ${r.byday.map((x) => names[x] || x).join(', ')}`;
        }
        s += ` starting ${dateText(e.start)}`;
        if (r.until) s += ` until ${dateText(r.until)}`;
        if (r.count) s += `, ${r.count} times`;
        return `${s}.`;
    }

    // ---- the package -------------------------------------------------------------------------

    let running = null;

    async function start(app) {
        if (running) {
            call('bringModalToFront', running.modal);
            app.exit();
            return;
        }
        // its dialogs (Reminders, Subscribe) are Vista dialog templates, a feature loaded on demand
        if (root.featureLoader && !root.vistaDialogTemplate) { try { await root.featureLoader.loadFeature('vista_dialog_templates'); } catch (_) { /* plain prompts only */ } }
        const cal = new Calendar(app);
        running = cal;
        app.onExit(() => { running = null; cal.destroy(); });
    }

    root.melatonCalendar = { start, parseIcs, toIcs, occurrences, parseRrule, _running: () => running };
    if (typeof melatonApps !== 'undefined') melatonApps.define('calendar', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
